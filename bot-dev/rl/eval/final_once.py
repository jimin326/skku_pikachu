"""One-shot guard for an externally held sealed-final split manifest."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path


def sha256(path: Path) -> str:
    return hashlib.sha256(path.read_bytes()).hexdigest()


def normalized_sha256(path: Path) -> str:
    source = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def atomic_json(path: Path, payload: dict) -> None:
    temporary = path.with_name(path.name + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, path)


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--commitment", type=Path, required=True)
    parser.add_argument("--manifest", type=Path, required=True)
    parser.add_argument("--registry", type=Path, required=True)
    parser.add_argument("--candidate", type=Path, required=True)
    parser.add_argument("--output-dir", type=Path, required=True)
    parser.add_argument("--games-per-series", type=int, default=3)
    parser.add_argument("--dry-run", action="store_true")
    args = parser.parse_args()

    commitment = json.loads(args.commitment.read_text(encoding="utf-8"))
    if sha256(args.manifest) != commitment["manifestSha256"]:
        raise ValueError("sealed-final manifest does not match its prior commitment")
    if normalized_sha256(args.candidate) != commitment["candidateSha256Normalized"]:
        raise ValueError("candidate changed after final commitment")
    started = args.output_dir / "FINAL_STARTED.json"
    if started.exists():
        raise RuntimeError(f"final evaluation already started: {started}")
    if not args.dry_run:
        root = Path(__file__).resolve().parents[3]
        dirty = subprocess.check_output(
            ["git", "-c", f"safe.directory={root}", "-C", str(root), "status", "--porcelain"],
            text=True,
        ).strip()
        if dirty:
            raise RuntimeError("actual sealed final requires a clean worktree")

    args.output_dir.mkdir(parents=True, exist_ok=True)
    atomic_json(started, {
        "startedAt": datetime.now(timezone.utc).isoformat(),
        "candidateSha256Normalized": commitment["candidateSha256Normalized"],
        "manifestSha256": commitment["manifestSha256"],
        "dryRun": args.dry_run,
    })
    if args.dry_run:
        print(json.dumps({"status": "DRY_RUN_GUARD_PASS", "started": str(started)}))
        return

    raw = args.output_dir / "final.jsonl"
    runner = Path(__file__).with_name("paired_eval.mjs")
    stats = Path(__file__).with_name("stats.py")
    try:
        subprocess.run([
            "node", str(runner), f"--candidate={args.candidate.resolve()}",
            f"--registry={args.registry.resolve()}", f"--split={args.manifest.resolve()}",
            f"--games-per-series={args.games_per_series}", f"--output={raw}",
        ], check=True)
        subprocess.run([
            sys.executable, str(stats), str(raw), "--output", str(args.output_dir / "final_stats.json")
        ], check=True)
        atomic_json(args.output_dir / "FINAL_COMPLETE.json", {
            "completedAt": datetime.now(timezone.utc).isoformat(),
            "rawSha256": sha256(raw),
            "statsSha256": sha256(args.output_dir / "final_stats.json"),
        })
    except BaseException as error:
        atomic_json(args.output_dir / "FINAL_ABORTED.json", {
            "abortedAt": datetime.now(timezone.utc).isoformat(), "error": repr(error)
        })
        raise


if __name__ == "__main__":
    main()
