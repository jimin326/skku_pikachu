"""Evaluate every saved PPO checkpoint of one run on the same paired validation set.

Answers "when did the BC-initialised policy start to forget?" with data instead
of the latest checkpoint only.  For each checkpoint_*.pt (plus an optional step-0
reference such as the BC model) it:

  1. exports the JavaScript bot (export_policy.py),
  2. runs the paired validation (eval/paired_eval.mjs) and eval/stats.py,
  3. applies eval/gates.py,
  4. measures policy drift against an anchor policy on a fixed probe set:
     KL(anchor || ckpt), KL(ckpt || anchor), argmax disagreement, entropy,
  5. appends one JSON line to <output-dir>/sweep.jsonl (resumable: checkpoints
     whose SHA-256 is already recorded are skipped).

A summary (<output-dir>/sweep_summary.json) sorts records by step and marks the
first step where the primary or benchmark estimate drops more than
--collapse-drop below the best earlier value, and where self-destruction first
exceeds the selectable threshold.

Example (Colab, Drive recovery directory of experiment C):
  python bot-dev/rl/checkpoint_sweep.py \
    /content/drive/MyDrive/pikachu_rl/bc_ppo_seed20260903/checkpoints \
    --reference /content/drive/MyDrive/pikachu_rl/bc/v4_500k_ff.pt \
    --anchor /content/drive/MyDrive/pikachu_rl/bc/v4_500k_ff.pt \
    --probe-dataset /content/drive/MyDrive/pikachu_rl/bc/v4_500k.jsonl --probe-limit 20000 \
    --output-dir /content/drive/MyDrive/pikachu_rl/sweeps/bc_ppo_seed20260903
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import re
import subprocess
import sys
import time
from pathlib import Path

import numpy as np
import torch

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "eval"))

from export_policy import export_policy  # noqa: E402
from gates import GateThresholds, evaluate_gates, read_jsonl, selection_key  # noqa: E402
from ppo_train import ActorCritic  # noqa: E402
from stats import summarize  # noqa: E402

STEP_PATTERN = re.compile(r"checkpoint_(\d+)\.pt$")


def sha256_of(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def list_checkpoints(directory: Path, steps: list[int] | None, max_count: int) -> list[tuple[int, Path]]:
    found = []
    for item in sorted(directory.glob("checkpoint_*.pt")):
        match = STEP_PATTERN.search(item.name)
        if match:
            found.append((int(match.group(1)), item))
    found.sort()
    if steps:
        wanted = set(steps)
        found = [entry for entry in found if entry[0] in wanted]
    if max_count and len(found) > max_count:
        indices = np.linspace(0, len(found) - 1, max_count).round().astype(int)
        found = [found[i] for i in sorted(set(indices.tolist()))]
    return found


def load_probe(path: Path | None, limit: int, seed: int) -> np.ndarray | None:
    if not path:
        return None
    rows = []
    with path.open("r", encoding="utf-8") as source:
        for line in source:
            if line.strip():
                rows.append(json.loads(line)["observation"])
            if limit and len(rows) >= limit * 4:
                break
    array = np.asarray(rows, dtype=np.float32)
    if limit and len(array) > limit:
        rng = np.random.default_rng(seed)
        array = array[rng.choice(len(array), size=limit, replace=False)]
    return array


def drift(model_path: Path, anchor_path: Path | None, probe: np.ndarray | None) -> dict | None:
    if anchor_path is None or probe is None:
        return None
    model = ActorCritic(92, 18)
    model.load_state_dict(torch.load(model_path, map_location="cpu", weights_only=False)["model"])
    anchor = ActorCritic(92, 18)
    anchor.load_state_dict(torch.load(anchor_path, map_location="cpu", weights_only=False)["model"])
    model.eval()
    anchor.eval()
    with torch.inference_mode():
        observations = torch.as_tensor(probe)
        logits, _ = model(observations)
        anchor_logits, _ = anchor(observations)
        log_p = torch.log_softmax(logits, dim=-1)
        log_q = torch.log_softmax(anchor_logits, dim=-1)
        kl_anchor_model = (log_q.exp() * (log_q - log_p)).sum(-1)
        kl_model_anchor = (log_p.exp() * (log_p - log_q)).sum(-1)
        entropy = -(log_p.exp() * log_p).sum(-1)
        disagreement = (logits.argmax(-1) != anchor_logits.argmax(-1)).float()
    return {
        "probeSamples": int(len(probe)),
        "klAnchorToModel": float(kl_anchor_model.mean()),
        "klModelToAnchor": float(kl_model_anchor.mean()),
        "argmaxDisagreement": float(disagreement.mean()),
        "entropy": float(entropy.mean()),
    }


def run_validation(candidate: Path, raw_output: Path, split: Path, registry: Path) -> None:
    command = [
        "node",
        str(HERE / "eval" / "paired_eval.mjs"),
        f"--candidate={candidate}",
        f"--output={raw_output}",
        f"--split={split}",
        f"--registry={registry}",
    ]
    subprocess.run(command, cwd=REPO, check=True, stdout=subprocess.DEVNULL)


def run_runtime(candidate: Path, output: Path) -> dict:
    command = ["node", "--expose-gc", str(HERE / "eval" / "runtime_bench.mjs"), f"--candidate={candidate}"]
    completed = subprocess.run(command, cwd=REPO, check=True, capture_output=True, text=True)
    output.write_text(completed.stdout, encoding="utf-8")
    return json.loads(completed.stdout)


def evaluate_one(
    *, label: str, step: int, checkpoint: Path, output_dir: Path, split: Path, registry: Path,
    anchor: Path | None, probe: np.ndarray | None, runtime: bool, thresholds: GateThresholds,
) -> dict:
    work = output_dir / f"step_{step:09d}_{label}"
    work.mkdir(parents=True, exist_ok=True)
    candidate = work / "candidate.js"
    started = time.perf_counter()
    export_meta = export_policy(checkpoint, candidate)
    raw = work / "validation.jsonl"
    run_validation(candidate, raw, split, registry)
    rows = read_jsonl(raw)
    stats = summarize(rows)
    (work / "validation_stats.json").write_text(json.dumps(stats, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    runtime_result = run_runtime(candidate, work / "runtime.json") if runtime else None
    gate_result = evaluate_gates(stats, rows=rows, runtime=runtime_result, thresholds=thresholds)
    (work / "gates.json").write_text(json.dumps(gate_result, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    record = {
        "label": label,
        "step": step,
        "checkpoint": str(checkpoint),
        "checkpointSha256": sha256_of(checkpoint),
        "candidateSha256Normalized": hashlib.sha256(candidate.read_text(encoding="utf-8").replace("\r\n", "\n").encode("utf-8")).hexdigest(),
        "exportMeta": {k: v for k, v in export_meta.items() if k in ("globalStep", "trainingSeed", "checkpointSha256")},
        "primary": {"estimate": stats["primary"]["estimate"], "ci95": stats["primary"]["ci95"], "byOpponent": stats["primary"]["byOpponent"]},
        "benchmark": {"estimate": stats["benchmarkPaired"]["estimate"], "ci95": stats["benchmarkPaired"]["ci95"]} if stats.get("benchmarkPaired") else None,
        "matchWinRate": stats["candidate"]["matches"]["rate"],
        "rallyWinRate": stats["candidate"]["rallies"]["rate"],
        "selfDestruction": stats["selfDestruction"]["candidate"],
        "lossCauses": stats["lossCauses"]["candidate"],
        "meanRallyFrames": stats["meanRallyFrames"]["candidate"],
        "serveBreakdown": stats["serveBreakdown"]["candidate"],
        "drift": drift(checkpoint, anchor, probe),
        "runtime": {k: runtime_result["candidate"].get(k) for k in ("p50Ns", "p99Ns", "maxNs", "gzipBytes", "invalidActions")} if runtime_result else None,
        "selectable": gate_result["selectable"],
        "submission": gate_result["submission"],
        "selectionKey": list(selection_key(gate_result)),
        "workDir": str(work),
        "seconds": round(time.perf_counter() - started, 1),
    }
    return record


def summarize_sweep(records: list[dict], collapse_drop: float, thresholds: GateThresholds) -> dict:
    ordered = sorted(records, key=lambda r: r["step"])
    best_primary = -1.0
    best_benchmark = -1.0
    onset = {"primaryDrop": None, "benchmarkDrop": None, "selfDestructionExceeded": None}
    for record in ordered:
        primary = record["primary"]["estimate"]
        benchmark = record["benchmark"]["estimate"] if record["benchmark"] else None
        if onset["primaryDrop"] is None and primary < best_primary - collapse_drop:
            onset["primaryDrop"] = record["step"]
        if benchmark is not None and onset["benchmarkDrop"] is None and benchmark < best_benchmark - collapse_drop:
            onset["benchmarkDrop"] = record["step"]
        sd = record["selfDestruction"].get("rateAmongLosses") or 0.0
        if onset["selfDestructionExceeded"] is None and sd > thresholds.self_destruction_selectable_max:
            onset["selfDestructionExceeded"] = record["step"]
        best_primary = max(best_primary, primary)
        if benchmark is not None:
            best_benchmark = max(best_benchmark, benchmark)
    best = max(ordered, key=lambda r: tuple(r["selectionKey"])) if ordered else None
    return {
        "schemaVersion": 1,
        "checkpoints": len(ordered),
        "collapseDrop": collapse_drop,
        "onset": onset,
        "best": {"step": best["step"], "label": best["label"], "checkpoint": best.get("checkpoint"), "selectionKey": best["selectionKey"]} if best else None,
        "table": [
            {
                "step": r["step"],
                "label": r["label"],
                "primary": r["primary"]["estimate"],
                "primaryCi": r["primary"]["ci95"],
                "benchmark": r["benchmark"]["estimate"] if r["benchmark"] else None,
                "matchWinRate": r["matchWinRate"],
                "rallyWinRate": r["rallyWinRate"],
                "selfDestruction": r["selfDestruction"].get("rateAmongLosses"),
                "klAnchorToModel": (r["drift"] or {}).get("klAnchorToModel"),
                "argmaxDisagreement": (r["drift"] or {}).get("argmaxDisagreement"),
                "selectable": r["selectable"],
                "submission": r["submission"],
            }
            for r in ordered
        ],
    }


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("checkpoint_dir", type=Path)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--reference", type=Path, default=None, help="step-0 reference model (e.g. BC model)")
    parser.add_argument("--anchor", type=Path, default=None, help="policy to measure drift against (usually the BC model)")
    parser.add_argument("--probe-dataset", type=Path, default=None, help="jsonl with observations for the drift probe")
    parser.add_argument("--probe-limit", type=int, default=20000)
    parser.add_argument("--steps", default="", help="comma-separated global steps to include (default all)")
    parser.add_argument("--max-checkpoints", type=int, default=0, help="evenly subsample to at most N checkpoints")
    parser.add_argument("--split", type=Path, default=HERE / "eval" / "splits" / "validation.json")
    parser.add_argument("--registry", type=Path, default=HERE / "eval" / "opponents.json")
    parser.add_argument("--runtime", action="store_true", help="also run runtime_bench for every checkpoint")
    parser.add_argument("--collapse-drop", type=float, default=0.125, help="drop vs best earlier estimate that marks onset (1 of 8 blocks)")
    parser.add_argument("--seed", type=int, default=20260903)
    args = parser.parse_args()

    split = json.loads(args.split.read_text(encoding="utf-8"))
    if split.get("name") not in ("validation",):
        print(f"WARNING: sweeping on split '{split.get('name')}' — only 'validation' is a legitimate selection set", flush=True)
    args.output_dir.mkdir(parents=True, exist_ok=True)
    log_path = args.output_dir / "sweep.jsonl"
    done = {}
    if log_path.is_file():
        for record in read_jsonl(log_path):
            done[record["checkpointSha256"]] = record
    thresholds = GateThresholds()
    probe = load_probe(args.probe_dataset, args.probe_limit, args.seed)
    steps = [int(item) for item in args.steps.split(",") if item.strip()]
    targets: list[tuple[str, int, Path]] = []
    if args.reference:
        targets.append(("reference", 0, args.reference))
    targets.extend(("ckpt", step, path) for step, path in list_checkpoints(args.checkpoint_dir, steps or None, args.max_checkpoints))
    if not targets:
        raise SystemExit(f"no checkpoints found in {args.checkpoint_dir}")
    records = list(done.values())
    for label, step, checkpoint in targets:
        digest = sha256_of(checkpoint)
        if digest in done:
            print(json.dumps({"skip": str(checkpoint), "step": step, "reason": "already in sweep.jsonl"}), flush=True)
            continue
        record = evaluate_one(
            label=label, step=step, checkpoint=checkpoint, output_dir=args.output_dir, split=args.split,
            registry=args.registry, anchor=args.anchor, probe=probe, runtime=args.runtime, thresholds=thresholds,
        )
        with log_path.open("a", encoding="utf-8") as log:
            log.write(json.dumps(record, ensure_ascii=False) + "\n")
        records.append(record)
        done[digest] = record
        print(json.dumps({k: record[k] for k in ("step", "label", "matchWinRate", "selfDestruction", "selectable", "seconds")} | {"primary": record["primary"]["estimate"], "benchmark": record["benchmark"]["estimate"] if record["benchmark"] else None, "drift": record["drift"]}), flush=True)
        summary = summarize_sweep(records, args.collapse_drop, thresholds)
        temporary = args.output_dir / "sweep_summary.json.tmp"
        temporary.write_text(json.dumps(summary, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
        os.replace(temporary, args.output_dir / "sweep_summary.json")
    print(json.dumps(summarize_sweep(records, args.collapse_drop, thresholds)["onset"]))


if __name__ == "__main__":
    main()
