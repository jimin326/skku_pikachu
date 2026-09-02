"""Aggregate Lion loss traces and extract replayable RedTeam serve candidates."""

from __future__ import annotations

import argparse
import json
from collections import Counter, defaultdict
from pathlib import Path
from statistics import mean


Action = tuple[int, int, int]


def mechanism(record: dict) -> str:
    touches = record["touches"]
    lion_touches = sum(touch["by"] == "LION" for touch in touches)
    if record["how"] == "touchLimit":
        return "LION_TOUCH_LIMIT"
    if lion_touches == 0:
        return "SERVE_ACE" if record["server"] == "RL" else "NO_LION_TOUCH"
    if touches and touches[-1]["by"] == "LION":
        return "LION_RETURN_ERROR"
    return "RL_ATTACK_WIN"


def landing_zone(x: float) -> str:
    if x < 216:
        return "RL_SIDE_OR_NET"
    if x < 288:
        return "LION_FRONT"
    if x < 360:
        return "LION_MIDDLE"
    return "LION_BACK"


def length_bucket(frames: int) -> str:
    if frames <= 45:
        return "FAST"
    if frames <= 90:
        return "MEDIUM"
    return "LONG"


def rle(actions: list[Action]) -> list[list[int]]:
    result: list[list[int]] = []
    for action in actions:
        if result and tuple(result[-1][:3]) == action:
            result[-1][3] += 1
        else:
            result.append([*action, 1])
    return result


def live_actions(record: dict) -> list[Action]:
    return [tuple(item["a"]) for item in record["rlDecisions"] if item["f"] >= 0]


def finish_signature(record: dict) -> tuple:
    runs = rle(live_actions(record))[-4:]
    return tuple((x, y, hit, min(count, 3)) for x, y, hit, count in runs)


def serve_prefix(record: dict) -> tuple:
    decisions = [item for item in record["rlDecisions"] if item["f"] >= 0]
    prefix: list[Action] = []
    for item in decisions[:24]:
        prefix.append(tuple(item["a"]))
        if item["b"][0] > 216:
            break
    runs = rle(prefix)[:6]
    return tuple((x, y, hit, min(count, 4)) for x, y, hit, count in runs)


def pattern_key(record: dict) -> tuple:
    return (
        record["server"],
        record["rlServePhase"],
        record["lionServePhase"],
        mechanism(record),
        landing_zone(record["landX"]),
        length_bucket(record["frames"]),
        finish_signature(record),
    )


def pattern_payload(records: list[dict], total: int) -> dict:
    first = records[0]
    lion_touches = [sum(t["by"] == "LION" for t in item["touches"]) for item in records]
    rl_touches = [sum(t["by"] == "RL" for t in item["touches"]) for item in records]
    return {
        "count": len(records),
        "shareOfTrainableLionLosses": len(records) / total if total else None,
        "server": first["server"],
        "rlServePhase": first["rlServePhase"],
        "lionServePhase": first["lionServePhase"],
        "mechanism": mechanism(first),
        "landingZone": landing_zone(first["landX"]),
        "lengthBucket": length_bucket(first["frames"]),
        "finishSignature": [list(item) for item in finish_signature(first)],
        "averageFrames": mean(item["frames"] for item in records),
        "averageLionTouches": mean(lion_touches),
        "averageRlTouches": mean(rl_touches),
        "sampleIds": [item["id"] for item in records[:8]],
    }


