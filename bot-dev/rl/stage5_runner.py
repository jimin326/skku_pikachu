"""Resumable stage-5 PPO experiment loop.

The runner owns experiment selection and evaluation. Each training phase is a
separate subprocess so a failed Node/Python worker can be restarted from the
latest atomic checkpoint without taking the whole overnight run down.
"""

from __future__ import annotations

import argparse
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import torch

from ppo_eval import evaluate


HERE = Path(__file__).resolve().parent
TRAINER = HERE / "ppo_train.py"
RUNS_ROOT = HERE / "runs"
ACTIVE_POINTER = RUNS_ROOT / "stage5_active.json"
SELECTION_SEEDS = [
    401009,
    421031,
    441011,
    461009,
    481021,
    501023,
    521009,
    541007,
    561019,
    581011,
]

# The variants repeat with new training seeds until the session time or trial
# limit is reached. They intentionally stay close to the verified stage-4 PPO
# rather than launching a broad, expensive blind search.
VARIANTS = [
    {
        "name": "balanced",
        "learning_rate": 3e-4,
        "entropy_coef": 0.015,
        "gamma": 0.995,
        "gae_lambda": 0.95,
    },
    {
        "name": "explore",
        "learning_rate": 3e-4,
        "entropy_coef": 0.025,
        "gamma": 0.995,
        "gae_lambda": 0.95,
    },
    {
        "name": "stable",
        "learning_rate": 1.5e-4,
        "entropy_coef": 0.012,
        "gamma": 0.997,
        "gae_lambda": 0.96,
    },
    {
        "name": "short_horizon",
        "learning_rate": 2.5e-4,
        "entropy_coef": 0.020,
        "gamma": 0.990,
        "gae_lambda": 0.94,
    },
]


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def atomic_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".tmp")
    shutil.copyfile(source, temporary)
    os.replace(temporary, destination)


def load_json(path: Path) -> dict:
    return json.loads(path.read_text(encoding="utf-8"))


def checkpoint_steps(path: Path) -> int:
    saved = torch.load(path, map_location="cpu", weights_only=False)
    return int(saved.get("global_step", 0))


def score_result(result: dict) -> tuple:
    # Match wins dominate. Non-thunder rally rate breaks ties, while a policy
    # that stalls until maxFrames is strictly worse than one that finishes.
    return (
        int(result.get("matchWins", 0)),
        float(result.get("matchWinRate") or 0.0),
        float(result.get("nonThunderWinRate") or 0.0),
        -int(result.get("truncations", 0)),
    )


def make_new_state(args) -> tuple[Path, dict]:
    stamp = datetime.now().strftime("%Y%m%d_%H%M%S")
    run_dir = (args.run_dir or RUNS_ROOT / f"stage5_{stamp}").resolve()
    if run_dir.exists() and any(run_dir.iterdir()):
        raise FileExistsError(f"new run directory is not empty: {run_dir}")
    run_dir.mkdir(parents=True, exist_ok=True)
    state = {
        "version": 1,
        "status": "running",
        "createdAt": now_iso(),
        "updatedAt": now_iso(),
        "runDir": str(run_dir),
        "nextTrial": 0,
        "active": None,
        "completed": [],
        "best": None,
        "settings": {
            "trialSteps": args.trial_steps,
            "curriculum": args.curriculum,
            "workers": args.workers,
            "envsPerWorker": args.envs_per_worker,
            "rolloutSteps": args.rollout_steps,
            "updateEpochs": args.update_epochs,
            "minibatchSize": args.minibatch_size,
            "gamesPerSeries": args.games_per_series,
            "checkpointMinutes": args.checkpoint_minutes,
            "evalGames": args.eval_games,
            "evalMaxFrames": args.eval_max_frames,
            "selectionSeeds": args.selection_seeds,
        },
    }
    atomic_json(run_dir / "state.json", state)
    atomic_json(ACTIVE_POINTER, {"runDir": str(run_dir)})
    return run_dir, state


def open_or_create_state(args) -> tuple[Path, dict]:
    if args.run_dir and (args.run_dir / "state.json").exists() and not args.new_run:
        run_dir = args.run_dir.resolve()
        return run_dir, load_json(run_dir / "state.json")
    if not args.run_dir and ACTIVE_POINTER.exists() and not args.new_run:
        pointer = load_json(ACTIVE_POINTER)
        run_dir = Path(pointer["runDir"])
        state_path = run_dir / "state.json"
        if state_path.exists():
            state = load_json(state_path)
            if state.get("status") != "complete":
                return run_dir, state
    return make_new_state(args)


def save_state(run_dir: Path, state: dict) -> None:
    state["updatedAt"] = now_iso()
    atomic_json(run_dir / "state.json", state)
    atomic_json(ACTIVE_POINTER, {"runDir": str(run_dir)})


