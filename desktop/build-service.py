"""Freeze the release-pinned codec and CAD services; no system Python at runtime."""
import subprocess
import shutil
import sys
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
staging = root / "build/desktop-service-source"
if staging.exists():
    shutil.rmtree(staging)
staging.mkdir(parents=True, exist_ok=True)
with zipfile.ZipFile(root / "service/aether_cad_service/runtime/runner.pyz") as archive:
    archive.extractall(staging)
subprocess.run([
    sys.executable, "-m", "PyInstaller", "--noconfirm", "--clean", "--onedir",
    "--name", "cad-service", "--paths", str(staging),
    "--collect-all", "aether_cad_service", "--collect-all", "aether_animation",
    "--add-data", str(staging / "aether_cad_service") + ":aether_cad_service",
    "--add-data", str(staging / "aether_animation") + ":aether_animation",
    "--distpath", str(root / "build/desktop-service"),
    "--workpath", str(root / "build/desktop-service-work"),
    "--specpath", str(root / "build"), str(root / "desktop/service.py"),
], check=True)
