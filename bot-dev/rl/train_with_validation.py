"""Phase-wise PPO training with held-out validation, best-checkpoint selection and rollback.

Replaces "take the last 2M checkpoint" with:

  for each phase of --phase-steps:
      train  (ppo_train.py, resumed from the previous phase or from the best checkpoint after a rollback)
      export + paired validation + stats + pre-registered gates (eval/gates.py)
      if selection_key improves  -> best.pt / best.json updated
      elif no improvement for --patience phases:
          rollback: resume from best.pt with learning rate * --rollback-lr-factor
          (at most --max-rollbacks times, then stop)

Everything needed to continue after a Colab disconnect is mirrored to
--recovery-dir (Drive): training checkpoints (ppo_train's own recovery
pointer), state.json, best.pt/best.json, validation_log.jsonl and every
validation directory.  Re-running the same command resumes; nothing in the
recovery directory is ever overwritten except the pointer files.

The final answer is best.json, never latest.pt.  Copying anything to
src/code-here stays a manual step gated on best.json["submission"] == true.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
import subprocess
import sys
import time
from datetime import datetime
from pathlib import Path

import torch

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "eval"))

from checkpoint_sweep import evaluate_one, load_probe  # noqa: E402
from gates import GateThresholds  # noqa: E402


def now_iso() -> str:
    return datetime.now().astimezone().isoformat(timespec="seconds")


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def atomic_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(payload, ensure_ascii=False, indent=2), encoding="utf-8")
    os.replace(temporary, path)


def atomic_copy(source: Path, destination: Path) -> None:
    destination.parent.mkdir(parents=True, exist_ok=True)
    temporary = destination.with_name(destination.name + ".tmp")
    shutil.copyfile(source, temporary)
    os.replace(temporary, destination)


def checkpoint_step(path: Path) -> int:
    return int(torch.load(path, map_location="cpu", weights_only=False).get("global_step", 0))


class Runner:
    def __init__(self, args: argparse.Namespace) -> None:
        self.args = args
        self.run_dir = args.run_dir.resolve()
        self.recovery = args.recovery_dir.resolve() if args.recovery_dir else None
        self.state_path = self.run_dir / "state.json"
        self.state = self._open_state()

    # ---------------- state ----------------
    def _open_state(self) -> dict:
        if self.state_path.is_file():
            return json.loads(self.state_path.read_text(encoding="utf-8"))
        if self.recovery and (self.recovery / "state.json").is_file():
            print(f"restoring run state from {self.recovery}", flush=True)
            self.run_dir.mkdir(parents=True, exist_ok=True)
            for name in ("state.json", "best.json", "validation_log.jsonl"):
                if (self.recovery / name).is_file():
                    atomic_copy(self.recovery / name, self.run_dir / name)
            if (self.recovery / "best.pt").is_file():
                atomic_copy(self.recovery / "best.pt", self.run_dir / "best.pt")
            state = json.loads(self.state_path.read_text(encoding="utf-8"))
            # The resume checkpoint lives in the recovery checkpoint mirror.
            if state.get("resume") and not Path(state["resume"]["path"]).is_file():
                name = Path(state["resume"]["path"]).name
                branch = f"branch_{int(state.get('rollbacks', 0)):02d}"
                for mirrored in (self.recovery / "phase_checkpoints" / name, self.recovery / "checkpoints" / branch / name, self.recovery / "best.pt"):
                    if mirrored.is_file() and sha256_of(mirrored) == state["resume"]["sha256"]:
                        state["resume"]["path"] = str(mirrored)
                        break
            return state
        self.run_dir.mkdir(parents=True, exist_ok=True)
        a = self.args
        return {
            "version": 1,
            "experimentId": a.experiment_id,
            "createdAt": now_iso(),
            "status": "running",
            "config": {
                key: getattr(a, key)
                for key in (
                    "phase_steps", "total_steps", "max_phases", "patience", "max_rollbacks", "rollback_lr_factor",
                    "learning_rate", "entropy_coef", "clip_coef", "anchor_kl_coef", "anchor_kl_decay_updates",
                    "anchor_kl_floor", "policy_freeze_updates", "workers", "envs_per_worker", "seed",
                )
            } | {
                "initialModel": str(a.initial_model) if a.initial_model else None,
                "anchorModel": str(a.anchor_model) if a.anchor_model else None,
                "split": str(a.split),
                "thresholds": GateThresholds().__dict__,
            },
            "phases": [],
            "best": None,
            "resume": None,
            "currentLearningRate": a.learning_rate,
            "rollbacks": 0,
            "consecutiveNonImprovements": 0,
            "nextPhase": 0,
        }

    def save(self) -> None:
        self.state["updatedAt"] = now_iso()
        atomic_json(self.state_path, self.state)
        if self.recovery:
            atomic_json(self.recovery / "state.json", self.state)

    def mirror(self, source: Path, relative: str) -> None:
        if not self.recovery:
            return
        target = self.recovery / relative
        if source.is_dir():
            target.mkdir(parents=True, exist_ok=True)
            for item in source.iterdir():
                if item.is_file():
                    atomic_copy(item, target / item.name)
        else:
            atomic_copy(source, target)

    # ---------------- training ----------------
    @property
    def ckpt_dir(self) -> Path:
        # One checkpoint directory per rollback branch so a rollback never
        # overwrites checkpoints (local or mirrored) of the branch it replaces.
        return self.run_dir / "ckpt" / f"branch_{int(self.state.get('rollbacks', 0)):02d}"

    def train_phase(self, phase: int, target_steps: int, deadline: float) -> Path:
        a = self.args
        resume = self.state.get("resume")
        command = [
            sys.executable, str(HERE / "ppo_train.py"),
            "--total-steps", str(target_steps),
            "--workers", str(a.workers), "--envs-per-worker", str(a.envs_per_worker),
            "--learning-rate", str(self.state["currentLearningRate"]),
            "--entropy-coef", str(a.entropy_coef), "--clip-coef", str(a.clip_coef),
            "--seed", str(a.seed), "--device", a.device,
            "--checkpoint-dir", str(self.ckpt_dir),
            "--save-every", str(a.save_every), "--save-every-minutes", str(a.save_every_minutes),
            "--max-wall-minutes", str(max(0.05, (deadline - time.monotonic()) / 60)),
            "--opponent-registry", str(a.registry), "--opponent-split", str(a.train_split),
            "--rollout-steps", str(a.rollout_steps), "--minibatch-size", str(a.minibatch_size),
            "--update-epochs", str(a.update_epochs), "--winning-score", str(a.winning_score),
            "--games-per-series", str(a.games_per_series),
        ]
        if self.recovery:
            command += ["--recovery-dir", str(self.recovery / "checkpoints" / self.ckpt_dir.name)]
        if a.anchor_model:
            command += [
                "--anchor-model", str(a.anchor_model), "--anchor-kl-coef", str(a.anchor_kl_coef),
                "--anchor-kl-decay-updates", str(a.anchor_kl_decay_updates), "--anchor-kl-floor", str(a.anchor_kl_floor),
            ]
        if a.policy_freeze_updates:
            command += ["--policy-freeze-updates", str(a.policy_freeze_updates)]
        if resume:
            resume_path = Path(resume["path"])
            assert resume_path.is_file(), f"missing resume checkpoint {resume_path}"
            assert sha256_of(resume_path) == resume["sha256"], f"resume checkpoint hash mismatch: {resume_path}"
            command += ["--resume", str(resume_path)]
            if resume.get("rollback"):
                command += ["--reseed-on-resume", str(a.seed + 1000 * (self.state["rollbacks"] + 1) + phase)]
        elif a.initial_model:
            command += ["--initial-model", str(a.initial_model)]
        print("TRAIN", " ".join(command), flush=True)
        completed = subprocess.run(command, cwd=REPO)
        if completed.returncode != 0:
            raise RuntimeError(f"ppo_train exited with {completed.returncode}")
        latest = self.ckpt_dir / "latest.pt"
        assert latest.is_file(), "ppo_train produced no latest.pt"
        return latest

    # ---------------- validation + selection ----------------
    def validate(self, phase: int, checkpoint: Path, step: int) -> dict:
        a = self.args
        # Freeze the evaluated checkpoint under a phase-specific name so later
        # phases cannot overwrite it.
        frozen = self.run_dir / "phase_checkpoints" / f"phase_{phase:03d}_step_{step:09d}.pt"
        atomic_copy(checkpoint, frozen)
        self.mirror(frozen, f"phase_checkpoints/{frozen.name}")
        record = evaluate_one(
            label=f"phase{phase:03d}", step=step, checkpoint=frozen, output_dir=self.run_dir / "validation",
            split=a.split, registry=a.registry, anchor=a.anchor_model, probe=self.probe,
            runtime=a.runtime, thresholds=GateThresholds(),
        )
        record["phase"] = phase
        record["learningRate"] = self.state["currentLearningRate"]
        with (self.run_dir / "validation_log.jsonl").open("a", encoding="utf-8") as log:
            log.write(json.dumps(record, ensure_ascii=False) + "\n")
        self.mirror(Path(record["workDir"]), f"validation/{Path(record['workDir']).name}")
        self.mirror(self.run_dir / "validation_log.jsonl", "validation_log.jsonl")
        return record

    def select(self, record: dict, frozen: Path) -> str:
        best = self.state.get("best")
        key = tuple(record["selectionKey"])

        # --- pre-registered self-destruction stop rule (ABLATION_PLAN.md section 5) ---
        # Two consecutive rises in self-destruction end the arm, whatever the
        # paired deltas do.
        sd = record["selfDestruction"].get("rateAmongLosses")
        history = self.state.setdefault("selfDestructionHistory", [])
        if sd is not None:
            history.append(float(sd))
        rises = 0
        for earlier, later in zip(history, history[1:]):
            rises = rises + 1 if later > earlier else 0
        if rises >= 2:
            self.state["stopReason"] = (
                f"self-destruction rose for two consecutive phases: {[round(v, 4) for v in history[-3:]]}"
            )
            return "stop"

        # An un-selectable checkpoint is never recorded as best, not even the
        # first one.  Otherwise a run where every checkpoint blows past the
        # self-destruction ceiling would still hand back a "best" model.
        if not record["selectable"]:
            self.state["unselectablePhases"] = int(self.state.get("unselectablePhases", 0)) + 1
            self.state["consecutiveNonImprovements"] += 1
            if best is None and self.state["unselectablePhases"] >= self.args.max_unselectable_phases:
                self.state["stopReason"] = (
                    f"no selectable checkpoint after {self.state['unselectablePhases']} phases "
                    f"(self-destruction ceiling {GateThresholds().self_destruction_selectable_max} or runtime gate)"
                )
                return "stop"
            return "continue"

        if best is None or key > tuple(best["selectionKey"]):
            atomic_copy(frozen, self.run_dir / "best.pt")
            self.state["best"] = {
                "phase": record["phase"], "step": record["step"], "checkpoint": str(self.run_dir / "best.pt"),
                "sourceCheckpoint": str(frozen), "sha256": sha256_of(frozen), "selectionKey": record["selectionKey"],
                "selectable": record["selectable"], "submission": record["submission"],
                "primary": record["primary"], "benchmark": record["benchmark"], "selfDestruction": record["selfDestruction"],
                "validationDir": record["workDir"], "updatedAt": now_iso(),
            }
            atomic_json(self.run_dir / "best.json", self.state["best"])
            self.mirror(self.run_dir / "best.pt", "best.pt")
            self.mirror(self.run_dir / "best.json", "best.json")
            self.state["consecutiveNonImprovements"] = 0
            return "improved"
        self.state["consecutiveNonImprovements"] += 1
        if self.state["consecutiveNonImprovements"] >= self.args.patience:
            if self.state["rollbacks"] >= self.args.max_rollbacks:
                self.state["stopReason"] = "no improvement after max rollbacks"
                return "stop"
            self.state["rollbacks"] += 1
            self.state["consecutiveNonImprovements"] = 0
            self.state["currentLearningRate"] = self.state["currentLearningRate"] * self.args.rollback_lr_factor
            self.state["resume"] = {"path": str(self.run_dir / "best.pt"), "sha256": best["sha256"], "rollback": True, "step": best["step"]}
            return "rollback"
        return "continue"

    def run(self) -> int:
        a = self.args
        self.probe = load_probe(a.probe_dataset, a.probe_limit, a.seed)
        deadline = time.monotonic() + a.max_wall_minutes * 60 if a.max_wall_minutes > 0 else float("inf")
        if self.state.get("status") == "complete":
            print(json.dumps({"status": "complete", "reason": self.state.get("completionReason"), "best": self.state.get("best")}), flush=True)
            return 0
        self.state["status"] = "running"
        self.save()
        while True:
            phase = int(self.state["nextPhase"])
            if a.max_phases and phase >= a.max_phases:
                self.state["status"] = "complete"; self.state["completionReason"] = "max phases"; break
            resume = self.state.get("resume")
            current_step = int(resume["step"]) if resume else 0
            if current_step >= a.total_steps:
                self.state["status"] = "complete"; self.state["completionReason"] = "total steps reached"; break
            if time.monotonic() >= deadline:
                self.state["status"] = "paused"; self.state["pauseReason"] = "wall budget"; break
            target = min(a.total_steps, current_step + a.phase_steps)
            latest = self.train_phase(phase, target, deadline)
            step = checkpoint_step(latest)
            digest = sha256_of(latest)
            if step < target:
                # Wall budget hit mid-phase: keep the partial progress as the resume point, evaluate next time.
                self.state["resume"] = {"path": str(latest), "sha256": digest, "rollback": False, "step": step, "partial": True}
                self.state["status"] = "paused"; self.state["pauseReason"] = "wall budget during phase"; break
            record = self.validate(phase, latest, step)
            frozen = Path(record["checkpoint"])
            decision = self.select(record, frozen)
            entry = {"phase": phase, "step": step, "checkpointSha256": digest, "decision": decision, "selectionKey": record["selectionKey"],
                     "primary": record["primary"]["estimate"], "benchmark": record["benchmark"]["estimate"] if record["benchmark"] else None,
                     "selfDestruction": record["selfDestruction"].get("rateAmongLosses"), "learningRate": self.state["currentLearningRate"], "at": now_iso()}
            self.state["phases"].append(entry)
            print("PHASE", json.dumps(entry), flush=True)
            if decision != "rollback":
                self.state["resume"] = {"path": str(frozen), "sha256": sha256_of(frozen), "rollback": False, "step": step}
            self.state["nextPhase"] = phase + 1
            if decision == "stop":
                self.state["status"] = "complete"
                self.state["completionReason"] = self.state.pop("stopReason", "no improvement after max rollbacks")
                break
            self.save()
        self.save()
        best = self.state.get("best")
        print(json.dumps({"status": self.state["status"], "reason": self.state.get("completionReason") or self.state.get("pauseReason"),
                          "selfDestructionHistory": self.state.get("selfDestructionHistory", []),
                          "best": {k: best[k] for k in ("phase", "step", "selectionKey", "selectable", "submission")} if best else None}), flush=True)
        if best is None:
            print("NO selectable checkpoint was produced. Report the experiment; do not run more seeds and do not "
                  "copy anything to src/code-here.", flush=True)
        elif not best["submission"]:
            print("Best checkpoint does NOT pass the submission gates; do not copy it to src/code-here.", flush=True)
        return 0


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--experiment-id", required=True)
    parser.add_argument("--run-dir", type=Path, required=True)
    parser.add_argument("--recovery-dir", type=Path, default=None)
    parser.add_argument("--initial-model", type=Path, default=None)
    parser.add_argument("--anchor-model", type=Path, default=None)
    parser.add_argument("--anchor-kl-coef", type=float, default=0.0)
    parser.add_argument("--anchor-kl-decay-updates", type=int, default=0)
    parser.add_argument("--anchor-kl-floor", type=float, default=0.0)
    parser.add_argument("--policy-freeze-updates", type=int, default=0)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--entropy-coef", type=float, default=0.01)
    parser.add_argument("--clip-coef", type=float, default=0.2)
    parser.add_argument("--phase-steps", type=int, default=100_000)
    parser.add_argument("--total-steps", type=int, default=1_000_000)
    parser.add_argument("--max-phases", type=int, default=0)
    parser.add_argument("--patience", type=int, default=2)
    parser.add_argument("--max-rollbacks", type=int, default=2)
    parser.add_argument("--max-unselectable-phases", type=int, default=3,
                        help="stop if this many phases pass without any selectable checkpoint")
    parser.add_argument("--rollback-lr-factor", type=float, default=0.5)
    parser.add_argument("--workers", type=int, default=4)
    parser.add_argument("--envs-per-worker", type=int, default=4)
    parser.add_argument("--seed", type=int, default=20260903)
    parser.add_argument("--device", default="auto")
    parser.add_argument("--rollout-steps", type=int, default=256)
    parser.add_argument("--minibatch-size", type=int, default=256)
    parser.add_argument("--update-epochs", type=int, default=4)
    parser.add_argument("--winning-score", type=int, default=10)
    parser.add_argument("--games-per-series", type=int, default=4)
    parser.add_argument("--save-every", type=int, default=25)
    parser.add_argument("--save-every-minutes", type=float, default=30.0)
    parser.add_argument("--max-wall-minutes", type=float, default=0.0)
    parser.add_argument("--split", type=Path, default=HERE / "eval" / "splits" / "validation.json")
    parser.add_argument("--train-split", type=Path, default=HERE / "eval" / "splits" / "train.json")
    parser.add_argument("--registry", type=Path, default=HERE / "eval" / "opponents.json")
    parser.add_argument("--probe-dataset", type=Path, default=None)
    parser.add_argument("--probe-limit", type=int, default=20000)
    parser.add_argument("--runtime", action="store_true", help="run runtime_bench in every validation")
    args = parser.parse_args()
    if args.anchor_kl_coef > 0 and not args.anchor_model:
        parser.error("--anchor-kl-coef requires --anchor-model")
    split = json.loads(args.split.read_text(encoding="utf-8"))
    train_split = json.loads(args.train_split.read_text(encoding="utf-8"))
    leaked = set(split.get("seeds", [])) & set(train_split.get("seeds", []))
    leaked_opponents = set(split.get("opponents", [])) & set(train_split.get("opponents", []))
    if leaked or leaked_opponents:
        parser.error(f"validation split leaks into train split: seeds={sorted(leaked)} opponents={sorted(leaked_opponents)}")
    return args


if __name__ == "__main__":
    raise SystemExit(Runner(parse_args()).run())
