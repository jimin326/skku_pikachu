"""Python mirror of the action table in config.mjs (same enumeration order)."""

from __future__ import annotations

FEATURES_PER_FRAME = 23
FRAME_STACK = 4
OBSERVATION_SIZE = FEATURES_PER_FRAME * FRAME_STACK

ACTIONS = [
    {"x": x, "y": y, "hit": hit}
    for x in (-1, 0, 1)
    for y in (-1, 0, 1)
    for hit in (0, 1)
]
ACTION_LABELS = [f"x{a['x']:+d}_y{a['y']:+d}_h{a['hit']}" for a in ACTIONS]
NEUTRAL_ACTION = ACTIONS.index({"x": 0, "y": 0, "hit": 0})

assert len(ACTIONS) == 18 and NEUTRAL_ACTION == 8
