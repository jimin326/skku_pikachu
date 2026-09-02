from __future__ import annotations

import hashlib
import json
import subprocess
import sys
import tempfile
from pathlib import Path


def normalized_hash(path: Path) -> str:
    source = path.read_text(encoding="utf-8").replace("\r\n", "\n")
    return hashlib.sha256(source.encode("utf-8")).hexdigest()


def main() -> None:
    here = Path(__file__).resolve().parent
    root = here.parents[2]
    candidate = root / "Lion_Eating_Bank_v4.js"
    manifest = here / "splits" / "validation.json"
    registry = here / "opponents.json"
    with tempfile.TemporaryDirectory(prefix="pikachu-final-") as directory:
        temporary = Path(directory)
        commitment = temporary / "commitment.json"
        commitment.write_text(json.dumps({
            "manifestSha256": hashlib.sha256(manifest.read_bytes()).hexdigest(),
            "candidateSha256Normalized": normalized_hash(candidate),
        }), encoding="utf-8")
        output = temporary / "result"
        command = [
            sys.executable, str(here / "final_once.py"),
            "--commitment", str(commitment), "--manifest", str(manifest),
            "--registry", str(registry), "--candidate", str(candidate),
            "--output-dir", str(output), "--dry-run",
        ]
        subprocess.run(command, check=True, capture_output=True, text=True)
        second = subprocess.run(command, capture_output=True, text=True)
        if second.returncode == 0 or "already started" not in second.stderr:
            raise AssertionError("one-shot guard allowed a second invocation")
    print("sealed-final one-shot dry-run test PASS")


if __name__ == "__main__":
    main()
