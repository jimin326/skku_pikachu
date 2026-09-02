"""Deterministic held-out evaluation for a saved RedTeam PPO checkpoint."""

from __future__ import annotations

import argparse
import json
from pathlib import Path

import numpy as np
import torch

from node_bridge import NodeVectorEnv
from ppo_train import ActorCritic


DEFAULT_SEEDS = [
    104729,
    130363,
    155921,
    181081,
    205759,
    232003,
    257591,
    283303,
    308927,
    334061,
]


def evaluate(
    checkpoint_path: Path,
    *,
    seeds: list[int],
    games_per_series: int,
    winning_score: int | None,
    max_frames: int,
    device_name: str,
) -> dict:
    device = torch.device(device_name)
    saved = torch.load(checkpoint_path, map_location=device, weights_only=False)
    saved_config = saved.get("config", {})
    score = int(winning_score or saved_config.get("winning_score", 10))

    match_wins = 0
    matches = 0
    non_thunder_wins = 0
    non_thunder_losses = 0
    winning_phases = np.zeros(3, dtype=np.int64)
    victim_serve_phases = np.zeros(3, dtype=np.int64)
    truncations = 0
    series_records = []

    torch.set_num_threads(1)
    with NodeVectorEnv(
        1, env_options={"winningScore": score, "maxFrames": max_frames}
    ) as env:
        model = ActorCritic(env.observation_size, env.action_count).to(device)
        model.load_state_dict(saved["model"])
        model.eval()

        for seed in seeds:
            for side in ("LEFT", "RIGHT"):
                series_wins = 0
                series_truncations = 0
                can_preserve = False
                for game in range(games_per_series):
                    request = (
                        {"preserveBotState": True, "side": side}
                        if can_preserve
                        else {"seed": seed, "side": side}
                    )
                    observations, _ = env.reset([request])
                    while True:
                        with torch.inference_mode():
                            logits, _ = model(torch.as_tensor(observations, device=device))
                            action = int(logits.argmax(dim=-1).item())
                        observations, _, terminated, truncated, infos = env.step([action])
                        if bool(terminated[0] or truncated[0]):
                            info = infos[0]
                            was_truncated = bool(truncated[0])
                            won = not was_truncated and (
                                info["scores"]["self"] > info["scores"]["opp"]
                            )
                            can_preserve = bool(terminated[0])
                            truncations += int(was_truncated)
                            series_truncations += int(was_truncated)
                            match_wins += int(won)
                            series_wins += int(won)
                            matches += 1
                            stats = info["rallyStats"]
                            non_thunder_wins += int(stats["nonThunderWins"])
                            non_thunder_losses += int(stats["nonThunderLosses"])
                            winning_phases += np.asarray(
                                stats["winningGameVictimServePhaseCounts"], dtype=np.int64
                            )
                            victim_serve_phases += np.asarray(
                                stats["victimServePhaseCounts"], dtype=np.int64
                            )
                            break
                series_records.append(
                    {
                        "seed": seed,
                        "side": side,
                        "wins": series_wins,
                        "games": games_per_series,
                        "truncations": series_truncations,
                    }
                )

    total_non_thunder = non_thunder_wins + non_thunder_losses
    return {
        "checkpoint": str(checkpoint_path.resolve()),
        "checkpointSteps": int(saved.get("global_step", 0)),
        "winningScore": score,
        "seeds": seeds,
        "gamesPerSeedSide": games_per_series,
        "matches": matches,
        "matchWins": match_wins,
        "matchWinRate": match_wins / matches if matches else None,
        "truncations": truncations,
        "maxFrames": max_frames,
        "nonThunderWins": non_thunder_wins,
        "nonThunderLosses": non_thunder_losses,
        "nonThunderWinRate": non_thunder_wins / total_non_thunder
        if total_non_thunder
        else None,
        "victimServePhaseCounts": victim_serve_phases.tolist(),
        "winningGameVictimServePhaseCounts": winning_phases.tolist(),
        "series": series_records,
    }


def parse_args():
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("--seeds", default=",".join(map(str, DEFAULT_SEEDS)))
    parser.add_argument("--games-per-series", type=int, default=3)
    parser.add_argument("--winning-score", type=int, default=None)
    parser.add_argument("--max-frames", type=int, default=60000)
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--output", type=Path, default=None)
    return parser.parse_args()


if __name__ == "__main__":
    args = parse_args()
    result = evaluate(
        args.checkpoint,
        seeds=[int(item) for item in args.seeds.split(",") if item],
        games_per_series=args.games_per_series,
        winning_score=args.winning_score,
        max_frames=args.max_frames,
        device_name=args.device,
    )
    encoded = json.dumps(result, indent=2)
    print(encoded)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
