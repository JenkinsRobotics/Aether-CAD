"""Aether's side of the FreeCAD boundary. Imports no FreeCAD.

Owns one long-lived `freecadcmd` worker per instance and talks to it in JSON
lines. Long-lived because FreeCAD costs ~0.25 s to start and ~2 ms to rebuild;
stateless because the worker closes its document before replying, so a pool of
these is safe to share between users.

ponytail: one worker per engine object, restarted on failure. A pool belongs
in the host once request volume justifies it — the interface below does not
change when it arrives.
"""

from __future__ import annotations

import json
import os
import queue
import shutil
import subprocess
import threading
from pathlib import Path
from typing import Any

from .protocol import (
    AssemblyJob,
    AssemblyResult,
    BuildJob,
    BuildResult,
    assembly_job_to_json,
    assembly_result_from_json,
    job_to_json,
    result_from_json,
)

RESULT_PREFIX = "AETHER_RESULT "
WORKER = Path(__file__).with_name("worker.py")

#: Where FreeCAD's console binary usually lives. `AETHER_FREECAD_CMD` wins, so
#: an operator can point at their own build — which also keeps the LGPL
#: "user may replace the library" expectation honest.
CANDIDATES = (
    "/Applications/FreeCAD.app/Contents/Resources/bin/freecadcmd",
    "/usr/bin/freecadcmd",
    "/usr/local/bin/freecadcmd",
    "/snap/bin/freecad.cmd",
)


class FreeCADUnavailable(RuntimeError):
    """No FreeCAD to talk to. Carries what to do about it."""


def locate_freecad() -> str:
    explicit = os.environ.get("AETHER_FREECAD_CMD")
    if explicit:
        if not Path(explicit).exists():
            raise FreeCADUnavailable(
                f"AETHER_FREECAD_CMD points at {explicit!r}, which does not exist."
            )
        return explicit
    found = shutil.which("freecadcmd") or shutil.which("FreeCADCmd")
    if found:
        return found
    for candidate in CANDIDATES:
        if Path(candidate).exists():
            return candidate
    raise FreeCADUnavailable(
        "FreeCAD was not found. Install it, or set AETHER_FREECAD_CMD to its "
        "freecadcmd binary. See Aether CAD/freecad-engine/README.md."
    )


class FreeCADEngine:
    """A `GeometryEngine` backed by headless FreeCAD."""

    def __init__(self, command: str | None = None, timeout_seconds: float = 60.0):
        self.command = command or locate_freecad()
        self.timeout_seconds = timeout_seconds
        self._process: subprocess.Popen[str] | None = None
        self._lock = threading.Lock()

    # -- lifecycle -----------------------------------------------------

    def _spawn(self) -> subprocess.Popen[str]:
        process = subprocess.Popen(
            [self.command, str(WORKER)],
            stdin=subprocess.PIPE,
            stdout=subprocess.PIPE,
            stderr=subprocess.DEVNULL,
            text=True,
            bufsize=1,
            cwd=str(WORKER.parent.parent),
        )
        return process

    def _worker(self) -> subprocess.Popen[str]:
        if self._process is None or self._process.poll() is not None:
            self._process = self._spawn()
        return self._process

    def close(self) -> None:
        with self._lock:
            process = self._process
            self._process = None
        if process and process.poll() is None:
            try:
                process.stdin.close()  # type: ignore[union-attr]
                process.wait(timeout=5)
            except Exception:
                process.kill()

    def __enter__(self) -> FreeCADEngine:
        return self

    def __exit__(self, *_: object) -> None:
        self.close()

    # -- the boundary --------------------------------------------------

    def _exchange(self, payload: dict[str, Any]) -> dict[str, Any]:
        with self._lock:
            process = self._worker()
            # Bound both pipe writes and reads: a stopped reader must not hang
            # a large sketch payload before the response timeout starts.
            answer = queue.Queue(maxsize=1)

            def read_result():
                try:
                    process.stdin.write(json.dumps(payload) + "\n")
                    process.stdin.flush()
                    while True:
                        line = process.stdout.readline()
                        if not line:
                            raise FreeCADUnavailable(
                                "The FreeCAD worker exited without answering."
                            )
                        if RESULT_PREFIX in line:
                            answer.put(json.loads(line.split(RESULT_PREFIX, 1)[1]))
                            return
                except Exception as error:
                    answer.put(error)

            reader = threading.Thread(target=read_result, daemon=True)
            reader.start()
            try:
                result = answer.get(timeout=self.timeout_seconds)
            except queue.Empty:
                process.kill()
                process.wait(timeout=5)
                self._process = None
                reader.join(timeout=1)
                raise FreeCADUnavailable(
                    "FreeCAD rebuild timed out. Simplify the operation and retry; the next request starts a fresh worker."
                ) from None
            if isinstance(result, Exception):
                self._process = None
                if process.poll() is None:
                    process.kill()
                process.wait(timeout=5)
                if isinstance(result, OSError):
                    raise FreeCADUnavailable(
                        "The FreeCAD worker connection closed before answering."
                    ) from result
                raise result
            return result

    def describe(self) -> dict[str, Any]:
        answer = self._exchange({"request": "describe"})
        return {
            "engine": answer.get("engine", "FreeCAD"),
            "licence": answer.get("licence", "LGPL-2.1-or-later"),
            "protocol": answer.get("protocol"),
            "capabilities": answer.get("capabilities", []),
            "command": self.command,
        }

    def build(self, job: BuildJob) -> BuildResult:
        return result_from_json(self._exchange(job_to_json(job)))

    def solve_assembly(self, job: AssemblyJob) -> AssemblyResult:
        """Place the instances and solve the mates.

        Stateless like `build`: the job carries its part definitions, so the
        engine holds no assembly between calls.
        """
        return assembly_result_from_json(self._exchange(assembly_job_to_json(job)))

    def export(self, job: BuildJob, options: dict[str, Any]) -> dict[str, Any]:
        payload = job_to_json(job)
        payload["export"] = options
        return self._exchange(payload)

    def analyze(self, job: BuildJob, options: dict[str, Any]) -> dict[str, Any]:
        payload = job_to_json(job)
        payload["analysis"] = options
        return self._exchange(payload)
