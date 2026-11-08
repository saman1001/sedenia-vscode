"""Record Codex approval requests for Sedenia without making any decision.

Install this file in ~/.codex/hooks. It writes only a session identifier and
timestamp to sedenia-cakanie/ beside the script. No command, prompt, working
directory or tool arguments are stored. Nothing is printed or executed.
"""

import json
import os
import re
import sys
import tempfile
import time

STATE_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sedenia-cakanie")


def safe_name(session_id: str) -> str:
    """Keep the filename inside the marker directory."""
    return re.sub(r"[^A-Za-z0-9_-]", "_", session_id)[:100]


def main() -> None:
    event = json.loads(sys.stdin.buffer.read().decode("utf-8"))
    if not isinstance(event, dict):
        return
    session_id = event.get("session_id")
    if not isinstance(session_id, str) or not session_id.strip():
        return

    record = {"session_id": session_id, "time_ms": int(time.time() * 1000)}
    os.makedirs(STATE_DIR, exist_ok=True)
    target = os.path.join(STATE_DIR, safe_name(session_id) + ".json")
    # Separate temporary files also allow concurrent requests for one session.
    with tempfile.NamedTemporaryFile(mode="w", encoding="utf-8", dir=STATE_DIR, suffix=".tmp", delete=False) as handle:
        json.dump(record, handle, ensure_ascii=False)
        temporary = handle.name
    os.replace(temporary, target)


if __name__ == "__main__":
    try:
        main()
    except Exception:
        # Monitoring must never block the normal Codex approval workflow.
        pass
    sys.exit(0)
