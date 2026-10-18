"""Assemblies solved by FreeCAD's Assembly workbench, headless.

The solver is Ondsel's multibody one, reached through
`Assembly::AssemblyObject`. These tests are what says it is actually solving
rather than leaving everything where it was put.
"""

import math

import pytest

from aether_freecad import (
    AssemblyJob,
    Feature,
    FreeCADEngine,
    FreeCADUnavailable,
    Instance,
    Joint,
    JointEnd,
    PartDefinition,
)

try:
    ENGINE_AVAILABLE = bool(__import__("aether_freecad").locate_freecad())
except FreeCADUnavailable:
    ENGINE_AVAILABLE = False

needs_freecad = pytest.mark.skipif(
    not ENGINE_AVAILABLE, reason="FreeCAD is not installed on this machine"
)


@pytest.fixture(scope="module")
def engine():
    with FreeCADEngine() as instance:
        yield instance


def _box(part_id, size, height):
    return PartDefinition(part_id, [
        Feature("s", "sketch-rectangle", {"width_mm": size, "height_mm": size}),
        Feature("p", "pad", {"profile": "s", "distance_mm": height}),
    ])


def _two_parts(joint_kind="fastened", placement=(120.0, 75.0, 33.0), **joint_parameters):
    return AssemblyJob(
        parts=[_box("base", 40, 10), _box("block", 20, 20)],
        instances=[
            Instance("i-base", "base", grounded=True),
            Instance("i-block", "block", placement_mm=placement),
        ],
        joints=[Joint("j1", joint_kind,
                      JointEnd("i-base", "Vertex1"), JointEnd("i-block", "Vertex1"),
                      joint_parameters)],
    )


def _placement(result, instance_id):
    return next(i.placement_mm for i in result.instances if i.id == instance_id)


@needs_freecad
def test_a_fastened_mate_moves_the_part_onto_its_target(engine):
    """The point of the whole thing: the solver moves bodies.

    The block starts 120mm away and must end up on the base's corner. If the
    engine were only echoing placements back, this would still read
    (120, 75, 33).
    """
    result = engine.solve_assembly(_two_parts())
    assert result.status == "ok", result.message
    assert not [d for d in result.diagnostics if d["severity"] == "error"]
    assert _placement(result, "i-block") == pytest.approx((0.0, 0.0, 0.0), abs=1e-6)


@needs_freecad
def test_a_grounded_instance_is_not_moved(engine):
    """Grounded means fixed in space — the solver must move the other one."""
    result = engine.solve_assembly(_two_parts())
    assert _placement(result, "i-base") == pytest.approx((0.0, 0.0, 0.0), abs=1e-9)


@needs_freecad
def test_a_revolute_mate_also_brings_the_parts_together(engine):
    """A revolute leaves rotation free but still fixes position."""
    result = engine.solve_assembly(_two_parts("revolute"))
    assert result.status == "ok", result.message
    assert _placement(result, "i-block") == pytest.approx((0.0, 0.0, 0.0), abs=1e-6)


@needs_freecad
def test_a_distance_mate_holds_the_parts_apart(engine):
    """Distance is a mate FreeCAD has and the previous engine did not."""
    result = engine.solve_assembly(_two_parts("distance", distance_mm=25.0))
    assert result.status == "ok", result.message
    moved = _placement(result, "i-block")
    # It moved from where it started, and did not collapse onto the target.
    assert moved != pytest.approx((120.0, 75.0, 33.0), abs=1e-6)
    assert math.dist(moved, (0.0, 0.0, 0.0)) == pytest.approx(25.0, abs=1e-3)


@needs_freecad
def test_nothing_grounded_is_reported_rather_than_solved_meaninglessly(engine):
    """With nothing fixed the whole assembly is free to drift, and any answer
    would be as good as any other. Hold one and say so."""
    job = AssemblyJob(
        parts=[_box("base", 40, 10), _box("block", 20, 20)],
        instances=[Instance("i-base", "base"), Instance("i-block", "block",
                                                        placement_mm=(60.0, 0.0, 0.0))],
        joints=[Joint("j1", "fastened",
                      JointEnd("i-base", "Vertex1"), JointEnd("i-block", "Vertex1"))],
    )
    result = engine.solve_assembly(job)
    assert result.status == "ok", result.message
    warnings = [d for d in result.diagnostics if d["severity"] == "warning"]
    assert warnings and "grounded" in warnings[0]["message"]


@needs_freecad
def test_an_unsupported_mate_kind_is_named(engine):
    result = engine.solve_assembly(_two_parts("teleport"))
    errors = [d for d in result.diagnostics if d["severity"] == "error"]
    assert errors and "teleport" in errors[0]["message"]
    assert result.status == "error"
    assert result.instances == []
    assert "teleport" in result.message


