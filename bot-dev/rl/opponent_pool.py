"""Opponent pool manifest loader shared by training and checkpoint metadata."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


DEFAULT_REGISTRY = Path(__file__).with_name("eval") / "opponents.json"
DEFAULT_TRAIN_SPLIT = Path(__file__).with_name("eval") / "splits" / "train.json"


def _canonical_hash(value: Any) -> str:
    encoded = json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")
    return hashlib.sha256(encoded).hexdigest()


def load_training_pool(
    registry_path: str | Path = DEFAULT_REGISTRY,
    split_path: str | Path = DEFAULT_TRAIN_SPLIT,
    league_manifest: str | Path | None = None,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    registry_path = Path(registry_path).resolve()
    split_path = Path(split_path).resolve()
    registry = json.loads(registry_path.read_text(encoding="utf-8"))
    split = json.loads(split_path.read_text(encoding="utf-8"))
    engine_manifest = json.loads(Path(__file__).with_name("engine_manifest.json").read_text(encoding="utf-8"))
    entries = {item["id"]: item for item in registry["opponents"]}
    pool = []
    for opponent_id in split["opponents"]:
        if opponent_id not in entries:
            raise ValueError(f"unknown training opponent: {opponent_id}")
        item = dict(entries[opponent_id])
        if item.get("benchmarkOnly"):
            raise ValueError(f"benchmark-only opponent cannot enter training: {opponent_id}")
        if item.get("path"):
            item["path"] = str((registry_path.parent / item["path"]).resolve())
        item["poolRole"] = "anchor"
        pool.append(item)
    league = None
    if league_manifest:
        league_path = Path(league_manifest).resolve()
        league = json.loads(league_path.read_text(encoding="utf-8"))
        if league.get("schemaVersion") != 1:
            raise ValueError("unsupported league schemaVersion")
        for raw in league.get("entries", []):
            item = dict(raw)
            item["path"] = str((league_path.parent / item["path"]).resolve())
            item["poolRole"] = "league"
            pool.append(item)
    metadata = {
        "registryPath": str(registry_path),
        "splitPath": str(split_path),
        "splitName": split["name"],
        "opponentIds": [item["id"] for item in pool],
        "familyIds": sorted({item["familyId"] for item in pool}),
        "manifestSha256": _canonical_hash({"registry": registry, "split": split, "league": league}),
        "leagueManifest": str(Path(league_manifest).resolve()) if league_manifest else None,
        "engineCommit": engine_manifest["commit"],
        "engineManifestSha256": _canonical_hash(engine_manifest),
        "teacherV4Sha256Normalized": entries["lion_v4"]["sha256Normalized"],
    }
    return pool, metadata
