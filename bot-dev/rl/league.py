"""Register immutable exported checkpoints for later self-play runs."""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import shutil
from pathlib import Path


def normalized_hash(path: Path) -> str:
    source = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def register(manifest: Path, bot: Path, run_id: str, step: int) -> dict:
    manifest = manifest.resolve()
    bot = bot.resolve()
    digest = normalized_hash(bot)
    destination_dir = manifest.parent / "bots"
    destination_dir.mkdir(parents=True, exist_ok=True)
    destination = destination_dir / f"{run_id}_{step:09d}_{digest[:12]}.js"
    if not destination.exists():
        shutil.copyfile(bot, destination)
    payload = json.loads(manifest.read_text(encoding="utf-8")) if manifest.exists() else {
        "schemaVersion": 1, "entries": []
    }
    entry = {
        "id": f"league_{run_id}_{step:09d}",
        "familyId": f"selfplay_{run_id}",
        "kind": "checkpoint",
        "path": str(destination.relative_to(manifest.parent)).replace("\\", "/"),
        "sha256Normalized": digest,
        "trainingStep": step,
        "runId": run_id,
    }
    existing = {item["id"]: item for item in payload["entries"]}
    if entry["id"] in existing and existing[entry["id"]] != entry:
        raise ValueError(f"league id collision: {entry['id']}")
    existing[entry["id"]] = entry
    payload["entries"] = sorted(existing.values(), key=lambda item: (item["runId"], item["trainingStep"]))
    temporary = manifest.with_name(manifest.name + ".tmp")
    temporary.write_text(json.dumps(payload, indent=2) + "\n", encoding="utf-8")
    os.replace(temporary, manifest)
    return entry


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("manifest", type=Path)
    parser.add_argument("bot", type=Path)
    parser.add_argument("--run-id", required=True)
    parser.add_argument("--step", type=int, required=True)
    args = parser.parse_args()
    print(json.dumps(register(args.manifest, args.bot, args.run_id, args.step), indent=2))


if __name__ == "__main__":
    main()
