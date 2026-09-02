"""Paired, block-clustered statistics for exported JavaScript bot evaluation."""

from __future__ import annotations

import argparse
import json
import math
from collections import Counter, defaultdict
from pathlib import Path
from typing import Any, Iterable

import numpy as np


def wilson_interval(successes: int, total: int, z: float = 1.959963984540054) -> list[float] | None:
    if total == 0:
        return None
    proportion = successes / total
    denominator = 1 + z * z / total
    center = (proportion + z * z / (2 * total)) / denominator
    half = z * math.sqrt(proportion * (1 - proportion) / total + z * z / (4 * total * total)) / denominator
    return [center - half, center + half]


def _match_blocks(rows: Iterable[dict[str, Any]]) -> dict[str, dict[str, list[dict[str, Any]]]]:
    blocks: dict[str, dict[str, list[dict[str, Any]]]] = defaultdict(lambda: defaultdict(list))
    for row in rows:
        if row.get("kind") == "match":
            blocks[row["blockId"]][row["arm"]].append(row)
    if not blocks:
        raise ValueError("evaluation contains no match rows")
    for block_id, arms in blocks.items():
        if set(arms) != {"candidate", "v4"}:
            raise ValueError(f"block {block_id} is missing a paired arm")
    return blocks


def paired_macro_delta(
    rows: list[dict[str, Any]], *, bootstrap_samples: int = 10_000, seed: int = 20260903
) -> dict[str, Any]:
    blocks = _match_blocks(rows)
    by_opponent: dict[str, list[float]] = defaultdict(list)
    for arms in blocks.values():
        opponent_ids = {row["opponentId"] for values in arms.values() for row in values}
        if len(opponent_ids) != 1:
            raise ValueError("one block contains multiple opponents")
        opponent_id = next(iter(opponent_ids))
        candidate = np.mean([float(row["won"]) for row in arms["candidate"]])
        baseline = np.mean([float(row["won"]) for row in arms["v4"]])
        by_opponent[opponent_id].append(float(candidate - baseline))

    opponent_means = {key: float(np.mean(values)) for key, values in by_opponent.items()}
    observed = float(np.mean(list(opponent_means.values())))
    rng = np.random.default_rng(seed)
    samples = np.empty(bootstrap_samples, dtype=np.float64)
    ordered = sorted(by_opponent)
    for index in range(bootstrap_samples):
        stratum_means = []
        for opponent_id in ordered:
            values = np.asarray(by_opponent[opponent_id], dtype=np.float64)
            selected = rng.integers(0, len(values), size=len(values))
            stratum_means.append(float(values[selected].mean()))
        samples[index] = np.mean(stratum_means)
    return {
        "estimate": observed,
        "ci95": [float(np.quantile(samples, 0.025)), float(np.quantile(samples, 0.975))],
        "bootstrapSamples": bootstrap_samples,
        "bootstrapSeed": seed,
        "effectiveBlocks": len(blocks),
        "opponentEqualWeight": True,
        "byOpponent": opponent_means,
    }


def rate(rows: list[dict[str, Any]], arm: str, kind: str) -> dict[str, Any]:
    selected = [row for row in rows if row.get("kind") == kind and row.get("arm") == arm]
    wins = sum(bool(row.get("won")) for row in selected)
    return {
        "wins": wins,
        "total": len(selected),
        "rate": wins / len(selected) if selected else None,
        "wilson95Auxiliary": wilson_interval(wins, len(selected)),
    }


def summarize(rows: list[dict[str, Any]], *, bootstrap_samples: int = 10_000, seed: int = 20260903) -> dict[str, Any]:
    rallies = [row for row in rows if row.get("kind") == "rally"]
    generalization_rows = [row for row in rows if not row.get("benchmarkOnly", False)]
    benchmark_rows = [row for row in rows if row.get("benchmarkOnly", False)]
    causes = {
        arm: dict(Counter(row.get("lossCause") or "none" for row in rallies if row.get("arm") == arm))
        for arm in ("candidate", "v4")
    }
    serve_breakdown = {
        arm: {
            ("candidateServed" if served else "opponentServed"): rate(
                [row for row in rallies if bool(row.get("candidateServed")) == served], arm, "rally"
            )
            for served in (True, False)
        }
        for arm in ("candidate", "v4")
    }
    self_destruction = {}
    self_causes = {"self_touch_limit", "untouched_self_serve_ground_on_own_half", "self_last_touch_then_own_ground"}
    for arm in ("candidate", "v4"):
        arm_rallies = [row for row in rallies if row["arm"] == arm]
        losses = [row for row in arm_rallies if not row.get("won")]
        count = sum(row.get("lossCause") in self_causes for row in losses)
        self_destruction[arm] = {
            "count": count,
            "losses": len(losses),
            "rateAmongLosses": count / len(losses) if losses else None,
        }
    breakdown = {}
    for opponent_id in sorted({row["opponentId"] for row in rows}):
        breakdown[opponent_id] = {}
        for side in ("LEFT", "RIGHT"):
            subset = [row for row in rows if row.get("opponentId") == opponent_id and row.get("side") == side]
            breakdown[opponent_id][side] = {
                arm: {
                    "matches": rate(subset, arm, "match"),
                    "rallies": rate(subset, arm, "rally"),
                }
                for arm in ("candidate", "v4")
            }
    return {
        "schemaVersion": 1,
        "primary": {
            "metric": "non-benchmark opponent-equal-weight paired match-win-rate delta",
            **paired_macro_delta(generalization_rows, bootstrap_samples=bootstrap_samples, seed=seed),
        },
        "benchmarkPaired": {
            "metric": "benchmark-only paired match-win-rate delta",
            **paired_macro_delta(benchmark_rows, bootstrap_samples=bootstrap_samples, seed=seed + 1),
        } if any(row.get("kind") == "match" for row in benchmark_rows) else None,
        "candidate": {"matches": rate(rows, "candidate", "match"), "rallies": rate(rows, "candidate", "rally")},
        "v4": {"matches": rate(rows, "v4", "match"), "rallies": rate(rows, "v4", "rally")},
        "meanRallyFrames": {
            arm: float(np.mean([row["frames"] for row in rallies if row["arm"] == arm]))
            if any(row["arm"] == arm for row in rallies) else None
            for arm in ("candidate", "v4")
        },
        "lossCauses": causes,
        "selfDestruction": self_destruction,
        "serveBreakdown": serve_breakdown,
        "breakdown": breakdown,
        "notes": [
            "Primary CI resamples seed/opponent blocks; Wilson intervals are auxiliary only.",
            "A block keeps both arms, both sides, persistent games, and their rallies together.",
        ],
    }


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--bootstrap-samples", type=int, default=10_000)
    parser.add_argument("--seed", type=int, default=20260903)
    args = parser.parse_args()
    result = summarize(read_jsonl(args.input), bootstrap_samples=args.bootstrap_samples, seed=args.seed)
    encoded = json.dumps(result, ensure_ascii=False, indent=2) + "\n"
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded, encoding="utf-8")
    print(encoded, end="")


if __name__ == "__main__":
    main()
