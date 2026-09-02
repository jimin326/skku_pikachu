from __future__ import annotations

from stats import summarize


def rows(candidate_wins: bool, baseline_wins: bool):
    result = []
    for block in range(4):
        for arm, won in (("candidate", candidate_wins), ("v4", baseline_wins)):
            for side in ("LEFT", "RIGHT"):
                result.append(
                    {
                        "kind": "match",
                        "blockId": f"fixed/{block}/0",
                        "arm": arm,
                        "opponentId": "fixed",
                        "side": side,
                        "won": won,
                    }
                )
                result.append(
                    {
                        "kind": "rally",
                        "blockId": f"fixed/{block}/0",
                        "arm": arm,
                        "opponentId": "fixed",
                        "side": side,
                        "won": won,
                        "frames": 10,
                        "lossCause": None if won else "unknown",
                    }
                )
    return result


def main() -> None:
    identical = summarize(rows(True, True), bootstrap_samples=200, seed=1)
    assert identical["primary"]["estimate"] == 0
    assert identical["primary"]["ci95"] == [0, 0]
    assert identical["primary"]["effectiveBlocks"] == 4

    dominant_rows = rows(True, False)
    dominant = summarize(dominant_rows, bootstrap_samples=200, seed=2)
    assert dominant["primary"]["estimate"] == 1
    assert dominant["primary"]["ci95"] == [1, 1]
    duplicated_rallies = dominant_rows + [row.copy() for row in dominant_rows if row["kind"] == "rally"]
    duplicated = summarize(duplicated_rallies, bootstrap_samples=200, seed=2)
    assert duplicated["primary"]["effectiveBlocks"] == dominant["primary"]["effectiveBlocks"]

    missing = [row for row in dominant_rows if row.get("arm") != "v4"]
    try:
        summarize(missing, bootstrap_samples=10)
        raise AssertionError("missing paired arm was accepted")
    except ValueError as error:
        assert "missing a paired arm" in str(error)
    print("paired statistics tests PASS")


if __name__ == "__main__":
    main()
