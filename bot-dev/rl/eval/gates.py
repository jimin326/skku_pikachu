"""Pre-registered validation gates and the checkpoint-selection ordering.

Two levels are distinguished on purpose:

* ``selectable``  - what the training loop may keep as "best so far" (runtime
  and invalid-action sanity, no self-destruction blow-up).  Ranking among
  selectable checkpoints uses ``selection_key``.
* ``submission``  - the full acceptance bar from RL_PIPELINE_HANDOFF
  (v4-direct block-cluster CI lower bound > 0, every non-benchmark opponent x
  side CI lower bound >= -0.05, self-destruction, runtime).  Nothing is copied
  to src/code-here unless this level passes.

Thresholds are explicit dataclass fields so an ablation plan can cite them.
"""

from __future__ import annotations

import json
from collections import defaultdict
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import numpy as np


@dataclass
class GateThresholds:
    # Hard submission requirements (handoff success criteria).
    benchmark_ci_lower_min: float = 0.0          # v4-direct paired delta CI lower bound must exceed this
    per_side_ci_lower_min: float = -0.05         # each non-benchmark opponent x side paired delta CI lower bound
    primary_ci_lower_min: float = -0.05          # non-benchmark opponent-equal-weight delta CI lower bound
    # Self-destruction among losses; v4 measured 2.04% on the same set.
    self_destruction_max: float = 0.10
    self_destruction_selectable_max: float = 0.25
    # Runtime.  These are the numbers already fixed in bot-dev/rl/ACCEPTANCE.md
    # section 4 (Node compute-only decide() on the 5,000-snapshot corpus).
    # Do not loosen them here; ACCEPTANCE.md is the pre-registered source.
    runtime_p95_ns: int = 125_000                # 125 us  (v4 measured 60.4-62.5 us)
    runtime_p99_ns: int = 1_000_000              # 1 ms    (v4 measured 101-154 us)
    runtime_max_ns: int = 10_000_000             # 10 ms   (v4 measured 1.13 ms)
    runtime_raw_max_bytes: int = 1_048_576       # 1 MiB raw JavaScript
    runtime_heap_max_bytes: int = 10_485_760     # 10 MiB steady-state heap growth
    invalid_actions_max: int = 0


def per_opponent_side_deltas(rows: list[dict[str, Any]], *, bootstrap_samples: int = 10_000, seed: int = 20260905) -> dict:
    """Paired candidate-v4 match delta per opponent x side, bootstrapped over seed blocks."""
    cells: dict[tuple[str, str], dict[int, dict[str, list[float]]]] = defaultdict(lambda: defaultdict(lambda: defaultdict(list)))
    for row in rows:
        if row.get("kind") != "match":
            continue
        cells[(row["opponentId"], row["side"])][int(row["seed"])][row["arm"]].append(float(row["won"]))
    rng = np.random.default_rng(seed)
    result: dict[str, dict[str, Any]] = {}
    for (opponent_id, side), by_seed in sorted(cells.items()):
        deltas = []
        for arms in by_seed.values():
            if "candidate" not in arms or "v4" not in arms:
                raise ValueError(f"unpaired block for {opponent_id}/{side}")
            deltas.append(float(np.mean(arms["candidate"]) - np.mean(arms["v4"])))
        values = np.asarray(deltas, dtype=np.float64)
        samples = np.empty(bootstrap_samples)
        for index in range(bootstrap_samples):
            samples[index] = values[rng.integers(0, len(values), size=len(values))].mean()
        result.setdefault(opponent_id, {})[side] = {
            "estimate": float(values.mean()),
            "ci95": [float(np.quantile(samples, 0.025)), float(np.quantile(samples, 0.975))],
            "blocks": int(len(values)),
            "benchmarkOnly": any(row.get("benchmarkOnly") for row in rows if row.get("opponentId") == opponent_id),
        }
    return result


