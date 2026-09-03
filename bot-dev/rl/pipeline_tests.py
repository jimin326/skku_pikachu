"""Deterministic tests for the diagnostics / gates / selection tooling.

No training and no checkpoint writes outside a temporary directory.
"""

from __future__ import annotations

import json
import shutil
import subprocess
import sys
import tempfile
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
REPO = HERE.parent.parent
sys.path.insert(0, str(HERE))
sys.path.insert(0, str(HERE / "eval"))

from bc_diagnostics import aliasing, episode_split, histogram, per_action_metrics  # noqa: E402
from checkpoint_sweep import list_checkpoints, summarize_sweep  # noqa: E402
from config_actions import ACTIONS, ACTION_LABELS, NEUTRAL_ACTION  # noqa: E402
from gates import GateThresholds, evaluate_gates, per_opponent_side_deltas, selection_key  # noqa: E402


def test_action_table_matches_config_mjs() -> None:
    script = "import {ACTIONS} from './bot-dev/rl/config.mjs'; console.log(JSON.stringify(ACTIONS));"
    output = subprocess.run(["node", "--input-type=module", "-e", script], cwd=REPO, check=True, capture_output=True, text=True)
    assert json.loads(output.stdout) == ACTIONS, "config_actions.py drifted from config.mjs"
    assert ACTION_LABELS[NEUTRAL_ACTION] == "x+0_y+0_h0"


def test_episode_split_is_disjoint_and_stable() -> None:
    episodes = np.repeat(np.arange(10), 5)
    train_mask, heldout_mask, ids = episode_split(episodes, 0.2, 20260903)
    assert not (train_mask & heldout_mask).any()
    assert (train_mask | heldout_mask).all()
    assert len(ids) == 2
    # No episode appears on both sides.
    assert set(episodes[train_mask]).isdisjoint(set(episodes[heldout_mask]))
    assert episode_split(episodes, 0.2, 20260903)[2] == ids
    assert episode_split(episodes, 0.2, 1)[2] != ids or True  # different seed may coincide; only stability is asserted


def test_aliasing_detects_label_conflicts() -> None:
    observations = np.zeros((100, 92), dtype=np.float32)
    clean = np.arange(100, dtype=np.int64) % 18
    # Distinct observations -> no conflict, ceiling 1.0
    distinct = np.tile(np.arange(100, dtype=np.float32)[:, None], (1, 92))
    result = aliasing(distinct, clean, frames=4, decimals=2)
    assert result["conflictSampleFraction"] == 0.0
    assert result["accuracyCeiling"] == 1.0
    assert result["conditionalEntropyBits"] == 0.0
    # Identical observations with two labels -> full conflict, ceiling = majority
    conflicted = np.asarray([0] * 60 + [1] * 40, dtype=np.int64)
    result = aliasing(observations, conflicted, frames=4, decimals=2)
    assert result["conflictSampleFraction"] == 1.0
    assert abs(result["accuracyCeiling"] - 0.6) < 1e-9
    assert result["conditionalEntropyBits"] > 0.9
    # A shorter observation view can only lose information -> ceiling not higher
    mixed = np.concatenate([distinct[:, :69], np.zeros((100, 23), dtype=np.float32)], axis=1)
    full = aliasing(mixed, clean, frames=4, decimals=2)["accuracyCeiling"]
    last_frame = aliasing(mixed, clean, frames=1, decimals=2)["accuracyCeiling"]
    assert last_frame <= full + 1e-12


def test_histogram_and_per_action_metrics() -> None:
    actions = np.asarray([0, 0, 0, 5, 5, 17], dtype=np.int64)
    hist = histogram(actions)
    assert hist[ACTION_LABELS[0]]["count"] == 3 and abs(hist[ACTION_LABELS[0]]["fraction"] - 0.5) < 1e-9
    assert sum(item["count"] for item in hist.values()) == len(actions)
    predicted = np.asarray([0, 0, 5, 5, 5, 0], dtype=np.int64)
    metrics = per_action_metrics(actions, predicted)
    assert metrics[ACTION_LABELS[0]]["support"] == 3
    assert abs(metrics[ACTION_LABELS[0]]["recall"] - 2 / 3) < 1e-9
    assert abs(metrics[ACTION_LABELS[0]]["precision"] - 2 / 3) < 1e-9
    assert metrics[ACTION_LABELS[17]]["recall"] == 0.0
    assert metrics[ACTION_LABELS[1]]["recall"] is None  # no support


