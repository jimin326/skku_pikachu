"""Episode-held-out diagnostics for a v4 behavior-cloning dataset and policy.

Separates two failure hypotheses that plain training accuracy cannot:

* teacher hidden-state aliasing -> the same (quantized) observation carries
  different teacher actions inside the dataset itself.  Measured as the label
  conflict rate / conditional entropy H(action | observation bucket) and the
  resulting accuracy ceiling, for 1, 2 and 4 stacked frames.
* covariate shift -> held-out accuracy on teacher states is high, yet the
  learner still fails in rollouts.  That half is measured by
  eval/teacher_shadow.mjs on learner-visited states, not here.

Usage:
  python bot-dev/rl/bc_diagnostics.py DATASET.jsonl --model bc.pt --output diag.json
  python bot-dev/rl/bc_diagnostics.py DATASET.jsonl --train-epochs 10 --output diag.json
"""

from __future__ import annotations

import argparse
import json
import math
import sys
from collections import Counter, defaultdict
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))

from config_actions import ACTION_LABELS, FEATURES_PER_FRAME, FRAME_STACK  # noqa: E402

TEACHER_SHA = "408bf16e4f986f893a4a5dabc749d7d494657a14811544eddcbe82c9e58bc17f"


def load_rows(path: Path, limit: int | None = None):
    observations, actions, episodes, sides, opponents = [], [], [], [], []
    with path.open("r", encoding="utf-8") as source:
        for line in source:
            if not line.strip():
                continue
            row = json.loads(line)
            observations.append(row["observation"])
            actions.append(int(row["action"]))
            episodes.append(int(row.get("episodeId", 0)))
            sides.append(row.get("side", "?"))
            opponents.append(row.get("opponentId", "?"))
            if limit and len(actions) >= limit:
                break
    if not actions:
        raise ValueError("dataset is empty")
    return (
        np.asarray(observations, dtype=np.float32),
        np.asarray(actions, dtype=np.int64),
        np.asarray(episodes, dtype=np.int64),
        np.asarray(sides),
        np.asarray(opponents),
    )


def episode_split(episodes: np.ndarray, heldout_fraction: float, seed: int):
    unique = np.unique(episodes)
    rng = np.random.default_rng(seed)
    permuted = rng.permutation(unique)
    heldout_count = max(1, int(round(len(unique) * heldout_fraction)))
    heldout_ids = set(permuted[:heldout_count].tolist())
    heldout_mask = np.asarray([episode in heldout_ids for episode in episodes], dtype=bool)
    return ~heldout_mask, heldout_mask, sorted(heldout_ids)


def histogram(actions: np.ndarray, action_count: int = 18) -> dict:
    counts = np.bincount(actions, minlength=action_count)
    return {
        ACTION_LABELS[i]: {"index": i, "count": int(counts[i]), "fraction": float(counts[i] / len(actions))}
        for i in range(action_count)
    }


def confusion(true: np.ndarray, predicted: np.ndarray, action_count: int = 18) -> list[list[int]]:
    matrix = np.zeros((action_count, action_count), dtype=np.int64)
    np.add.at(matrix, (true, predicted), 1)
    return matrix.tolist()


def per_action_metrics(true: np.ndarray, predicted: np.ndarray, action_count: int = 18) -> dict:
    result = {}
    for index in range(action_count):
        support = int((true == index).sum())
        tp = int(((true == index) & (predicted == index)).sum())
        predicted_count = int((predicted == index).sum())
        result[ACTION_LABELS[index]] = {
            "index": index,
            "support": support,
            "recall": tp / support if support else None,
            "precision": tp / predicted_count if predicted_count else None,
        }
    return result


def aliasing(observations: np.ndarray, actions: np.ndarray, *, frames: int, decimals: int) -> dict:
    """Label ambiguity of the teacher given only the last `frames` stacked frames."""
    start = (FRAME_STACK - frames) * FEATURES_PER_FRAME
    view = observations[:, start:]
    quantized = np.round(view, decimals)
    keys = [q.tobytes() for q in quantized]
    groups: dict[bytes, Counter] = defaultdict(Counter)
    for key, action in zip(keys, actions):
        groups[key][int(action)] += 1
    total = len(actions)
    conflicting_samples = 0
    ceiling_correct = 0
    conditional_entropy = 0.0
    duplicate_samples = 0
    for counter in groups.values():
        size = sum(counter.values())
        majority = max(counter.values())
        ceiling_correct += majority
        if len(counter) > 1:
            conflicting_samples += size
        if size > 1:
            duplicate_samples += size
        for count in counter.values():
            p = count / size
            conditional_entropy -= (size / total) * p * math.log2(p)
    return {
        "frames": frames,
        "decimals": decimals,
        "samples": total,
        "uniqueBuckets": len(groups),
        "duplicateSampleFraction": duplicate_samples / total,
        "conflictSampleFraction": conflicting_samples / total,
        "conditionalEntropyBits": conditional_entropy,
        "accuracyCeiling": ceiling_correct / total,
        "note": "accuracyCeiling is the best any deterministic map from this observation view can reach on these samples; "
        "it is optimistic for unseen data because singleton buckets count as perfectly predictable",
    }


