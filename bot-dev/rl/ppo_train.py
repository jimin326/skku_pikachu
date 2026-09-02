"""PyTorch PPO red-team trainer for the real Node Lion environment."""

from __future__ import annotations

import argparse
import hashlib
import json
import math
import os
import random
import shutil
import time
from dataclasses import asdict, dataclass
from pathlib import Path

import numpy as np
import torch
from torch import nn
from torch.distributions import Categorical

from node_bridge import ParallelNodeVectorEnv
from opponent_pool import load_training_pool


@dataclass
class PPOConfig:
    total_steps: int = 2_000_000
    workers: int = 8
    envs_per_worker: int = 1
    rollout_steps: int = 256
    learning_rate: float = 3e-4
    gamma: float = 0.995
    gae_lambda: float = 0.95
    clip_coef: float = 0.2
    entropy_coef: float = 0.01
    value_coef: float = 0.5
    max_grad_norm: float = 0.5
    update_epochs: int = 4
    minibatch_size: int = 256
    games_per_series: int = 4
    winning_score: int = 10
    seed: int = 20260902
    save_every: int = 25
    save_every_minutes: float = 60.0
    log_every: int = 1
    checkpoint_dir: str = "bot-dev/rl/checkpoints/ppo"
    device: str = "auto"
    resume: str = ""
    max_wall_minutes: float = 0.0
    opponent_registry: str = "bot-dev/rl/eval/opponents.json"
    opponent_split: str = "bot-dev/rl/eval/splits/train.json"
    initial_model: str = ""
    recovery_dir: str = ""
    league_manifest: str = ""


class ActorCritic(nn.Module):
    def __init__(self, observation_size: int, action_count: int) -> None:
        super().__init__()
        self.body = nn.Sequential(
            nn.Linear(observation_size, 64),
            nn.Tanh(),
            nn.Linear(64, 64),
            nn.Tanh(),
        )
        self.policy = nn.Linear(64, action_count)
        self.value = nn.Linear(64, 1)
        for module in self.modules():
            if isinstance(module, nn.Linear):
                nn.init.orthogonal_(module.weight, math.sqrt(2))
                nn.init.constant_(module.bias, 0)
        nn.init.orthogonal_(self.policy.weight, 0.01)
        nn.init.orthogonal_(self.value.weight, 1.0)

    def forward(self, observations: torch.Tensor):
        hidden = self.body(observations)
        return self.policy(hidden), self.value(hidden).squeeze(-1)

    def action_and_value(
        self, observations: torch.Tensor, actions: torch.Tensor | None = None
    ):
        logits, values = self(observations)
        distribution = Categorical(logits=logits)
        if actions is None:
            actions = distribution.sample()
        return actions, distribution.log_prob(actions), distribution.entropy(), values