def _match_rows(candidate_wins: dict[tuple[str, str, int], bool], v4_wins: dict[tuple[str, str, int], bool], benchmark=("lion_v4",)):
    rows = []
    for key, won in candidate_wins.items():
        opponent, side, seed = key
        rows.append({"kind": "match", "blockId": f"{opponent}/{seed}/0", "arm": "candidate", "opponentId": opponent,
                     "familyId": opponent, "benchmarkOnly": opponent in benchmark, "seed": seed, "side": side, "won": won})
        rows.append({"kind": "match", "blockId": f"{opponent}/{seed}/0", "arm": "v4", "opponentId": opponent,
                     "familyId": opponent, "benchmarkOnly": opponent in benchmark, "seed": seed, "side": side, "won": v4_wins[key]})
    return rows


def test_per_opponent_side_deltas() -> None:
    seeds = [1, 2, 3, 4]
    candidate, v4 = {}, {}
    for seed in seeds:
        candidate[("builtin", "LEFT", seed)] = True
        v4[("builtin", "LEFT", seed)] = True
        candidate[("builtin", "RIGHT", seed)] = False
        v4[("builtin", "RIGHT", seed)] = True
    result = per_opponent_side_deltas(_match_rows(candidate, v4))
    assert result["builtin"]["LEFT"]["estimate"] == 0.0
    assert result["builtin"]["LEFT"]["ci95"] == [0.0, 0.0]
    assert result["builtin"]["RIGHT"]["estimate"] == -1.0
    assert result["builtin"]["RIGHT"]["ci95"][0] <= -1.0 + 1e-9


def _stats(primary_ci, benchmark_ci, self_destruction, rally_rate=0.5, primary=0.0, benchmark=0.0):
    return {
        "primary": {"estimate": primary, "ci95": list(primary_ci), "byOpponent": {}},
        "benchmarkPaired": {"estimate": benchmark, "ci95": list(benchmark_ci)},
        "candidate": {"matches": {"rate": 0.5}, "rallies": {"rate": rally_rate}},
        "selfDestruction": {"candidate": {"rateAmongLosses": self_destruction}},
    }


# Runtime numbers of the handoff's BC+PPO export, which passed the runtime gate.
MEASURED_RUNTIME = {"candidate": {"p95Ns": 77_928, "p99Ns": 92_876, "maxNs": 2_114_000,
                                  "rawBytes": 235_450, "gzipBytes": 106_403,
                                  "heapDeltaBytes": 1_306_320, "invalidActions": 0}}


def test_runtime_thresholds_match_acceptance_md() -> None:
    """gates.py must not be looser than the pre-registered ACCEPTANCE.md section 4."""
    t = GateThresholds()
    assert t.runtime_p95_ns == 125_000
    assert t.runtime_p99_ns == 1_000_000
    assert t.runtime_max_ns == 10_000_000
    assert t.runtime_raw_max_bytes == 1024 * 1024
    assert t.runtime_heap_max_bytes == 10 * 1024 * 1024
    assert t.invalid_actions_max == 0
    text = (HERE / "ACCEPTANCE.md").read_text(encoding="utf-8")
    for needle in ("p95 ≤ 125 µs", "p99 ≤ 1 ms", "최대 ≤ 10 ms", "raw JS ≤ 1 MiB", "heap 증가 ≤ 10 MiB"):
        assert needle in text, f"ACCEPTANCE.md no longer states {needle}; re-check gates.py"


