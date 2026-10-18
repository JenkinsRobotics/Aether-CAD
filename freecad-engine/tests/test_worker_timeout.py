import subprocess
import sys
import time

import pytest
from aether_freecad import FreeCADEngine, FreeCADUnavailable


@pytest.mark.parametrize("payload_bytes", [0, 2_000_000])
def test_timeout_discards_stuck_worker_and_next_job_recovers(
    monkeypatch, payload_bytes
):
    engine = FreeCADEngine(command=sys.executable, timeout_seconds=0.1)
    processes = []

    def spawn_stuck():
        process = subprocess.Popen(
            [sys.executable, "-c", "import time;time.sleep(30)"],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )
        processes.append(process)
        return process

    monkeypatch.setattr(engine, "_spawn", spawn_stuck)
    started = time.monotonic()
    with pytest.raises(FreeCADUnavailable, match="timed out"):
        engine._exchange({"request": "describe", "data": "x" * payload_bytes})
    assert time.monotonic() - started < 3
    assert processes[0].poll() is not None
    assert engine._process is None

    def spawn_ready():
        return subprocess.Popen(
            [
                sys.executable,
                "-u",
                "-c",
                'import sys;sys.stdin.readline();print(\'AETHER_RESULT {"engine":"Recovered", "protocol":1}\')',
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )

    monkeypatch.setattr(engine, "_spawn", spawn_ready)
    try:
        assert engine.describe()["engine"] == "Recovered"
    finally:
        engine.close()


def test_native_chatter_without_newline_does_not_hide_result(monkeypatch):
    engine = FreeCADEngine(command=sys.executable, timeout_seconds=1)

    def spawn():
        return subprocess.Popen(
            [
                sys.executable,
                "-u",
                "-c",
                'import sys;sys.stdin.readline();print(\'Recompute...AETHER_RESULT {"engine":"FreeCAD", "protocol":1}\')',
            ],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
        )

    monkeypatch.setattr(engine, "_spawn", spawn)
    try:
        assert engine.describe()["engine"] == "FreeCAD"
    finally:
        engine.close()


def test_closed_input_pipe_reports_unavailable_and_discards_worker(monkeypatch):
    engine = FreeCADEngine(command=sys.executable, timeout_seconds=1)
    process = subprocess.Popen(
        [sys.executable, '-c', 'pass'], stdin=subprocess.PIPE,
        stdout=subprocess.PIPE, stderr=subprocess.DEVNULL, text=True,
    )
    process.wait(timeout=3)
    # Force the real closed pipe path rather than racing the subprocess exit.
    monkeypatch.setattr(engine, '_spawn', lambda: process)
    with pytest.raises(FreeCADUnavailable, match='connection closed'):
        engine.describe()
    assert engine._process is None
