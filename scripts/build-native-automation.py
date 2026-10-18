"""Package the existing CAD engine boundary; no product/host installation needed."""

import hashlib
import io
import json
import tarfile
import zipfile
from pathlib import Path

root = Path(__file__).resolve().parents[1]
service = root / "service/aether_cad_service"
runtime = service / "runtime"
archive = runtime / "runner.pyz"
# Build-only extraction from the same immutable shared-artwork package used by
# the frontend. The wheel includes this verified resource, never Studio Python.
assets = json.loads((service / "compatibility.json").read_text())["shared_packages"]["@aether/assets"]
asset_bytes = (root / assets["archive"]).read_bytes()
if hashlib.sha256(asset_bytes).hexdigest() != assets["sha256"]:
    raise ValueError("Shared asset archive fingerprint differs")
with tarfile.open(fileobj=io.BytesIO(asset_bytes), mode="r:gz") as package:
    units = package.extractfile("package/cad/units.json").read()
(service / "data").mkdir(exist_ok=True)
(service / "data/units.json").write_bytes(units)
# One document-version authority, also available to isolated Python packages.
(service / "data/part-format.json").write_bytes(
    (root / "aether-engine/src/document/part-format.json").read_bytes()
)
files = {
    "aether_cad_service/data/part-format.json": service / "data/part-format.json",
    "aether_cad_service/part_format.py": service / "part_format.py",
    "aether_cad_service/data/units.json": service / "data/units.json",
    "aether_cad_service/document.py": service / "document.py",
    "aether_cad_service/settings_runtime.py": service / "settings_runtime.py",
    "__main__.py": service / "native_worker.py",
    "aether_cad_service/browser-services.json": service / "browser-services.json",
    "automation-commands.json": service / "automation-commands.json",
    "aether_cad_service/__init__.py": service / "__init__.py",
    "aether_cad_service/project_runtime.py": service / "project_runtime.py",
    "aether_cad_service/assembly_recipe.py": service / "assembly_recipe.py",
    "aether_cad_service/assembly_compose.py": service / "assembly_compose.py",
    "aether_cad_service/assembly_automation.py": service / "assembly_automation.py",
    "aether_cad_service/browser_runtime.py": service / "browser_runtime.py",
    "aether_cad_service/automation_runtime.py": service / "automation_runtime.py",
    "aether_cad_service/program_runtime.py": service / "program_runtime.py",
    "aether_cad_service/runtime/runner.mjs": runtime / "runner.mjs",
    "ATTRIBUTION.md": root / "freecad-engine/ATTRIBUTION.md",
}
files.update(
    {
        str(path.relative_to(root / "freecad-engine")): path
        for path in (root / "freecad-engine/aether_freecad").rglob("*.py")
    }
)
# Only the canonical, dependency-free document codec is included from the
# versioned Animation distribution. No sibling source or installed site packages.
lock = json.loads((root / "vendor/python/workspace-codec.json").read_text())
wheel = root / "vendor/python" / lock["wheel"]
if hashlib.sha256(wheel.read_bytes()).hexdigest() != lock["sha256"]:
    raise ValueError("Workspace codec archive fingerprint differs")
with zipfile.ZipFile(wheel) as dependency:
    codec = {name: dependency.read(name) for name in lock["modules"]}
with zipfile.ZipFile(archive, "w", compression=zipfile.ZIP_DEFLATED) as bundle:
    for name, content in sorted(codec.items()):
        entry = zipfile.ZipInfo(name)
        entry.compress_type = zipfile.ZIP_DEFLATED
        bundle.writestr(entry, content)
    for name, path in sorted(files.items()):
        # Stable package digest for an unchanged build.
        entry = zipfile.ZipInfo(name)
        entry.compress_type = zipfile.ZIP_DEFLATED
        bundle.writestr(entry, path.read_bytes())
commands = json.loads((service / "automation-commands.json").read_text())
manifest = {
    "schema": 1,
    "app": "cad",
    "runtime": "python",
    "entry": archive.name,
    "sha256": hashlib.sha256(archive.read_bytes()).hexdigest(),
    "services": ["/api/cad/" + name for name in json.loads((service / "browser-services.json").read_text())] + ["/api/cad/project-" + action for action in ("create", "read", "edit")] + ["/api/cad/settings-" + action for action in ("read", "edit")],
    "commands": [
        {k: v for k, v in command.items() if k not in ("action", "content_encoding")} for command in commands
    ],
    "binary_commands": [c["id"] for c in commands if c.get("content_encoding") == "base64"],
}
(runtime / "native-worker.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(f"Packaged {len(commands)} CAD commands in {archive.name}")