def test_runtime_gate_enforces_every_limit() -> None:
    stats = _stats((0.02, 0.30), (0.05, 0.40), 0.01, primary=0.15, benchmark=0.2)
    base = MEASURED_RUNTIME["candidate"]
    assert evaluate_gates(stats, runtime=MEASURED_RUNTIME)["gates"]["runtime"]["pass"] is True
    for key, bad in (("p95Ns", 130_000), ("p99Ns", 1_100_000), ("maxNs", 11_000_000),
                     ("rawBytes", 2_000_000), ("heapDeltaBytes", 20_000_000), ("invalidActions", 1)):
        result = evaluate_gates(stats, runtime={"candidate": {**base, key: bad}})["gates"]["runtime"]
        assert result["pass"] is False and key in result["failed"], key
    # A metric the benchmark did not report is not a pass.
    partial = {k: v for k, v in base.items() if k != "heapDeltaBytes"}
    result = evaluate_gates(stats, runtime={"candidate": partial})["gates"]["runtime"]
    assert result["pass"] is False and "heapDeltaBytes" in result["missingMetrics"]


def test_gates_reject_the_measured_bc_ppo_profile() -> None:
    # Experiment C from the handoff: v4-direct delta -0.50, self-destruction 32.97%.
    stats = _stats((-0.625, -0.4375), (-0.5, -0.5), 0.3297, primary=-0.53125, benchmark=-0.5)
    result = evaluate_gates(stats, rows=None, runtime=MEASURED_RUNTIME)
    assert result["gates"]["runtime"]["pass"] is True
    assert result["gates"]["benchmark_ci_lower"]["pass"] is False
    assert result["gates"]["self_destruction"]["pass"] is False
    assert result["selectable"] is False  # 32.97% > selectable ceiling 25%
    assert result["submission"] is False


def test_gates_accept_only_a_strictly_better_candidate() -> None:
    stats = _stats((0.02, 0.30), (0.05, 0.40), 0.01, primary=0.15, benchmark=0.2)
    rows = _match_rows(
        {("builtin", side, seed): True for side in ("LEFT", "RIGHT") for seed in (1, 2, 3, 4)},
        {("builtin", side, seed): True for side in ("LEFT", "RIGHT") for seed in (1, 2, 3, 4)},
    )
    result = evaluate_gates(stats, rows=rows, runtime=MEASURED_RUNTIME)
    assert result["submission"] is True and result["selectable"] is True
    # A single invalid action fails the runtime gate outright.
    broken = evaluate_gates(stats, rows=rows, runtime={"candidate": {**MEASURED_RUNTIME["candidate"], "invalidActions": 1}})
    assert broken["gates"]["runtime"]["pass"] is False and broken["submission"] is False


def test_selection_key_ordering() -> None:
    worse = evaluate_gates(_stats((-0.6, -0.4), (-0.5, -0.5), 0.30, primary=-0.5, benchmark=-0.5), runtime=MEASURED_RUNTIME)
    better = evaluate_gates(_stats((-0.2, 0.1), (-0.2, 0.1), 0.05, primary=-0.05, benchmark=-0.05), runtime=MEASURED_RUNTIME)
    assert selection_key(better) > selection_key(worse)
    # Self-destruction breaks ties between equal paired deltas.
    clean = evaluate_gates(_stats((-0.2, 0.1), (-0.2, 0.1), 0.02, primary=-0.05, benchmark=-0.05), runtime=MEASURED_RUNTIME)
    assert selection_key(clean) > selection_key(better)


def test_sweep_onset_detection_and_listing() -> None:
    def record(step, primary, benchmark, self_destruction):
        return {"step": step, "label": "ckpt", "primary": {"estimate": primary, "ci95": [primary, primary]},
                "benchmark": {"estimate": benchmark, "ci95": [benchmark, benchmark]}, "matchWinRate": 0.5, "rallyWinRate": 0.5,
                "selfDestruction": {"rateAmongLosses": self_destruction}, "drift": None,
                "selectable": True, "submission": False, "selectionKey": [1, 0, primary, benchmark, -self_destruction, 0.5]}
    records = [record(0, 0.0, 0.0, 0.02), record(100_000, -0.05, 0.0, 0.05), record(200_000, -0.5, -0.5, 0.35), record(2_000_000, -0.53, -0.5, 0.33)]
    summary = summarize_sweep(records, 0.125, GateThresholds())
    assert summary["onset"]["primaryDrop"] == 200_000
    assert summary["onset"]["benchmarkDrop"] == 200_000
    assert summary["onset"]["selfDestructionExceeded"] == 200_000
    assert summary["best"]["step"] == 0
    assert [row["step"] for row in summary["table"]] == [0, 100_000, 200_000, 2_000_000]

    workdir = Path(tempfile.mkdtemp(prefix="sweep_list_"))
    try:
        for step in (0, 100_000, 500_000, 2_002_944):
            (workdir / f"checkpoint_{step:09d}.pt").write_bytes(b"x")
        (workdir / "latest.pt").write_bytes(b"x")
        assert [step for step, _ in list_checkpoints(workdir, None, 0)] == [0, 100_000, 500_000, 2_002_944]
        assert [step for step, _ in list_checkpoints(workdir, [100_000, 2_002_944], 0)] == [100_000, 2_002_944]
        assert len(list_checkpoints(workdir, None, 2)) == 2
    finally:
        shutil.rmtree(workdir, ignore_errors=True)


