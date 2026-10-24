"""Request helpers for the installed worker's project and settings services."""

import json
import shutil
import subprocess
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1] / "aether_cad_service"


def invoke(tmp_path, action, arguments):
    result = subprocess.run(
        [
            sys.executable,
            "-I",
            "-S",
            str(ROOT / "runtime/runner.pyz"),
            shutil.which("node"),
        ],
        input=json.dumps({"service": "/api/cad/" + action, "arguments": arguments}),
        text=True,
        check=False,
        capture_output=True,
        cwd=tmp_path,
        env={
            "HOME": str(tmp_path),
            "TMPDIR": str(tmp_path),
            "QT_QPA_PLATFORM": "offscreen",
        },
        timeout=45,
    )
    assert result.returncode == 0, result.stderr
    assert not result.stderr
    return json.loads(result.stdout)


# Recipe composition has a container and a two-stage native rebuild; it is
# qualified separately by assembly-recipe.integration.test.ts.

# The service comparisons this module held drove the host geometry services (geometry,
# export, analysis) that are retired: the editor builds in-process. The request helpers stay
# for the project and settings service tests. Archived copy: AetherStudio/migration/archive.