class SeriesScheduler:
    def __init__(self, count: int, games_per_series: int, seed: int, opponents=None) -> None:
        self.rng = random.Random(seed)
        self.opponents = list(opponents or [])
        if not self.opponents:
            raise ValueError("opponent pool is empty")
        self.games_per_series = games_per_series
        self.games = [0] * count
        self.sides = ["LEFT" if i % 2 == 0 else "RIGHT" for i in range(count)]
        self.seeds = [self._seed() for _ in range(count)]
        self.opponent_indices = [i % len(self.opponents) for i in range(count)]

    def _opponent_index(self) -> int:
        anchors = [i for i, item in enumerate(self.opponents) if item.get("poolRole") != "league"]
        league = [i for i, item in enumerate(self.opponents) if item.get("poolRole") == "league"]
        choices = league if league and self.rng.random() < 0.5 else anchors
        return choices[self.rng.randrange(len(choices))]

    def _seed(self) -> int:
        return self.rng.randrange(1, 2**32)

    def initial(self):
        return [
            {"seed": self.seeds[i], "side": self.sides[i], "opponent": self.opponents[self.opponent_indices[i]]}
            for i in range(len(self.games))
        ]

    def state_dict(self):
        return {
            "rng": self.rng.getstate(),
            "games": list(self.games),
            "sides": list(self.sides),
            "seeds": list(self.seeds),
            "opponentIndices": list(self.opponent_indices),
        }

    def load_state_dict(self, state, *, fresh_episodes: bool = True):
        self.rng.setstate(state["rng"])
        self.games = list(state["games"])
        self.sides = list(state["sides"])
        self.seeds = list(state["seeds"])
        self.opponent_indices = list(state["opponentIndices"])
        if fresh_episodes:
            for i in range(len(self.games)):
                self.games[i] = 0
                self.seeds[i] = self._seed()
                self.sides[i] = "RIGHT" if self.sides[i] == "LEFT" else "LEFT"
                self.opponent_indices[i] = self._opponent_index()

    def resets(self, terminated: np.ndarray, truncated: np.ndarray):
        requests: list[dict | None] = [None] * len(self.games)
        for i, finished in enumerate(np.logical_or(terminated, truncated)):
            if not finished:
                continue
            if truncated[i]:
                # A truncated game has no completed Worker state that can be
                # carried into another match. Start a fresh seed instead of
                # asking RedTeamEnv to preserve an unfinished episode.
                self.games[i] = 0
                self.seeds[i] = self._seed()
                self.sides[i] = "RIGHT" if self.sides[i] == "LEFT" else "LEFT"
                self.opponent_indices[i] = self._opponent_index()
                requests[i] = {"seed": self.seeds[i], "side": self.sides[i], "opponent": self.opponents[self.opponent_indices[i]]}
                continue
            self.games[i] += 1
            if self.games[i] < self.games_per_series:
                requests[i] = {"preserveBotState": True, "side": self.sides[i]}
            else:
                self.games[i] = 0
                self.seeds[i] = self._seed()
                self.sides[i] = "RIGHT" if self.sides[i] == "LEFT" else "LEFT"
                self.opponent_indices[i] = self._opponent_index()
                requests[i] = {"seed": self.seeds[i], "side": self.sides[i], "opponent": self.opponents[self.opponent_indices[i]]}
        return requests


def compute_gae(
    rewards: torch.Tensor,
    values: torch.Tensor,
    next_value: torch.Tensor,
    return_dones: torch.Tensor,
    gamma: float,
    gae_lambda: float,
):
    advantages = torch.zeros_like(rewards)
    last_gae = torch.zeros(rewards.shape[1], device=rewards.device)
    for step in reversed(range(rewards.shape[0])):
        following_value = next_value if step == rewards.shape[0] - 1 else values[step + 1]
        nonterminal = 1.0 - return_dones[step]
        delta = rewards[step] + gamma * following_value * nonterminal - values[step]
        last_gae = delta + gamma * gae_lambda * nonterminal * last_gae
        advantages[step] = last_gae
    return advantages, advantages + values


def match_terminal_flags(infos) -> np.ndarray:
    """Terminate GAE at match point independently of reward shaping weights."""
    return np.asarray(
        [bool(info.get("gameEndedThisStep", False)) for info in infos], dtype=np.bool_
    )


def save_checkpoint(path: Path, model, optimizer, config, update, global_step, scheduler=None, pool_metadata=None) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "model": model.state_dict(),
        "optimizer": optimizer.state_dict(),
        "config": asdict(config),
        "update": update,
        "global_step": global_step,
        "savedAt": time.strftime("%Y-%m-%dT%H:%M:%S%z"),
        "pythonRngState": random.getstate(),
        "numpyRngState": np.random.get_state(),
        "torchRngState": torch.get_rng_state(),
        "torchCudaRngStateAll": torch.cuda.get_rng_state_all() if torch.cuda.is_available() else None,
        "scheduler": scheduler.state_dict() if scheduler is not None else None,
        "opponentPool": pool_metadata,
        "resumeMode": "fresh-episodes",
    }
    temporary = path.with_name(path.name + ".tmp")
    torch.save(payload, temporary)
    os.replace(temporary, path)

    # `latest.pt` is the recovery pointer used by the stage-5 runner. Copy to
    # another temporary file first, so a power loss never exposes a partial
    # checkpoint as the latest valid one.
    latest = path.parent / "latest.pt"
    latest_temporary = latest.with_name(latest.name + ".tmp")
    shutil.copyfile(path, latest_temporary)
    os.replace(latest_temporary, latest)
    if config.recovery_dir:
        recovery = Path(config.recovery_dir)
        recovery.mkdir(parents=True, exist_ok=True)
        mirrored = recovery / path.name
        mirrored_temporary = mirrored.with_name(mirrored.name + ".tmp")
        shutil.copyfile(path, mirrored_temporary)
        os.replace(mirrored_temporary, mirrored)
        digest = hashlib.sha256(mirrored.read_bytes()).hexdigest()
        pointer = recovery / "latest.json"
        pointer_temporary = pointer.with_name(pointer.name + ".tmp")
        pointer_temporary.write_text(json.dumps({
            "checkpoint": mirrored.name,
            "sha256": digest,
            "globalStep": global_step,
            "resumeMode": "fresh-episodes",
        }, indent=2), encoding="utf-8")
        os.replace(pointer_temporary, pointer)