@needs_freecad
def test_a_mate_naming_a_missing_instance_is_reported(engine):
    job = AssemblyJob(
        parts=[_box("base", 40, 10)],
        instances=[Instance("i-base", "base", grounded=True)],
        joints=[Joint("j1", "fastened",
                      JointEnd("i-base", "Vertex1"), JointEnd("i-ghost", "Vertex1"))],
    )
    result = engine.solve_assembly(job)
    errors = [d for d in result.diagnostics if d["severity"] == "error"]
    assert errors and "not in the assembly" in errors[0]["message"]
    assert result.status == "error"
    assert result.instances == []


@needs_freecad
def test_a_failed_part_cannot_publish_a_partial_assembly_and_worker_recovers(engine):
    job = _two_parts()
    broken = PartDefinition("block", [Feature("bad", "missing-feature", {})])
    result = engine.solve_assembly(AssemblyJob(
        parts=[job.parts[0], broken], instances=job.instances, joints=job.joints,
    ))
    assert result.status == "error"
    assert result.instances == []
    assert "part did not build" in result.message
    assert any(d["feature_id"] == "block" and d["severity"] == "error"
               for d in result.diagnostics)
    recovered = engine.solve_assembly(_two_parts())
    assert recovered.status == "ok", recovered.message
    assert _placement(recovered, "i-block") == pytest.approx((0, 0, 0), abs=1e-6)


@needs_freecad
def test_conflicting_mates_report_native_solver_failure_and_no_placements(engine):
    job = _two_parts("distance", distance_mm=10.0)
    third = Instance("third", "block", placement_mm=(0.0, 80.0, 0.0))
    # An impossible triangle (10 + 10 < 50) uses separate instance pairs,
    # avoiding upstream treatment of multiple joints on the same pair.
    joints = [*job.joints,
              Joint("side2", "distance", JointEnd("i-block", "Vertex1"),
                    JointEnd("third", "Vertex1"), {"distance_mm": 10.0}),
              Joint("side3", "distance", JointEnd("i-base", "Vertex1"),
                    JointEnd("third", "Vertex1"), {"distance_mm": 50.0})]
    result = engine.solve_assembly(AssemblyJob(
        parts=job.parts, instances=[*job.instances, third], joints=joints,
    ))
    assert result.status == "error", result
    assert result.instances == []
    assert "solver" in result.message
    recovered = engine.solve_assembly(_two_parts())
    assert recovered.status == "ok", recovered.message


@needs_freecad
def test_one_part_definition_serves_many_instances(engine):
    """A part is built once and placed repeatedly, which is what makes an
    assembly of twenty identical brackets affordable."""
    job = AssemblyJob(
        parts=[_box("bracket", 20, 10)],
        instances=[
            Instance("a", "bracket", grounded=True),
            Instance("b", "bracket", placement_mm=(80.0, 0.0, 0.0)),
            Instance("c", "bracket", placement_mm=(0.0, 80.0, 0.0)),
        ],
        joints=[],
    )
    result = engine.solve_assembly(job)
    assert result.status == "ok", result.message
    assert {i.id for i in result.instances} == {"a", "b", "c"}
    # With no mates, the seeds are the answer: nothing should have moved.
    assert _placement(result, "b") == pytest.approx((80.0, 0.0, 0.0), abs=1e-9)


@needs_freecad
def test_a_mate_connector_frame_is_used_verbatim(engine):
    """An Aether mate joins connectors, not part origins.

    A connector is a joint coordinate system, so the frame is handed to
    FreeCAD and detached from geometry. If it were not, FreeCAD would
    recompute the frame from the referenced object and both parts would meet
    at their origins — this test would read (0, 0, 0).
    """
    job = AssemblyJob(
        parts=[_box("base", 40, 10), _box("block", 20, 20)],
        instances=[
            Instance("i-base", "base", grounded=True),
            Instance("i-block", "block", placement_mm=(120.0, 75.0, 33.0)),
        ],
        joints=[Joint("j1", "fastened",
                      JointEnd("i-base", placement_mm=(30.0, 30.0, 10.0)),
                      JointEnd("i-block", placement_mm=(0.0, 0.0, 0.0)))],
    )
    result = engine.solve_assembly(job)
    assert result.status == "ok", result.message
    assert _placement(result, "i-block") == pytest.approx((30.0, 30.0, 10.0), abs=1e-6)


