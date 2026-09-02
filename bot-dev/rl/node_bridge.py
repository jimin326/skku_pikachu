"""NumPy bridge for one batched Node real-game process.

The PPO learner imports this module. PyTorch stays entirely in Python; Node
only owns the production game physics and the frozen JavaScript victim.
"""

from __future__ import annotations

import json
import subprocess
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path
from typing import Any, Iterable

import numpy as np


class NodeVectorEnv:
    def __init__(
        self,
        count: int,
        *,
        env_options: dict[str, Any] | None = None,
        node_executable: str = "node",
    ) -> None:
        server = Path(__file__).with_name("batch_server.mjs")
        self._next_id = 1
        self._process = subprocess.Popen(
            [node_executable, "--no-warnings", str(server)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=None,
            text=True,
            encoding="utf-8",
            bufsize=1,
        )
        created = self._request(
            {"command": "create", "count": count, "options": env_options or {}}
        )
        self.count = int(created["count"])
        self.observation_size = int(created["observationSize"])
        self.action_count = int(created["actionCount"])

    def _request(self, payload: dict[str, Any]) -> dict[str, Any]:
        if self._process.poll() is not None:
            raise RuntimeError(f"Node environment exited with {self._process.returncode}")
        request_id = self._next_id
        self._next_id += 1
        payload = {"id": request_id, **payload}
        assert self._process.stdin is not None
        assert self._process.stdout is not None
        self._process.stdin.write(json.dumps(payload, separators=(",", ":")) + "\n")
        self._process.stdin.flush()
        line = self._process.stdout.readline()
        if not line:
            raise RuntimeError("Node environment closed stdout unexpectedly")
        response = json.loads(line)
        if response.get("id") != request_id:
            raise RuntimeError(f"Protocol id mismatch: {response.get('id')} != {request_id}")
        if not response.get("ok"):
            raise RuntimeError(response.get("error", "unknown Node environment error"))
        return response

    def _unpack(self, response: dict[str, Any]):
        results = response["results"]
        observations = np.asarray(
            [result["observation"] for result in results], dtype=np.float32
        )
        rewards = np.asarray(
            [result.get("reward", 0.0) for result in results], dtype=np.float32
        )
        terminated = np.asarray(
            [result.get("terminated", False) for result in results], dtype=np.bool_
        )
        truncated = np.asarray(
            [result.get("truncated", False) for result in results], dtype=np.bool_
        )
        infos = [result["info"] for result in results]
        return observations, rewards, terminated, truncated, infos

    def reset(self, requests: Iterable[dict[str, Any]]):
        response = self._request({"command": "reset", "requests": list(requests)})
        observations, _, _, _, infos = self._unpack(response)
        return observations, infos

    def step(self, actions: Iterable[int | None]):
        response = self._request({"command": "step", "actions": list(actions)})
        return self._unpack(response)

    def close(self) -> None:
        if self._process.poll() is None:
            try:
                self._request({"command": "close"})
            finally:
                self._process.wait(timeout=5)

    def __enter__(self) -> "NodeVectorEnv":
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.close()


__all__ = ["NodeVectorEnv"]


class ParallelNodeVectorEnv:
    """Several Node child processes queried concurrently in Python threads."""

    def __init__(
        self,
        workers: int,
        *,
        envs_per_worker: int = 1,
        env_options: dict[str, Any] | None = None,
        node_executable: str = "node",
    ) -> None:
        if workers < 1 or envs_per_worker < 1:
            raise ValueError("workers and envs_per_worker must be positive")
        self.workers = [
            NodeVectorEnv(
                envs_per_worker,
                env_options=env_options,
                node_executable=node_executable,
            )
            for _ in range(workers)
        ]
        self.envs_per_worker = envs_per_worker
        self.count = workers * envs_per_worker
        self.observation_size = self.workers[0].observation_size
        self.action_count = self.workers[0].action_count
        self._executor = ThreadPoolExecutor(max_workers=workers)

    def _chunks(self, values: list[Any]) -> list[list[Any]]:
        if len(values) != self.count:
            raise ValueError(f"expected {self.count} values, got {len(values)}")
        return [
            values[i : i + self.envs_per_worker]
            for i in range(0, self.count, self.envs_per_worker)
        ]

    @staticmethod
    def _merge(parts):
        observations = np.concatenate([part[0] for part in parts], axis=0)
        rewards = np.concatenate([part[1] for part in parts], axis=0)
        terminated = np.concatenate([part[2] for part in parts], axis=0)
        truncated = np.concatenate([part[3] for part in parts], axis=0)
        infos = [info for part in parts for info in part[4]]
        return observations, rewards, terminated, truncated, infos

    def reset(self, requests: Iterable[dict[str, Any] | None]):
        chunks = self._chunks(list(requests))
        futures = [
            self._executor.submit(worker.reset, chunk)
            for worker, chunk in zip(self.workers, chunks)
        ]
        parts = [future.result() for future in futures]
        return np.concatenate([part[0] for part in parts], axis=0), [
            info for part in parts for info in part[1]
        ]

    def step(self, actions: Iterable[int | None]):
        chunks = self._chunks(list(actions))
        futures = [
            self._executor.submit(worker.step, chunk)
            for worker, chunk in zip(self.workers, chunks)
        ]
        return self._merge([future.result() for future in futures])

    def close(self) -> None:
        futures = [self._executor.submit(worker.close) for worker in self.workers]
        for future in futures:
            future.result()
        self._executor.shutdown(wait=True)

    def __enter__(self) -> "ParallelNodeVectorEnv":
        return self

    def __exit__(self, exc_type, exc_value, traceback) -> None:
        self.close()


__all__.append("ParallelNodeVectorEnv")