def train(config: PPOConfig) -> Path:
    random.seed(config.seed)
    np.random.seed(config.seed)
    torch.manual_seed(config.seed)
    if torch.cuda.is_available():
        torch.cuda.manual_seed_all(config.seed)
    torch.set_num_threads(1)
    device_name = "cuda" if config.device == "auto" and torch.cuda.is_available() else (
        "cpu" if config.device == "auto" else config.device
    )
    device = torch.device(device_name)
    opponents, pool_metadata = load_training_pool(
        config.opponent_registry, config.opponent_split, config.league_manifest or None
    )
    checkpoint_dir = Path(config.checkpoint_dir)
    checkpoint_dir.mkdir(parents=True, exist_ok=True)
    (checkpoint_dir / "config.json").write_text(
        json.dumps(asdict(config), indent=2), encoding="utf-8"
    )

    with ParallelNodeVectorEnv(
        config.workers,
        envs_per_worker=config.envs_per_worker,
        env_options={"winningScore": config.winning_score},
    ) as env:
        scheduler = SeriesScheduler(env.count, config.games_per_series, config.seed, opponents)
        model = ActorCritic(env.observation_size, env.action_count).to(device)
        optimizer = torch.optim.Adam(model.parameters(), lr=config.learning_rate, eps=1e-5)
        global_step = 0
        start_update = 0
        if config.resume:
            resumed = torch.load(config.resume, map_location="cpu", weights_only=False)
            model.load_state_dict(resumed["model"])
            optimizer.load_state_dict(resumed["optimizer"])
            global_step = int(resumed.get("global_step", 0))
            start_update = int(resumed.get("update", 0))
            if "pythonRngState" in resumed:
                random.setstate(resumed["pythonRngState"])
            if "numpyRngState" in resumed:
                np.random.set_state(resumed["numpyRngState"])
            if "torchRngState" in resumed:
                torch.set_rng_state(resumed["torchRngState"])
            if resumed.get("torchCudaRngStateAll") is not None and torch.cuda.is_available():
                torch.cuda.set_rng_state_all(resumed["torchCudaRngStateAll"])
            if (resumed.get("opponentPool") or {}).get("manifestSha256") != pool_metadata["manifestSha256"]:
                raise ValueError("resume opponent pool metadata does not match current manifests")
            if resumed.get("scheduler") is not None:
                scheduler.load_state_dict(resumed["scheduler"], fresh_episodes=True)
        elif config.initial_model:
            initialized = torch.load(config.initial_model, map_location="cpu", weights_only=False)
            model.load_state_dict(initialized["model"])
        observations, _ = env.reset(scheduler.initial())
        batch_steps = config.rollout_steps * env.count
        remaining_steps = max(0, config.total_steps - global_step)
        updates = math.ceil(remaining_steps / batch_steps)
        if updates == 0:
            return Path(config.resume)
        initial_step = global_step
        started = time.perf_counter()
        last_time_save = started
        match_window: list[float] = []
        non_thunder_window: list[tuple[int, int]] = []
        winning_phase_counts = np.zeros(3, dtype=np.int64)

        for local_update in range(1, updates + 1):
            update = start_update + local_update
            obs_buffer = np.zeros(
                (config.rollout_steps, env.count, env.observation_size), dtype=np.float32
            )
            action_buffer = np.zeros((config.rollout_steps, env.count), dtype=np.int64)
            logprob_buffer = np.zeros((config.rollout_steps, env.count), dtype=np.float32)
            reward_buffer = np.zeros((config.rollout_steps, env.count), dtype=np.float32)
            done_buffer = np.zeros((config.rollout_steps, env.count), dtype=np.float32)
            value_buffer = np.zeros((config.rollout_steps, env.count), dtype=np.float32)
            loss_mask_buffer = np.zeros((config.rollout_steps, env.count), dtype=np.float32)
            reward_component_sums = {"point": 0.0, "match": 0.0, "touch": 0.0, "crossing": 0.0}
            completed_opponents: dict[str, int] = {}

            for step in range(config.rollout_steps):
                obs_buffer[step] = observations
                obs_tensor = torch.as_tensor(observations, device=device)
                with torch.no_grad():
                    actions, logprobs, _, values = model.action_and_value(obs_tensor)
                action_buffer[step] = actions.cpu().numpy()
                logprob_buffer[step] = logprobs.cpu().numpy()
                value_buffer[step] = values.cpu().numpy()
                next_observations, rewards, terminated, truncated, infos = env.step(
                    action_buffer[step].tolist()
                )
                done = np.logical_or(terminated, truncated)
                reward_buffer[step] = rewards
                # Close the return chain at match point while still executing
                # the masked post-game Worker ticks for runtime fidelity.
                match_ended = match_terminal_flags(infos)
                done_buffer[step] = np.logical_or(done, match_ended)
                loss_mask_buffer[step] = np.asarray(
                    [info.get("lossMask", 0.0) for info in infos], dtype=np.float32
                )
                for i, info in enumerate(infos):
                    for key in reward_component_sums:
                        reward_component_sums[key] += float(info.get("reward", {}).get(key, 0.0))
                    if not done[i]:
                        continue
                    opponent_id = str(info.get("opponentId", "unknown"))
                    completed_opponents[opponent_id] = completed_opponents.get(opponent_id, 0) + 1
                    scores = info.get("scores", {})
                    match_window.append(
                        float(
                            terminated[i]
                            and scores.get("self", 0) > scores.get("opp", 0)
                        )
                    )
                    stats = info.get("rallyStats", {})
                    non_thunder_window.append(
                        (stats.get("nonThunderWins", 0), stats.get("nonThunderLosses", 0))
                    )
                    winning_phase_counts += np.asarray(
                        stats.get("winningGameVictimServePhaseCounts", [0, 0, 0]),
                        dtype=np.int64,
                    )
                if done.any():
                    requests = scheduler.resets(terminated, truncated)
                    reset_observations, _ = env.reset(requests)
                    next_observations[done] = reset_observations[done]
                observations = next_observations
                global_step += env.count

            with torch.no_grad():
                _, next_values = model(torch.as_tensor(observations, device=device))
            rewards_t = torch.as_tensor(reward_buffer, device=device)
            values_t = torch.as_tensor(value_buffer, device=device)
            dones_t = torch.as_tensor(done_buffer, device=device)
            advantages, returns = compute_gae(
                rewards_t,
                values_t,
                next_values,
                dones_t,
                config.gamma,
                config.gae_lambda,
            )

            flat_obs = torch.as_tensor(obs_buffer.reshape(-1, env.observation_size), device=device)
            flat_actions = torch.as_tensor(action_buffer.reshape(-1), device=device)
            flat_logprobs = torch.as_tensor(logprob_buffer.reshape(-1), device=device)
            flat_advantages = advantages.reshape(-1)
            flat_returns = returns.reshape(-1)
            valid = np.flatnonzero(loss_mask_buffer.reshape(-1) > 0.5)
            if not len(valid):
                raise RuntimeError("rollout contained no trainable transitions")
            valid_t = torch.as_tensor(valid, device=device)
            valid_advantages = flat_advantages[valid_t]
            advantage_mean = valid_advantages.mean()
            advantage_std = valid_advantages.std(unbiased=False)

            losses = []
            for _ in range(config.update_epochs):
                permutation = valid[np.random.permutation(len(valid))]
                for start in range(0, len(permutation), config.minibatch_size):
                    indices = permutation[start : start + config.minibatch_size]
                    batch = torch.as_tensor(indices, device=device)
                    _, new_logprob, entropy, new_value = model.action_and_value(
                        flat_obs[batch], flat_actions[batch]
                    )
                    log_ratio = new_logprob - flat_logprobs[batch]
                    ratio = log_ratio.exp()
                    adv = (flat_advantages[batch] - advantage_mean) / (
                        advantage_std + 1e-8
                    )
                    policy_loss = torch.max(
                        -adv * ratio,
                        -adv * torch.clamp(
                            ratio, 1 - config.clip_coef, 1 + config.clip_coef
                        ),
                    ).mean()
                    value_loss = 0.5 * (new_value - flat_returns[batch]).pow(2).mean()
                    entropy_loss = entropy.mean()
                    loss = (
                        policy_loss
                        + config.value_coef * value_loss
                        - config.entropy_coef * entropy_loss
                    )
                    optimizer.zero_grad(set_to_none=True)
                    loss.backward()
                    nn.utils.clip_grad_norm_(model.parameters(), config.max_grad_norm)
                    optimizer.step()
                    losses.append((policy_loss.item(), value_loss.item(), entropy_loss.item()))

            elapsed = time.perf_counter() - started
            recent_matches = match_window[-100:]
            recent_non_thunder = non_thunder_window[-100:]
            nt_wins = sum(item[0] for item in recent_non_thunder)
            nt_losses = sum(item[1] for item in recent_non_thunder)
            means = np.mean(losses, axis=0)
            record = {
                "update": update,
                "steps": global_step,
                "stepsPerSecond": round(
                    (global_step - initial_step) / max(elapsed, 1e-9)
                ),
                "trainableFraction": float(loss_mask_buffer.mean()),
                "policyLoss": float(means[0]),
                "valueLoss": float(means[1]),
                "entropy": float(means[2]),
                "recentMatchWinRate": float(np.mean(recent_matches)) if recent_matches else None,
                "recentNonThunderWinRate": nt_wins / (nt_wins + nt_losses)
                if nt_wins + nt_losses
                else None,
                "winningLionServePhases": winning_phase_counts.tolist(),
                "rewardComponents": reward_component_sums,
                "completedMatchesByOpponent": completed_opponents,
            }
            if update % config.log_every == 0 or local_update == updates:
                print(json.dumps(record, separators=(",", ":")), flush=True)
            with (checkpoint_dir / "train.jsonl").open("a", encoding="utf-8") as log:
                log.write(json.dumps(record) + "\n")
            now = time.perf_counter()
            hourly_due = config.save_every_minutes > 0 and (
                now - last_time_save >= config.save_every_minutes * 60
            )
            if update % config.save_every == 0 or local_update == updates or hourly_due:
                save_checkpoint(
                    checkpoint_dir / f"checkpoint_{global_step:09d}.pt",
                    model,
                    optimizer,
                    config,
                    update,
                    global_step,
                    scheduler,
                    pool_metadata,
                )
                if hourly_due:
                    last_time_save = now
                    print(
                        json.dumps(
                            {
                                "checkpoint": "hourly",
                                "steps": global_step,
                                "path": str(checkpoint_dir / "latest.pt"),
                            },
                            separators=(",", ":"),
                        ),
                        flush=True,
                    )
            if config.max_wall_minutes > 0 and (
                now - started >= config.max_wall_minutes * 60
            ):
                break

        final_path = checkpoint_dir / f"checkpoint_{global_step:09d}.pt"
        save_checkpoint(final_path, model, optimizer, config, update, global_step, scheduler, pool_metadata)

    return final_path


def parse_args() -> PPOConfig:
    parser = argparse.ArgumentParser()
    for field in PPOConfig.__dataclass_fields__.values():
        name = "--" + field.name.replace("_", "-")
        default = field.default
        parser.add_argument(name, type=type(default), default=default)
    return PPOConfig(**vars(parser.parse_args()))


if __name__ == "__main__":
    checkpoint = train(parse_args())
    print(f"saved {checkpoint}")