@needs_freecad
def test_the_connector_offset_on_the_moving_part_counts_too(engine):
    """Both frames matter: offsetting the block's own connector shifts where
    the block ends up by the same amount, in the other direction."""
    def solve(block_connector):
        return engine.solve_assembly(AssemblyJob(
            parts=[_box("base", 40, 10), _box("block", 20, 20)],
            instances=[
                Instance("i-base", "base", grounded=True),
                Instance("i-block", "block", placement_mm=(90.0, 40.0, 12.0)),
            ],
            joints=[Joint("j1", "fastened",
                          JointEnd("i-base", placement_mm=(30.0, 30.0, 10.0)),
                          JointEnd("i-block", placement_mm=block_connector))],
        ))

    at_origin = solve((0.0, 0.0, 0.0))
    offset = solve((5.0, 0.0, 0.0))
    assert at_origin.status == "ok" and offset.status == "ok"
    moved = _placement(offset, "i-block")
    assert moved[0] == pytest.approx(_placement(at_origin, "i-block")[0] - 5.0, abs=1e-6)


@needs_freecad
def test_conflicting_fastened_frames_on_one_pair_do_not_publish_a_false_solution(engine):
    job = _two_parts()
    job.joints[:] = [
        Joint('fixed-a','fastened',JointEnd('i-base',placement_mm=(0,0,0)),JointEnd('i-block',placement_mm=(0,0,0))),
        Joint('fixed-b','fastened',JointEnd('i-base',placement_mm=(10,0,0)),JointEnd('i-block',placement_mm=(0,0,0))),
    ]
    result=engine.solve_assembly(job)
    assert result.status=='error'
    assert result.instances == []
    assert any(d['severity']=='error' for d in result.diagnostics)
    assert engine.solve_assembly(_two_parts()).status=='ok'


@needs_freecad
def test_conflicting_distances_on_one_pair_do_not_publish_a_false_solution(engine):
    job=_two_parts('distance',distance_mm=25)
    job.joints.append(Joint('different-distance','distance',JointEnd('i-base','Vertex1'),JointEnd('i-block','Vertex1'),{'distance_mm':40}))
    result=engine.solve_assembly(job)
    assert result.status=='error'
    assert result.instances == []
    assert any(d['severity']=='error' for d in result.diagnostics)
    assert engine.solve_assembly(_two_parts('distance',distance_mm=25)).status=='ok'


@needs_freecad
def test_consistent_duplicate_fastened_mates_remain_valid(engine):
    job=_two_parts()
    job.joints.append(Joint('same-frame','fastened',JointEnd('i-base','Vertex1'),JointEnd('i-block','Vertex1')))
    result=engine.solve_assembly(job)
    assert result.status=='ok', result.message
    assert _placement(result,'i-block') == pytest.approx((0,0,0),abs=1e-6)


@needs_freecad
@pytest.mark.parametrize("axis, angle, position", [
    ((0, 0, 1), 90, (30, 3, 10)),
    ((0, 0, 1), -90, (30, 7, 10)),
    ((1, 0, 0), 180, (28, 5, 10)),
    ((0, 1, 0), 90, (30, 5, 12)),
])
def test_fastened_connector_rotations_are_checked_in_world_space(engine, axis, angle, position):
    job = _two_parts()
    sine = math.sin(math.radians(angle) / 2)
    rotation = (*[value * sine for value in axis], math.cos(math.radians(angle) / 2))
    job.joints[:] = [Joint(
        'rotated', 'fastened',
        JointEnd('i-base', placement_mm=(30, 5, 10), rotation=rotation),
        JointEnd('i-block', placement_mm=(2, 0, 0), rotation=(0, 0, 0, 1)),
    )]
    result = engine.solve_assembly(job)
    assert result.status == 'ok', result.message
    placed = next(i for i in result.instances if i.id == 'i-block')
    assert placed.placement_mm == pytest.approx(position, abs=1e-6)
    assert abs(sum(a*b for a,b in zip(placed.rotation, rotation))) == pytest.approx(1, abs=1e-6)


@needs_freecad
def test_conflicting_fastened_rotations_on_one_pair_are_rejected(engine):
    job = _two_parts()
    sine = math.sin(math.pi / 4)
    job.joints[:] = [
        Joint('aligned','fastened',JointEnd('i-base',rotation=(0,0,0,1)),JointEnd('i-block',rotation=(0,0,0,1))),
        Joint('rotated','fastened',JointEnd('i-base',rotation=(0,0,sine,sine)),JointEnd('i-block',rotation=(0,0,0,1))),
    ]
    result = engine.solve_assembly(job)
    assert result.status == 'error'
    assert result.instances == []
    assert any(d['severity'] == 'error' for d in result.diagnostics)