def evaluate_model(model_path: Path, observations: np.ndarray, actions: np.ndarray, device: str) -> tuple[np.ndarray, dict]:
    import torch

    from ppo_train import ActorCritic

    saved = torch.load(model_path, map_location="cpu", weights_only=False)
    model = ActorCritic(observations.shape[1], 18)
    model.load_state_dict(saved["model"])
    model.to(device).eval()
    predictions = np.empty(len(actions), dtype=np.int64)
    nll = 0.0
    with torch.inference_mode():
        for start in range(0, len(actions), 8192):
            batch = torch.as_tensor(observations[start : start + 8192], device=device)
            logits, _ = model(batch)
            log_probs = torch.log_softmax(logits, dim=-1)
            target = torch.as_tensor(actions[start : start + 8192], device=device)
            nll += float(-log_probs.gather(1, target[:, None]).sum().item())
            predictions[start : start + 8192] = logits.argmax(dim=-1).cpu().numpy()
    return predictions, {"crossEntropy": nll / len(actions), "globalStep": int(saved.get("global_step", 0))}


def train_heldout(observations, actions, train_mask, heldout_mask, *, epochs, seed, device, batch_size=1024, lr=3e-4):
    """Re-train the same FF policy on train episodes only and report the held-out curve."""
    import torch
    from torch import nn

    from ppo_train import ActorCritic

    torch.manual_seed(seed)
    rng = np.random.default_rng(seed)
    model = ActorCritic(observations.shape[1], 18).to(device)
    optimizer = torch.optim.Adam(model.parameters(), lr=lr)
    train_obs, train_act = observations[train_mask], actions[train_mask]
    held_obs = torch.as_tensor(observations[heldout_mask], device=device)
    held_act = torch.as_tensor(actions[heldout_mask], device=device)
    curve = []
    for epoch in range(epochs):
        permutation = rng.permutation(len(train_act))
        total_loss, correct = 0.0, 0
        model.train()
        for start in range(0, len(train_act), batch_size):
            indices = permutation[start : start + batch_size]
            batch_obs = torch.as_tensor(train_obs[indices], device=device)
            batch_act = torch.as_tensor(train_act[indices], device=device)
            logits, _ = model(batch_obs)
            loss = nn.functional.cross_entropy(logits, batch_act)
            optimizer.zero_grad(set_to_none=True)
            loss.backward()
            optimizer.step()
            total_loss += float(loss.item()) * len(indices)
            correct += int((logits.argmax(dim=-1) == batch_act).sum().item())
        model.eval()
        with torch.inference_mode():
            logits, _ = model(held_obs)
            held_loss = float(nn.functional.cross_entropy(logits, held_act).item())
            held_acc = float((logits.argmax(dim=-1) == held_act).float().mean().item())
        curve.append({
            "epoch": epoch + 1,
            "trainCrossEntropy": total_loss / len(train_act),
            "trainAccuracy": correct / len(train_act),
            "heldoutCrossEntropy": held_loss,
            "heldoutAccuracy": held_acc,
        })
        print(json.dumps(curve[-1]), flush=True)
    with torch.inference_mode():
        predictions = model(held_obs)[0].argmax(dim=-1).cpu().numpy()
    return curve, predictions


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("dataset", type=Path)
    parser.add_argument("--model", type=Path, default=None, help="BC checkpoint to score on held-out episodes")
    parser.add_argument("--train-epochs", type=int, default=0, help="re-train on train episodes and report held-out curve")
    parser.add_argument("--heldout-fraction", type=float, default=0.2)
    parser.add_argument("--seed", type=int, default=20260903)
    parser.add_argument("--decimals", type=int, default=2, help="observation rounding for the aliasing buckets")
    parser.add_argument("--limit", type=int, default=0, help="read at most N rows (smoke tests)")
    parser.add_argument("--device", default="cpu")
    parser.add_argument("--output", type=Path, default=None)
    args = parser.parse_args()

    metadata_path = Path(str(args.dataset) + ".meta.json")
    metadata = json.loads(metadata_path.read_text(encoding="utf-8")) if metadata_path.is_file() else {}
    if metadata and metadata.get("teacherSha256Normalized") != TEACHER_SHA:
        raise ValueError("dataset teacher is not the frozen v4 source")

    observations, actions, episodes, sides, opponents = load_rows(args.dataset, args.limit or None)
    train_mask, heldout_mask, heldout_ids = episode_split(episodes, args.heldout_fraction, args.seed)
    held_actions = actions[heldout_mask]
    train_counts = np.bincount(actions[train_mask], minlength=18)
    majority_action = int(train_counts.argmax())

    report: dict = {
        "schemaVersion": 1,
        "dataset": str(args.dataset.resolve()),
        "datasetMeta": metadata,
        "samples": int(len(actions)),
        "episodes": int(len(np.unique(episodes))),
        "split": {
            "unit": "episode (full match, LEFT/RIGHT alternating in collect_bc.mjs)",
            "heldoutFraction": args.heldout_fraction,
            "seed": args.seed,
            "trainSamples": int(train_mask.sum()),
            "heldoutSamples": int(heldout_mask.sum()),
            "heldoutEpisodeIds": heldout_ids,
        },
        "actionHistogram": {"all": histogram(actions), "heldout": histogram(held_actions)},
        "bySide": {side: int((sides == side).sum()) for side in np.unique(sides)},
        "byOpponent": {opp: int((opponents == opp).sum()) for opp in np.unique(opponents)},
        "majorityBaseline": {
            "action": ACTION_LABELS[majority_action],
            "index": majority_action,
            "heldoutAccuracy": float((held_actions == majority_action).mean()),
        },
        "aliasing": [aliasing(observations, actions, frames=frames, decimals=args.decimals) for frames in (1, 2, 4)],
    }

    if args.model:
        predictions, extra = evaluate_model(args.model, observations[heldout_mask], held_actions, args.device)
        train_predictions, train_extra = evaluate_model(args.model, observations[train_mask], actions[train_mask], args.device)
        report["model"] = {
            "path": str(args.model.resolve()),
            **extra,
            "heldoutAccuracy": float((predictions == held_actions).mean()),
            "trainAccuracy": float((train_predictions == actions[train_mask]).mean()),
            "trainCrossEntropy": train_extra["crossEntropy"],
            "perAction": per_action_metrics(held_actions, predictions),
            "confusionMatrix": {"rows": "true action index", "cols": "predicted action index", "matrix": confusion(held_actions, predictions)},
            "caveat": "if this model was trained on the whole dataset, the held-out episodes were seen during training; "
            "use --train-epochs for a clean held-out estimate",
        }
    if args.train_epochs > 0:
        curve, predictions = train_heldout(
            observations, actions, train_mask, heldout_mask, epochs=args.train_epochs, seed=args.seed, device=args.device
        )
        report["heldoutRetrain"] = {
            "curve": curve,
            "finalHeldoutAccuracy": float((predictions == held_actions).mean()),
            "perAction": per_action_metrics(held_actions, predictions),
            "confusionMatrix": {"rows": "true action index", "cols": "predicted action index", "matrix": confusion(held_actions, predictions)},
        }

    encoded = json.dumps(report, ensure_ascii=False, indent=2)
    if args.output:
        args.output.parent.mkdir(parents=True, exist_ok=True)
        args.output.write_text(encoded + "\n", encoding="utf-8")
    summary = {
        "samples": report["samples"],
        "episodes": report["episodes"],
        "majorityHeldoutAccuracy": report["majorityBaseline"]["heldoutAccuracy"],
        "aliasingCeiling4f": report["aliasing"][2]["accuracyCeiling"],
        "aliasingConflict4f": report["aliasing"][2]["conflictSampleFraction"],
        "modelHeldoutAccuracy": report.get("model", {}).get("heldoutAccuracy"),
        "retrainHeldoutAccuracy": report.get("heldoutRetrain", {}).get("finalHeldoutAccuracy"),
        "output": str(args.output) if args.output else None,
    }
    print(json.dumps(summary, ensure_ascii=False))


if __name__ == "__main__":
    main()
