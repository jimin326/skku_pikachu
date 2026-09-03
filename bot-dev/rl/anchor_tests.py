"""Tests for the BC-preserving PPO options (anchor KL, decay, policy freeze).

Runs a real micro training job through the Node environment, so it needs the
same setup as ppo_tests.py.  Nothing here touches existing checkpoints.
"""

from __future__ import annotations

import json
import shutil
import tempfile
from pathlib import Path

import torch

from ppo_train import ActorCritic, PPOConfig, anchor_coefficient, anchor_kl, train


def test_anchor_kl_zero_for_identical_and_positive_otherwise() -> None:
    torch.manual_seed(0)
    logits = torch.randn(16, 18)
    assert torch.allclose(anchor_kl(logits, logits), torch.zeros(16), atol=1e-6)
    other = logits + torch.randn(16, 18)
    kl = anchor_kl(logits, other)
    assert (kl > 0).all(), kl
    # KL(anchor || pi) is a cross-entropy to the anchor distribution minus a
    # constant, so its gradient pulls pi toward the anchor.
    parameter = other.clone().requires_grad_(True)
    optimizer = torch.optim.Adam([parameter], lr=0.1)
    before = anchor_kl(logits, parameter).mean().item()
    for _ in range(100):
        optimizer.zero_grad()
        loss = anchor_kl(logits, parameter).mean()
        loss.backward()
        optimizer.step()
    after = anchor_kl(logits, parameter).mean().item()
    assert after < before * 0.5, (before, after)


def test_anchor_coefficient_schedule() -> None:
    config = PPOConfig(anchor_kl_coef=1.0, anchor_kl_decay_updates=10, anchor_kl_floor=0.2)
    assert anchor_coefficient(config, 1) == 1.0
    assert abs(anchor_coefficient(config, 6) - 0.6) < 1e-9
    assert abs(anchor_coefficient(config, 11) - 0.2) < 1e-9
    assert abs(anchor_coefficient(config, 500) - 0.2) < 1e-9
    assert anchor_coefficient(PPOConfig(anchor_kl_coef=0.3), 999) == 0.3
    assert anchor_coefficient(PPOConfig(), 1) == 0.0


def test_micro_training_with_anchor_and_freeze() -> None:
    workdir = Path(tempfile.mkdtemp(prefix="anchor_test_"))
    try:
        anchor = ActorCritic(92, 18)
        anchor_path = workdir / "anchor.pt"
        torch.save({"model": anchor.state_dict()}, anchor_path)
        config = PPOConfig(
            total_steps=64,
            workers=1,
            envs_per_worker=2,
            rollout_steps=8,
            minibatch_size=8,
            update_epochs=1,
            winning_score=1,
            games_per_series=1,
            seed=7,
            save_every=1000,
            save_every_minutes=0,
            checkpoint_dir=str(workdir / "ckpt"),
            device="cpu",
            initial_model=str(anchor_path),
            anchor_model=str(anchor_path),
            anchor_kl_coef=0.5,
            policy_freeze_updates=2,
            opponent_registry=str(Path(__file__).with_name("eval") / "opponents.json"),
            opponent_split=str(Path(__file__).with_name("eval") / "splits" / "train.json"),
        )
        final = train(config)
        records = [json.loads(line) for line in (workdir / "ckpt" / "train.jsonl").read_text().splitlines()]
        assert len(records) == 4, len(records)
        assert records[0]["policyFrozen"] and records[1]["policyFrozen"]
        assert not records[2]["policyFrozen"] and not records[3]["policyFrozen"]
        assert all(record["anchorKl"] is not None for record in records)
        assert all(record["anchorKlCoef"] == 0.5 for record in records)
        assert (workdir / "ckpt" / "anchor.json").is_file()
        saved = torch.load(final, map_location="cpu", weights_only=False)
        assert saved["config"]["anchor_kl_coef"] == 0.5
        # During the frozen updates the actor must stay bit-identical to the
        # anchor; verify by re-running only the frozen part.
        config_frozen = PPOConfig(**{**config.__dict__, "total_steps": 32, "checkpoint_dir": str(workdir / "frozen")})
        frozen_final = train(config_frozen)
        frozen_state = torch.load(frozen_final, map_location="cpu", weights_only=False)["model"]
        for key, value in anchor.state_dict().items():
            if key.startswith("value."):
                continue
            assert torch.equal(frozen_state[key], value), f"{key} changed while the policy was frozen"
        assert not torch.equal(frozen_state["value.weight"], anchor.state_dict()["value.weight"])
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    test_anchor_kl_zero_for_identical_and_positive_otherwise()
    test_anchor_coefficient_schedule()
    test_micro_training_with_anchor_and_freeze()
    print("anchor tests PASS")
