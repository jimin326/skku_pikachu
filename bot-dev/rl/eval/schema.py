"""Fail-closed opponent and split manifest validation."""

from __future__ import annotations

import hashlib
import json
from pathlib import Path
from typing import Any


ALLOWED_KINDS = {"javascript", "builtin", "fixed", "checkpoint"}


def load_json(path: Path) -> dict[str, Any]:
    return json.loads(path.read_text(encoding="utf-8"))


def normalized_sha256(path: Path) -> str:
    source = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def validate_registry(path: Path) -> dict[str, dict[str, Any]]:
    raw = load_json(path)
    if raw.get("schemaVersion") != 1:
        raise ValueError("unsupported opponent registry schemaVersion")
    entries: dict[str, dict[str, Any]] = {}
    for entry in raw.get("opponents", []):
        opponent_id = entry.get("id")
        if not opponent_id or opponent_id in entries:
            raise ValueError(f"missing or duplicate opponent id: {opponent_id!r}")
        if not entry.get("familyId"):
            raise ValueError(f"{opponent_id}: familyId is required")
        if entry.get("kind") not in ALLOWED_KINDS:
            raise ValueError(f"{opponent_id}: unsupported kind {entry.get('kind')!r}")
        if entry["kind"] in {"javascript", "checkpoint"}:
            source = (path.parent / entry["path"]).resolve()
            if not source.is_file():
                raise FileNotFoundError(f"{opponent_id}: {source}")
            actual = normalized_sha256(source)
            if actual != entry.get("sha256Normalized"):
                raise ValueError(f"{opponent_id}: source hash mismatch")
        if entry["kind"] == "fixed" and entry.get("policy") not in {"neutral", "chase"}:
            raise ValueError(f"{opponent_id}: unknown fixed policy")
        entries[opponent_id] = entry
    if not entries:
        raise ValueError("opponent registry is empty")
    return entries


def validate_split(path: Path, registry: dict[str, dict[str, Any]]) -> dict[str, Any]:
    split = load_json(path)
    if split.get("schemaVersion") != 1 or not split.get("name"):
        raise ValueError(f"invalid split manifest: {path}")
    ids = list(split.get("opponents", [])) + list(split.get("benchmarkOpponents", []))
    if len(ids) != len(set(ids)):
        raise ValueError(f"{split['name']}: duplicate opponent")
    unknown = sorted(set(ids) - registry.keys())
    if unknown:
        raise ValueError(f"{split['name']}: unknown opponents {unknown}")
    seeds = split.get("seeds", [])
    if not seeds or len(seeds) != len(set(seeds)) or not all(isinstance(x, int) for x in seeds):
        raise ValueError(f"{split['name']}: seeds must be unique integers")
    return split


def assert_disjoint(
    train: dict[str, Any], validation: dict[str, Any], registry: dict[str, dict[str, Any]]
) -> None:
    if set(train["seeds"]) & set(validation["seeds"]):
        raise ValueError("train/validation seed overlap")
    train_families = {registry[item]["familyId"] for item in train.get("opponents", [])}
    validation_families = {
        registry[item]["familyId"] for item in validation.get("opponents", [])
    }
    overlap = train_families & validation_families
    if overlap:
        raise ValueError(f"train/validation family overlap: {sorted(overlap)}")
    for item in validation.get("benchmarkOpponents", []):
        if not registry[item].get("benchmarkOnly"):
            raise ValueError(f"{item}: benchmark split exception must be benchmarkOnly")


def validate_default_manifests(root: Path | None = None) -> dict[str, Any]:
    base = root or Path(__file__).resolve().parent
    registry = validate_registry(base / "opponents.json")
    train = validate_split(base / "splits" / "train.json", registry)
    validation = validate_split(base / "splits" / "validation.json", registry)
    assert_disjoint(train, validation, registry)
    return {"registry": registry, "train": train, "validation": validation}


if __name__ == "__main__":
    result = validate_default_manifests()
    print(
        json.dumps(
            {
                "status": "PASS",
                "opponents": len(result["registry"]),
                "trainSeeds": len(result["train"]["seeds"]),
                "validationSeeds": len(result["validation"]["seeds"]),
            }
        )
    )