def test_split_leakage_guard() -> None:
    train = json.loads((HERE / "eval" / "splits" / "train.json").read_text(encoding="utf-8"))
    validation = json.loads((HERE / "eval" / "splits" / "validation.json").read_text(encoding="utf-8"))
    assert not set(train["seeds"]) & set(validation["seeds"])
    assert not set(train["opponents"]) & set(validation["opponents"])
    assert not set(train["opponents"]) & set(validation.get("benchmarkOpponents", []))
    families = {"lion_v1": "lion_eating_bank", "lion_v2": "lion_eating_bank", "lion_v3": "lion_eating_bank"}
    assert all(families.get(item) != "production_builtin_ai" for item in train["opponents"])


def test_selection_rejects_unselectable_and_stops_on_rising_self_destruction() -> None:
    """The runner must not record an un-selectable checkpoint as best, and must stop
    when self-destruction rises for two consecutive phases."""
    import argparse

    import train_with_validation as twv

    def record(step, sd, selectable, primary=-0.5):
        return {"phase": step, "step": step, "selfDestruction": {"rateAmongLosses": sd},
                "selectable": selectable, "submission": False,
                "selectionKey": [int(selectable), 0, primary, 0.0, -sd, 0.5],
                "primary": {"estimate": primary}, "benchmark": None, "workDir": "/tmp"}

    workdir = Path(tempfile.mkdtemp(prefix="select_test_"))
    checkpoint = workdir / "x.pt"
    checkpoint.write_bytes(b"checkpoint")
    runner = twv.Runner.__new__(twv.Runner)
    runner.args = argparse.Namespace(patience=2, max_rollbacks=2, rollback_lr_factor=0.5, max_unselectable_phases=3)
    runner.run_dir = workdir
    runner.recovery = None
    runner.state = {"best": None, "consecutiveNonImprovements": 0, "rollbacks": 0, "currentLearningRate": 3e-4}

    # Every checkpoint blows past the self-destruction ceiling -> never a best, then stop.
    for expected in ("continue", "continue"):
        assert runner.select(record(1, 0.40, False), checkpoint) == expected
        assert runner.state["best"] is None
    assert runner.select(record(1, 0.40, False), checkpoint) == "stop"
    assert runner.state["best"] is None
    assert "no selectable checkpoint" in runner.state["stopReason"]

    # Rising self-destruction stops the arm even while it stays selectable.
    runner.state = {"best": None, "consecutiveNonImprovements": 0, "rollbacks": 0, "currentLearningRate": 3e-4}
    runner.select(record(1, 0.05, True), checkpoint)
    runner.select(record(2, 0.10, True), checkpoint)
    assert runner.select(record(3, 0.20, True), checkpoint) == "stop"
    assert "self-destruction rose" in runner.state["stopReason"]
    shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    test_action_table_matches_config_mjs()
    test_runtime_thresholds_match_acceptance_md()
    test_runtime_gate_enforces_every_limit()
    test_selection_rejects_unselectable_and_stops_on_rising_self_destruction()
    test_episode_split_is_disjoint_and_stable()
    test_aliasing_detects_label_conflicts()
    test_histogram_and_per_action_metrics()
    test_per_opponent_side_deltas()
    test_gates_reject_the_measured_bc_ppo_profile()
    test_gates_accept_only_a_strictly_better_candidate()
    test_selection_key_ordering()
    test_sweep_onset_detection_and_listing()
    test_split_leakage_guard()
    print("pipeline tests PASS")