def phase_targets(total_steps: int, curriculum: list[int]) -> list[dict]:
    if len(curriculum) == 1:
        return [{"winningScore": curriculum[0], "targetSteps": total_steps}]
    ratios = [0.10, 0.30, 1.0]
    if len(curriculum) != len(ratios):
        raise ValueError("curriculum must contain one score or exactly three scores")
    return [
        {"winningScore": score, "targetSteps": max(1, round(total_steps * ratio))}
        for score, ratio in zip(curriculum, ratios)
    ]


def start_trial(run_dir: Path, state: dict, args) -> dict:
    trial_number = int(state["nextTrial"])
    variant = VARIANTS[trial_number % len(VARIANTS)]
    cycle = trial_number // len(VARIANTS)
    seed = args.base_seed + trial_number * 1009 + cycle * 7919
    name = f"trial_{trial_number:03d}_{variant['name']}_s{seed}"
    trial_dir = run_dir / name
    trial_dir.mkdir(parents=True, exist_ok=True)
    active = {
        "trial": trial_number,
        "name": name,
        "variant": variant,
        "seed": seed,
        "trialDir": str(trial_dir),
        "phaseIndex": 0,
        "phases": phase_targets(args.trial_steps, args.curriculum),
        "retries": 0,
        "startedAt": now_iso(),
    }
    state["active"] = active
    save_state(run_dir, state)
    return active


def trainer_command(active: dict, phase: dict, args, remaining_minutes: float) -> list[str]:
    variant = active["variant"]
    trial_dir = Path(active["trialDir"])
    latest = trial_dir / "latest.pt"
    command = [
        sys.executable,
        str(TRAINER),
        "--total-steps",
        str(phase["targetSteps"]),
        "--workers",
        str(args.workers),
        "--envs-per-worker",
        str(args.envs_per_worker),
        "--rollout-steps",
        str(args.rollout_steps),
        "--update-epochs",
        str(args.update_epochs),
        "--minibatch-size",
        str(args.minibatch_size),
        "--games-per-series",
        str(args.games_per_series),
        "--winning-score",
        str(phase["winningScore"]),
        "--learning-rate",
        str(variant["learning_rate"]),
        "--entropy-coef",
        str(variant["entropy_coef"]),
        "--gamma",
        str(variant["gamma"]),
        "--gae-lambda",
        str(variant["gae_lambda"]),
        "--seed",
        str(active["seed"]),
        "--checkpoint-dir",
        str(trial_dir),
        "--save-every",
        str(args.save_every),
        "--save-every-minutes",
        str(args.checkpoint_minutes),
        "--log-every",
        str(args.log_every),
        "--max-wall-minutes",
        str(max(0.05, remaining_minutes)),
    ]
    if latest.exists():
        command.extend(["--resume", str(latest)])
    return command


def evaluate_trial(run_dir: Path, state: dict, active: dict, args) -> None:
    trial_dir = Path(active["trialDir"])
    checkpoint = trial_dir / "latest.pt"
    result = evaluate(
        checkpoint,
        seeds=args.selection_seeds,
        games_per_series=args.eval_games,
        winning_score=10,
        max_frames=args.eval_max_frames,
        device_name="cpu",
    )
    result["trial"] = active["trial"]
    result["variant"] = active["variant"]["name"]
    result["trainingSeed"] = active["seed"]
    result_path = trial_dir / "evaluation.json"
    atomic_json(result_path, result)

    completed = {
        "trial": active["trial"],
        "name": active["name"],
        "checkpoint": str(checkpoint),
        "evaluation": str(result_path),
        "score": list(score_result(result)),
        "completedAt": now_iso(),
    }
    state["completed"].append(completed)
    current_best = state.get("best")
    if current_best is None or tuple(completed["score"]) > tuple(current_best["score"]):
        best_path = run_dir / "best.pt"
        atomic_copy(checkpoint, best_path)
        state["best"] = {**completed, "checkpoint": str(best_path)}
        atomic_json(run_dir / "best.json", state["best"])
        print(
            f"NEW BEST trial={active['trial']} score={completed['score']} -> {best_path}",
            flush=True,
        )

    state["nextTrial"] = active["trial"] + 1
    state["active"] = None
    save_state(run_dir, state)


