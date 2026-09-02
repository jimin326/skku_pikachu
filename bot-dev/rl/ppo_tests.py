"""Small deterministic tests for PPO math, model, and the Node bridge."""

from __future__ import annotations

import numpy as np
import torch

from node_bridge import ParallelNodeVectorEnv
from ppo_train import ActorCritic, compute_gae, match_terminal_flags


def test_gae() -> None:
    rewards = torch.tensor([[1.0], [2.0], [3.0]])
    values = torch.tensor([[0.5], [0.25], [1.0]])
    dones = torch.tensor([[0.0], [1.0], [0.0]])
    advantages, returns = compute_gae(
        rewards, values, torch.tensor([4.0]), dones, gamma=0.9, gae_lambda=0.8
    )
    expected = torch.tensor([[1.985], [1.75], [5.6]])
    assert torch.allclose(advantages, expected, atol=1e-6), (advantages, expected)
    assert torch.allclose(returns, expected + values, atol=1e-6)


def test_model_and_bridge() -> None:
    with ParallelNodeVectorEnv(
        2, env_options={"winningScore": 1}
    ) as env:
        observations, infos = env.reset(
            [{"seed": 41001, "side": "LEFT"}, {"seed": 41002, "side": "RIGHT"}]
        )
        assert observations.shape == (2, 92)
        assert all(info["actionCount"] == 18 for info in infos)
        model = ActorCritic(env.observation_size, env.action_count)
        with torch.no_grad():
            actions, logprobs, entropy, values = model.action_and_value(
                torch.as_tensor(observations)
            )
        assert actions.shape == logprobs.shape == entropy.shape == values.shape == (2,)
        next_observations, rewards, terminated, truncated, step_infos = env.step(
            actions.tolist()
        )
        assert next_observations.shape == observations.shape
        assert rewards.dtype == np.float32
        assert terminated.dtype == truncated.dtype == np.bool_
        assert all(info["lossMask"] in (0, 1) for info in step_infos)


def test_point_only_terminal_signal() -> None:
    flags = match_terminal_flags([
        {"reward": {"match": 0.0}, "gameEndedThisStep": False},
        {"reward": {"match": 0.0}, "gameEndedThisStep": True},
    ])
    assert flags.tolist() == [False, True]


if __name__ == "__main__":
    test_gae()
    test_model_and_bridge()
    test_point_only_terminal_signal()
    print("ppo tests PASS")
