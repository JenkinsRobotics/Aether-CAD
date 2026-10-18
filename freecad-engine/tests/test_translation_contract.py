"""The translator and the worker have to agree on the feature kinds.

Three separate breakages came from the same shape: a kind was added to
`freecad-translate.ts`, the toolbar un-greyed the tool that produces it, and
the Python worker had no builder — so the part failed at build time with
"unsupported feature kind". The two sides live in different languages and
different lanes, which is exactly why nothing caught it.

This reads both files as text rather than importing them. That is the point:
it needs no Node, no build step and no FreeCAD, so it runs everywhere.
"""

import re
from pathlib import Path

REPO = Path(__file__).resolve().parents[2]
TRANSLATOR = REPO / "src/freecad-translate.ts"
WORKER = REPO / "freecad-engine/aether_freecad/worker.py"


def emitted_kinds():
    """Every `kind: "..."` the translator can put on the wire."""
    return set(re.findall(r'kind:\s*"([a-z-]+)"', TRANSLATOR.read_text()))


def built_kinds():
    """Every kind the worker's dispatch actually handles."""
    source = WORKER.read_text()
    kinds = set(re.findall(r'feature\.kind\s*==\s*"([a-z-]+)"', source))
    for group in re.findall(r'feature\.kind\s+in\s+\(([^)]*)\)', source):
        kinds.update(re.findall(r'"([a-z-]+)"', group))
    kinds.update(re.findall(r'"(sketch-[a-z-]+)":\s*_[a-z_]+', source))
    return kinds


def test_the_translator_emits_nothing_the_worker_cannot_build():
    missing = sorted(emitted_kinds() - built_kinds())
    assert not missing, (
        "These feature kinds reach the engine and fail at build time: "
        f"{missing}. Add a builder in aether_freecad/worker.py, or stop "
        "emitting the kind in freecad-translate.ts."
    )


def test_the_contract_is_actually_being_read():
    """A regex that quietly matched nothing would make the check above pass
    forever. Pin the kinds both sides are known to share."""
    emitted, built = emitted_kinds(), built_kinds()
    assert {"pad", "pocket", "revolve", "sweep", "shell"} <= emitted
    assert {"pad", "pocket", "revolve", "sweep", "shell"} <= built