def run(args) -> int:
    run_dir, state = open_or_create_state(args)
    if state.get("status") == "error" and state.get("active"):
        state["active"]["retries"] = 0
        state.pop("error", None)
    state["status"] = "running"
    state["lastSessionStartedAt"] = now_iso()
    save_state(run_dir, state)
    deadline = time.monotonic() + args.hours * 3600
    trials_started_this_session = 0
    print(f"stage5 run: {run_dir}", flush=True)
    print(
        f"session budget: {args.hours:g}h, checkpoint every {args.checkpoint_minutes:g}m",
        flush=True,
    )

    try:
        while time.monotonic() < deadline:
            if args.max_trials > 0 and trials_started_this_session >= args.max_trials:
                state["status"] = "complete"
                save_state(run_dir, state)
                return 0
            active = state.get("active") or start_trial(run_dir, state, args)
            if int(active["phaseIndex"]) == 0:
                trials_started_this_session += 1

            phases = active["phases"]
            while active["phaseIndex"] < len(phases) and time.monotonic() < deadline:
                phase = phases[active["phaseIndex"]]
                trial_dir = Path(active["trialDir"])
                latest = trial_dir / "latest.pt"
                steps = checkpoint_steps(latest) if latest.exists() else 0
                if steps >= int(phase["targetSteps"]):
                    active["phaseIndex"] += 1
                    active["retries"] = 0
                    save_state(run_dir, state)
                    continue

                remaining_minutes = max(0.05, (deadline - time.monotonic()) / 60)
                command = trainer_command(active, phase, args, remaining_minutes)
                print(
                    f"TRAIN trial={active['trial']} variant={active['variant']['name']} "
                    f"score={phase['winningScore']} steps={steps}->{phase['targetSteps']}",
                    flush=True,
                )
                completed = subprocess.run(command, cwd=HERE.parent.parent)
                latest_steps = checkpoint_steps(latest) if latest.exists() else steps
                active["lastCheckpoint"] = str(latest) if latest.exists() else None
                active["lastSteps"] = latest_steps
                active["lastExitCode"] = completed.returncode
                save_state(run_dir, state)

                if completed.returncode != 0:
                    active["retries"] = int(active.get("retries", 0)) + 1
                    save_state(run_dir, state)
                    if active["retries"] > args.max_retries:
                        raise RuntimeError(
                            f"trial {active['trial']} failed {active['retries']} times"
                        )
                    print(
                        f"RETRY {active['retries']}/{args.max_retries} from {latest}",
                        flush=True,
                    )
                    time.sleep(min(10, active["retries"] * 2))
                    continue
                if latest_steps >= int(phase["targetSteps"]):
                    active["phaseIndex"] += 1
                    active["retries"] = 0
                    save_state(run_dir, state)

            if active["phaseIndex"] < len(phases):
                break

            print(f"EVAL trial={active['trial']} checkpoint={active['lastCheckpoint']}", flush=True)
            evaluate_trial(run_dir, state, active, args)
            if state.get("best") and float(state["best"]["score"][1]) >= (
                args.target_match_win_rate
            ):
                state["status"] = "complete"
                state["completionReason"] = (
                    f"target match win rate {args.target_match_win_rate:.3f} reached"
                )
                save_state(run_dir, state)
                print(state["completionReason"], flush=True)
                return 0

        state["status"] = "paused"
        state["pauseReason"] = "session time budget reached"
        save_state(run_dir, state)
        print(f"PAUSED; run the same command to resume: {run_dir}", flush=True)
        return 0
    except KeyboardInterrupt:
        state["status"] = "paused"
        state["pauseReason"] = "keyboard interrupt"
        save_state(run_dir, state)
        print("PAUSED after Ctrl+C; latest hourly/final checkpoint is retained", flush=True)
        return 130
    except Exception as error:
        state["status"] = "error"
        state["error"] = repr(error)
        save_state(run_dir, state)
        raise


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("--hours", type=float, default=8.0)
    parser.add_argument("--trial-steps", type=int, default=10_000_000)
    parser.add_argument("--curriculum", default="1,3,10")
    parser.add_argument("--workers", type=int, default=8)
    parser.add_argument("--envs-per-worker", type=int, default=1)
    parser.add_argument("--rollout-steps", type=int, default=256)
    parser.add_argument("--update-epochs", type=int, default=4)
    parser.add_argument("--minibatch-size", type=int, default=256)
    parser.add_argument("--games-per-series", type=int, default=4)
    parser.add_argument("--checkpoint-minutes", type=float, default=60.0)
    parser.add_argument("--save-every", type=int, default=1_000_000)
    parser.add_argument("--log-every", type=int, default=10)
    parser.add_argument("--eval-games", type=int, default=2)
    parser.add_argument("--eval-max-frames", type=int, default=12_000)
    parser.add_argument("--selection-seeds", default=",".join(map(str, SELECTION_SEEDS)))
    parser.add_argument("--base-seed", type=int, default=20260903)
    parser.add_argument("--max-retries", type=int, default=3)
    parser.add_argument("--max-trials", type=int, default=0)
    parser.add_argument("--target-match-win-rate", type=float, default=0.5)
    parser.add_argument("--run-dir", type=Path, default=None)
    parser.add_argument("--new-run", action="store_true")
    args = parser.parse_args()
    args.curriculum = [int(item) for item in args.curriculum.split(",") if item]
    args.selection_seeds = [
        int(item) for item in args.selection_seeds.split(",") if item
    ]
    if args.hours <= 0 or args.trial_steps <= 0:
        parser.error("hours and trial-steps must be positive")
    if args.save_every <= 0 or args.checkpoint_minutes <= 0:
        parser.error("save intervals must be positive")
    if not 0 <= args.target_match_win_rate <= 1:
        parser.error("target-match-win-rate must be in [0, 1]")
    return args


if __name__ == "__main__":
    raise SystemExit(run(parse_args()))
