"""Exercise the optional hook in isolated temporary directories only."""

import concurrent.futures
import json
from pathlib import Path
import shutil
import subprocess
import sys
import tempfile
import unittest

SOURCE = Path(__file__).resolve().parents[1] / "hooks" / "sedenia_cakanie.py"


class ApprovalHookTests(unittest.TestCase):
    def setUp(self):
        self.directory = Path(tempfile.mkdtemp(prefix="sedenia-hook-space test-"))
        self.script = self.directory / SOURCE.name
        shutil.copy2(SOURCE, self.script)
        self.markers = self.directory / "sedenia-cakanie"

    def run_hook(self, payload):
        result = subprocess.run(
            [sys.executable, "-I", str(self.script)],
            input=payload.encode("utf-8"), capture_output=True, timeout=10,
        )
        self.assertEqual(result.returncode, 0)
        self.assertEqual(result.stdout, b"")
        self.assertEqual(result.stderr, b"")

    def test_only_identifier_and_timestamp_are_recorded(self):
        self.run_hook(json.dumps({"session_id": "test-session", "cwd": "private-folder", "tool_input": {"command": "do-not-store-this"}}))
        record = json.loads((self.markers / "test-session.json").read_text(encoding="utf-8"))
        self.assertEqual(set(record), {"session_id", "time_ms"})
        self.assertEqual(record["session_id"], "test-session")
        self.assertIsInstance(record["time_ms"], int)
        self.assertGreater(record["time_ms"], 0)

    def test_invalid_input_does_not_interrupt_codex(self):
        for payload in ['{', '[]', 'null', '{}', '{"session_id":42}', '{"session_id":""}']:
            with self.subTest(payload=payload):
                self.run_hook(payload)
                self.assertFalse(self.markers.exists())

    def test_session_identifier_cannot_escape_marker_directory(self):
        self.run_hook(json.dumps({"session_id": "../../outside\\name Ž"}))
        files = list(self.markers.iterdir())
        self.assertEqual(len(files), 1)
        self.assertEqual(files[0].parent, self.markers)
        self.assertRegex(files[0].name, r"^[A-Za-z0-9_-]+\.json$")

    def test_concurrent_writes_produce_one_complete_marker(self):
        payload = json.dumps({"session_id": "same-session"})
        with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
            list(pool.map(self.run_hook, [payload] * 8))
        files = list(self.markers.iterdir())
        self.assertEqual([file.name for file in files], ["same-session.json"])
        self.assertEqual(json.loads(files[0].read_text(encoding="utf-8"))["session_id"], "same-session")

    def test_write_failure_does_not_interrupt_codex(self):
        self.markers.write_text("not a directory", encoding="utf-8")
        self.run_hook('{"session_id":"test-session"}')
        self.assertEqual(self.markers.read_text(encoding="utf-8"), "not a directory")


if __name__ == "__main__":
    unittest.main()
