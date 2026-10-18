"""The CAD mate picker and the workspace must offer the same mate types.

`aether_workspace` advertises `supported_mate_type_ids` and rejects anything
else with `unsupported_capability`. The CAD dialog builds its Type dropdown
from a hand-written list in `cad-mate-authoring.ts`. Today the two agree — by
coincidence, not by construction.

That is the same shape as the bug that shipped Shell and Sweep: the toolbar
offered a feature the engine had no builder for, and it failed at build time.
Here it would be worse — the user would author a mate, and the commit would be
refused after the fact.

Read as text so this needs no Node and no build.
"""

import re
from pathlib import Path
import inspect

from aether_animation.aether_workspace import AetherWorkspace  # noqa: F401  (import guard)
from aether_animation.mates import JointType

REPO = Path(__file__).resolve().parents[2]
WORKSPACE = Path(inspect.getfile(AetherWorkspace))
AUTHORING = REPO / "src/cad-mate-authoring.ts"
# The Assembly ribbon was one file until it was split by concern; mate buttons
# now live beside the relations that share their tooling. Read both, so a
# button moving between them does not read as a button disappearing.
RIBBON = (
    REPO / "src/tools/assembly-mates.ts",
    REPO / "src/tools/assembly-relations.ts",
)


def workspace_supported() -> set[str]:
    """The ids the workspace reports in its Assembly capabilities block."""
    source = WORKSPACE.read_text()
    block = re.search(r'"supported_mate_type_ids":\s*\[(.*?)\]', source, re.S)
    assert block, "capabilities no longer advertise supported_mate_type_ids"
    names = re.findall(r"JointType\.(\w+)\.value", block.group(1))
    assert names, "capability list is no longer built from JointType"
    return {JointType[name].value for name in names}


def picker_offers() -> set[str]:
    """The ids the CAD mate dialog puts in its Type dropdown."""
    source = AUTHORING.read_text()
    block = re.search(r"assemblyMateTypeOptions[^=]*=\s*Object\.freeze\(\[(.*?)\]\)", source, re.S)
    assert block, "the mate type option list moved or changed shape"
    return set(re.findall(r'value:\s*"([a-z_]+)"', block.group(1)))


def test_the_picker_offers_exactly_what_the_workspace_accepts():
    offered, supported = picker_offers(), workspace_supported()
    assert offered == supported, (
        f"CAD offers {sorted(offered)} but the workspace accepts "
        f"{sorted(supported)}. A type in the picker but not the workspace is "
        "refused after the user authors it; one in the workspace but not the "
        "picker is simply unreachable."
    )


def test_both_lists_are_real_mate_types():
    """A typo would otherwise make the two sets agree on something invalid."""
    valid = {joint.value for joint in JointType}
    assert picker_offers() <= valid
    assert workspace_supported() <= valid


def test_the_engine_knows_more_mates_than_the_cad_slice_exposes():
    """Assembly v1 is deliberately three of the ten. Stated here so that
    narrowing reads as a decision rather than something going missing."""
    assert workspace_supported() == {"fastened", "revolute", "prismatic"}
    assert len({joint.value for joint in JointType}) == 10


def ribbon_enabled() -> set[str]:
    """The mate kinds the Assembly ribbon offers as usable buttons."""
    for path in RIBBON:
        assert path.is_file(), f"the Assembly ribbon moved again: {path} is gone"
    source = "\n".join(path.read_text() for path in RIBBON)
    return set(re.findall(r'tool\([^)]*"assembly-mate-([a-z-]+)"\)', source))


def test_the_ribbon_offers_no_mate_the_workspace_cannot_author():
    """FreeCAD solves thirteen kinds; the workspace authors three.

    A button needs both halves. Offering a solvable-but-unauthorable mate
    fails only after the user has built the whole thing — the Shell and Sweep
    mistake, later and more expensive.
    """
    extra = sorted(ribbon_enabled() - workspace_supported())
    assert not extra, (
        f"The Assembly ribbon enables {extra}, which the workspace refuses on "
        "commit. Grey them with a reason, or extend the workspace first."
    )


def test_the_ribbon_actually_offers_the_ones_that_do_work():
    """The inverse: a mate that can be authored should not be left greyed."""
    assert ribbon_enabled() == workspace_supported()