def evaluate_gates(
    stats: dict[str, Any],
    *,
    rows: list[dict[str, Any]] | None = None,
    runtime: dict[str, Any] | None = None,
    thresholds: GateThresholds | None = None,
) -> dict[str, Any]:
    t = thresholds or GateThresholds()
    gates: dict[str, dict[str, Any]] = {}

    primary = stats.get("primary") or {}
    primary_lower = float(primary.get("ci95", [float("nan")])[0]) if primary else float("nan")
    gates["primary_ci_lower"] = {"value": primary_lower, "threshold": t.primary_ci_lower_min, "pass": primary_lower >= t.primary_ci_lower_min}

    benchmark = stats.get("benchmarkPaired") or None
    benchmark_lower = float(benchmark["ci95"][0]) if benchmark else float("nan")
    gates["benchmark_ci_lower"] = {
        "value": benchmark_lower,
        "threshold": t.benchmark_ci_lower_min,
        "pass": bool(benchmark) and benchmark_lower > t.benchmark_ci_lower_min,
        "note": "v4 vs v4 rallies are decided by the server on this validation set; a candidate must return v4's serve to move this metric",
    }

    side_deltas = per_opponent_side_deltas(rows) if rows else {}
    worst = None
    for opponent_id, sides in side_deltas.items():
        for side, cell in sides.items():
            if cell["benchmarkOnly"]:
                continue
            lower = cell["ci95"][0]
            if worst is None or lower < worst[0]:
                worst = (lower, opponent_id, side)
    gates["per_side_ci_lower"] = {
        "value": worst[0] if worst else float("nan"),
        "worstCell": {"opponentId": worst[1], "side": worst[2]} if worst else None,
        "threshold": t.per_side_ci_lower_min,
        "pass": bool(worst) and worst[0] >= t.per_side_ci_lower_min,
        "cells": side_deltas,
    }

    self_destruction = ((stats.get("selfDestruction") or {}).get("candidate") or {}).get("rateAmongLosses")
    sd_value = float(self_destruction) if self_destruction is not None else 0.0
    gates["self_destruction"] = {"value": sd_value, "threshold": t.self_destruction_max, "pass": sd_value <= t.self_destruction_max}
    gates["self_destruction_selectable"] = {
        "value": sd_value,
        "threshold": t.self_destruction_selectable_max,
        "pass": sd_value <= t.self_destruction_selectable_max,
    }

    if runtime:
        candidate = runtime.get("candidate", runtime)
        # Every ACCEPTANCE.md section 4 limit, each reported individually so a
        # failure names the metric that failed.
        checks = {
            "p95Ns": (candidate.get("p95Ns"), t.runtime_p95_ns),
            "p99Ns": (candidate.get("p99Ns"), t.runtime_p99_ns),
            "maxNs": (candidate.get("maxNs"), t.runtime_max_ns),
            "rawBytes": (candidate.get("rawBytes"), t.runtime_raw_max_bytes),
            "heapDeltaBytes": (candidate.get("heapDeltaBytes"), t.runtime_heap_max_bytes),
            "invalidActions": (candidate.get("invalidActions"), t.invalid_actions_max),
        }
        missing = [key for key, (value, _) in checks.items() if value is None]
        failed = {key: {"value": value, "threshold": limit} for key, (value, limit) in checks.items() if value is not None and value > limit}
        gates["runtime"] = {
            **{key: value for key, (value, _) in checks.items()},
            "gzipBytes": candidate.get("gzipBytes"),
            "failed": failed,
            "missingMetrics": missing,
            # A metric the benchmark did not report cannot be treated as a pass.
            "pass": (not failed) and (not missing),
        }
    else:
        gates["runtime"] = {"pass": None, "note": "runtime benchmark not run"}

    runtime_ok = gates["runtime"]["pass"] is not False
    selectable = runtime_ok and gates["self_destruction_selectable"]["pass"]
    submission = (
        gates["runtime"]["pass"] is True
        and gates["primary_ci_lower"]["pass"]
        and gates["benchmark_ci_lower"]["pass"]
        and gates["per_side_ci_lower"]["pass"]
        and gates["self_destruction"]["pass"]
    )
    candidate_rates = stats.get("candidate") or {}
    return {
        "schemaVersion": 1,
        "thresholds": asdict(t),
        "gates": gates,
        "selectable": bool(selectable),
        "submission": bool(submission),
        "summary": {
            "primaryEstimate": primary.get("estimate"),
            "benchmarkEstimate": benchmark.get("estimate") if benchmark else None,
            "matchWinRate": (candidate_rates.get("matches") or {}).get("rate"),
            "rallyWinRate": (candidate_rates.get("rallies") or {}).get("rate"),
            "selfDestruction": sd_value,
        },
    }


def selection_key(gate_result: dict[str, Any]) -> tuple:
    """Higher is better.  Pre-registered ordering:

    1. selectable (runtime sane, self-destruction not exploding)
    2. submission-level pass
    3. non-benchmark paired delta estimate (generalization first)
    4. v4-direct paired delta estimate
    5. lower self-destruction
    6. candidate rally win rate
    """
    summary = gate_result["summary"]
    return (
        int(bool(gate_result["selectable"])),
        int(bool(gate_result["submission"])),
        float(summary["primaryEstimate"] if summary["primaryEstimate"] is not None else -1.0),
        float(summary["benchmarkEstimate"] if summary["benchmarkEstimate"] is not None else -1.0),
        -float(summary["selfDestruction"]),
        float(summary["rallyWinRate"] or 0.0),
    )


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    return [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines() if line.strip()]


if __name__ == "__main__":
    import argparse

    parser = argparse.ArgumentParser(description="Apply the pre-registered gates to a validation run")
    parser.add_argument("stats", type=Path, help="validation_stats.json from eval/stats.py")
    parser.add_argument("--rows", type=Path, default=None, help="validation.jsonl (for per-side CIs)")
    parser.add_argument("--runtime", type=Path, default=None, help="runtime.json from eval/runtime_bench.mjs")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()
    result = evaluate_gates(
        json.loads(args.stats.read_text(encoding="utf-8")),
        rows=read_jsonl(args.rows) if args.rows else None,
        runtime=json.loads(args.runtime.read_text(encoding="utf-8")) if args.runtime else None,
    )
    result["selectionKey"] = list(selection_key(result))
    encoded = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        args.output.write_text(encoded + "\n", encoding="utf-8")
    print(encoded)
