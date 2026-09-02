"""Behavior-clone the frozen v4 teacher into the feed-forward policy."""

from __future__ import annotations

import argparse
import hashlib
import json
import random
from pathlib import Path

import numpy as np
import torch
from torch import nn

from ppo_train import ActorCritic


def load_dataset(path: Path) -> tuple[np.ndarray, np.ndarray, dict]:
    observations, actions = [], []
    with path.open("r", encoding="utf-8") as source:
        for line in source:
            if not line.strip():
                continue
            row = json.loads(line)
            observations.append(row["observation"])
            actions.append(row["action"])
    if not observations:
        raise ValueError("BC dataset is empty")
    metadata_path = Path(str(path) + ".meta.json")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8"))
    if metadata.get("teacherSha256Normalized") != "408bf16e4f986f893a4a5dabc749d7d494657a14811544eddcbe82c9e58bc17f":
        raise ValueError("BC teacher is not the frozen v4 source")
    dataset_hash = hashlib.sha256(path.read_bytes()).hexdigest()
    return np.asarray(observations, dtype=np.float32), np.asarray(actions, dtype=np.int64), {
        **metadata, "datasetSha256": dataset_hash
    }


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("dataset", type=Path)
    parser.add_argument("output", type=Path)
    parser.add_argument("--epochs", type=int, default=10)
    parser.add_argument("--batch-size", type=int, default=1024)
    parser.add_argument("--learning-rate", type=float, default=3e-4)
    parser.add_argument("--seed", type=int, default=20260903)
    parser.add_argument("--device", default="auto")
    args = parser.parse_args()

    random.seed(args.seed)
    np.random.seed(args.seed)
    torch.manual_seed(args.seed)
    device_name = "cuda" if args.device == "auto" and torch.cuda.is_available() else (
        "cpu" if args.device == "auto" else args.device
    )
    device = torch.device(device_name)
    observations, actions, metadata = load_dataset(args.dataset.resolve())
    model = ActorCritic(observations.shape[1], 18).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=args.learning_rate)
    rng = np.random.default_rng(args.seed)
    for epoch in range(args.epochs):
        permutation = rng.permutation(len(actions))
        losses, correct = [], 0
        for start in range(0, len(actions), args.batch_size):
            indices = permutation[start : start + args.batch_size]
            batch_obs = torch.as_tensor(observations[indices], device=device)
            batch_actions = torch.as_tensor(actions[indices], device=device)
            logits, _ = model(batch_obs)
            loss = nn.functional.cross_entropy(logits, batch_actions)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            losses.append(float(loss.item()) * len(indices))
            correct += int((logits.argmax(dim=-1) == batch_actions).sum().item())
        print(json.dumps({
            "epoch": epoch + 1,
            "crossEntropy": sum(losses) / len(actions),
            "accuracy": correct / len(actions),
        }), flush=True)

    args.output.parent.mkdir(parents=True, exist_ok=True)
    torch.save({
        "model": model.state_dict(),
        "modelSpec": {"kind": "ff", "observationSize": observations.shape[1], "actionCount": 18},
        "bc": metadata,
        "trainingSeed": args.seed,
    }, args.output)
    print(json.dumps({"output": str(args.output.resolve()), "samples": len(actions), "device": str(device)}))


if __name__ == "__main__":
    main()
