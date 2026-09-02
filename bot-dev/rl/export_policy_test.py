"""Numerical parity check between a PyTorch checkpoint and its JS export."""

from __future__ import annotations

import argparse
import hashlib
import json
import subprocess
from pathlib import Path

import numpy as np
import torch

from ppo_train import ActorCritic


def main(checkpoint: Path, javascript: Path, samples: int, seed: int) -> None:
    saved = torch.load(checkpoint, map_location="cpu", weights_only=False)
    model = ActorCritic(92, 18)
    model.load_state_dict(saved["model"])
    model.eval()

    rng = np.random.default_rng(seed)
    observations = rng.normal(0, 0.8, size=(samples, 92)).astype(np.float32)
    with torch.inference_mode():
        expected_logits, _ = model(torch.from_numpy(observations))
    expected = expected_logits.numpy()
    expected_actions = expected.argmax(axis=1)

    probe = Path(__file__).with_name("policy_probe.mjs")
    request = json.dumps({"op": "infer", "observations": observations.tolist()}) + "\n"
    completed = subprocess.run(
        ["node", str(probe), str(javascript)],
        input=request,
        text=True,
        capture_output=True,
        check=True,
    )
    response = json.loads(completed.stdout)
    if not response.get("ok"):
        raise RuntimeError(response.get("error", "JS probe failed"))
    actual = np.asarray([item["logits"] for item in response["results"]], dtype=np.float32)
    actual_actions = np.asarray([item["action"] for item in response["results"]])
    max_abs_error = float(np.max(np.abs(expected - actual)))
    mismatches = int(np.count_nonzero(expected_actions != actual_actions))
    if max_abs_error > 1e-4 or mismatches:
        raise AssertionError(
            f"export parity failed: maxAbsError={max_abs_error}, actionMismatches={mismatches}"
        )

    checkpoint_hash = hashlib.sha256(checkpoint.read_bytes()).hexdigest()
    print(
        json.dumps(
            {
                "status": "PASS",
                "samples": samples,
                "maxAbsLogitError": max_abs_error,
                "actionMismatches": mismatches,
                "checkpointSha256": checkpoint_hash,
            },
            indent=2,
        )
    )


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("checkpoint", type=Path)
    parser.add_argument("javascript", type=Path)
    parser.add_argument("--samples", type=int, default=1024)
    parser.add_argument("--seed", type=int, default=918273)
    args = parser.parse_args()
    main(args.checkpoint.resolve(), args.javascript.resolve(), args.samples, args.seed)
