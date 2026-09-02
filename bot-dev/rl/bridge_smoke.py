from node_bridge import NodeVectorEnv


def main() -> None:
    with NodeVectorEnv(2, env_options={"winningScore": 1}) as env:
        observations, infos = env.reset(
            [{"seed": 1001, "side": "LEFT"}, {"seed": 1002, "side": "RIGHT"}]
        )
        assert observations.shape == (2, env.observation_size)
        done = [False, False]
        steps = 0
        while not all(done):
            actions = [None if done[i] else (steps + i) % env.action_count for i in range(2)]
            observations, rewards, terminated, truncated, infos = env.step(actions)
            done = [bool(terminated[i] or truncated[i]) for i in range(2)]
            steps += 1
        assert all(info.get("skipped") or "rallyStats" in info for info in infos)
        print(
            f"Node/Python batch bridge: PASS ({steps} batch steps, "
            f"obs={observations.shape}, actions={env.action_count})"
        )


if __name__ == "__main__":
    main()