def analyze(input_path: Path, output_path: Path, report_path: Path, top: int) -> dict:
    metadata = None
    summary = None
    losses: list[dict] = []
    with input_path.open("r", encoding="utf-8") as handle:
        for line in handle:
            if not line.strip():
                continue
            item = json.loads(line)
            if item["type"] == "meta":
                metadata = item
            elif item["type"] == "summary":
                summary = item
            elif item["type"] == "lionLoss":
                losses.append(item)
    if metadata is None:
        raise ValueError("trace metadata is missing")

    trainable = [item for item in losses if not item["thunder"]]
    grouped: dict[tuple, list[dict]] = defaultdict(list)
    for item in trainable:
        grouped[pattern_key(item)].append(item)
    ranked = sorted(grouped.values(), key=lambda group: (-len(group), group[0]["id"]))
    patterns = [pattern_payload(group, len(trainable)) for group in ranked[:top]]

    serve_groups: dict[tuple, list[dict]] = defaultdict(list)
    for item in trainable:
        if item["server"] == "RL":
            key = (
                item["rlServePhase"],
                mechanism(item),
                landing_zone(item["landX"]),
                serve_prefix(item),
            )
            serve_groups[key].append(item)
    ranked_serves = sorted(serve_groups.values(), key=lambda group: (-len(group), group[0]["id"]))
    serve_candidates = []
    for index, group in enumerate(ranked_serves[:top], 1):
        representative = min(group, key=lambda item: (item["frames"], item["id"]))
        actions = live_actions(representative)
        serve_candidates.append(
            {
                "id": f"serve_{index:03d}",
                "count": len(group),
                "rlServePhase": representative["rlServePhase"],
                "mechanism": mechanism(representative),
                "landingZone": landing_zone(representative["landX"]),
                "prefixSignature": [list(item) for item in serve_prefix(representative)],
                "sourceTraceId": representative["id"],
                "sourceSide": representative["side"],
                "sourceFrames": representative["frames"],
                "canonicalActions": [list(action) for action in actions],
                "sourceActionRuns": rle(actions),
            }
        )

    mechanisms = Counter(mechanism(item) for item in trainable)
    zones = Counter(landing_zone(item["landX"]) for item in trainable)
    servers = Counter(item["server"] for item in trainable)
    result = {
        "version": 1,
        "source": str(input_path.resolve()),
        "traceMetadata": metadata,
        "traceSummary": summary,
        "lionLosses": len(losses),
        "trainableLionLosses": len(trainable),
        "excludedThunderLosses": len(losses) - len(trainable),
        "counts": {
            "servers": dict(servers),
            "mechanisms": dict(mechanisms),
            "landingZones": dict(zones),
        },
        "topPatterns": patterns,
        "serveCandidates": serve_candidates,
    }
    output_path.parent.mkdir(parents=True, exist_ok=True)
    output_path.write_text(json.dumps(result, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")

    lines = [
        "# Lion loss-pattern report",
        "",
        f"- Matches traced: {summary['games'] if summary else 'unknown'}",
        f"- Lion losses captured: {len(losses)}",
        f"- Trainable losses analyzed: {len(trainable)}",
        f"- Lion thunder losses excluded: {len(losses) - len(trainable)}",
        "",
        "## Loss mechanisms",
        "",
    ]
    analyzed_denominator = max(1, len(trainable))
    for name, count in mechanisms.most_common():
        lines.append(f"- {name}: {count} ({count / analyzed_denominator:.1%})")
    lines.extend(["", "## Landing zones", ""])
    for name, count in zones.most_common():
        lines.append(f"- {name}: {count} ({count / analyzed_denominator:.1%})")
    lines.extend(["", "## Top repeated patterns", ""])
    for index, item in enumerate(patterns, 1):
        lines.append(
            f"{index}. {item['server']} / {item['mechanism']} / {item['landingZone']} / "
            f"{item['lengthBucket']}: {item['count']} ({item['shareOfTrainableLionLosses']:.1%}), "
            f"average {item['averageFrames']:.1f} frames, finish `{item['finishSignature']}`"
        )
    lines.extend(["", "## Replayable serve candidates", ""])
    for item in serve_candidates:
        lines.append(
            f"- {item['id']}: phase {item['rlServePhase']}, {item['mechanism']}, "
            f"{item['landingZone']}, observed {item['count']} times, source `{item['sourceTraceId']}`"
        )
    report_path.write_text("\n".join(lines) + "\n", encoding="utf-8")
    return result


if __name__ == "__main__":
    parser = argparse.ArgumentParser()
    parser.add_argument("input", type=Path)
    parser.add_argument("--output", type=Path, default=None)
    parser.add_argument("--report", type=Path, default=None)
    parser.add_argument("--top", type=int, default=20)
    args = parser.parse_args()
    output = args.output or args.input.with_name("lion_loss_patterns.json")
    report = args.report or args.input.with_name("LION_LOSS_REPORT.md")
    result = analyze(args.input, output, report, args.top)
    print(
        json.dumps(
            {
                "status": "complete",
                "patterns": str(output.resolve()),
                "report": str(report.resolve()),
                "lionLosses": result["lionLosses"],
                "serveCandidates": len(result["serveCandidates"]),
            },
            indent=2,
        )
    )
