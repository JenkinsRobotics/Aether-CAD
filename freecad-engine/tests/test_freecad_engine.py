"""End-to-end against a real FreeCAD. Skipped when it is not installed."""

import math

import pytest

from aether_freecad import BuildJob, Feature, FreeCADEngine, FreeCADUnavailable

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


@needs_freecad
def test_describe_reports_the_engine_and_its_licence(engine):
    described = engine.describe()
    assert described["engine"].startswith("FreeCAD")
    assert described["licence"] == "LGPL-2.1-or-later"


@needs_freecad
def test_a_constrained_sketch_and_pad_produce_a_solid(engine):
    """The baseline claim: FreeCAD's own solver and feature build the part."""
    result = engine.build(
        BuildJob(
            features=[
                Feature("s1", "sketch-rectangle", {"width_mm": 40, "height_mm": 20}),
                Feature("p1", "pad", {"profile": "s1", "distance_mm": 10}),
            ]
        )
    )
    assert result.status == "ok", result.message
    assert len(result.bodies) == 1
    body = result.bodies[0]
    assert body.volume_mm3 == pytest.approx(8000.0, rel=1e-9)
    assert body.face_count == 6
    assert body.edge_count == 12
    # Geometry the browser can actually draw, and identity it can select.
    # Tessellation is per face, so a cube's shared corners are duplicated —
    # 6 faces x 4 corners — which is what gives each face its own normal.
    assert len(body.vertices) == 3 * 24
    assert len(body.normals) == len(body.vertices)
    assert len(body.triangles) == 3 * 12
    assert body.face_names[:2] == ["Face1", "Face2"]

    # Every triangle belongs to exactly one face, which is what picking needs.
    assert len(body.face_ranges) == 6
    assert sum(r["count"] for r in body.face_ranges) == len(body.triangles) // 3
    face_ids = [r["faceId"] for r in body.face_ranges]
    assert len(set(face_ids)) == 6, "each face needs its own id to be selectable"
    # The id a triangle carries must be the id its topology entry is filed
    # under, or the viewer looks up a face and finds nothing.
    assert sorted(face_ids) == sorted(t["id"] for t in body.topology)
    # Upper case, and "CYLINDRE" for cylinders: the viewer matches these
    # strings, and they follow the TypeScript engine this one stands in for.
    assert {t["surfaceType"] for t in body.topology} == {"PLANE"}

    # Edge display lines: 12 straight edges, one segment pair each.
    assert len(body.edge_lines) == 12 * 2 * 3

    # Normals are unit length and axis-aligned for a box.
    triples = [body.normals[i : i + 3] for i in range(0, len(body.normals), 3)]
    for normal in triples:
        assert abs(sum(component**2 for component in normal) - 1.0) < 1e-9


@needs_freecad
def test_parameters_drive_the_result(engine):
    """Same features, different numbers, proportional volume."""
    def volume(distance):
        return engine.build(
            BuildJob(
                features=[
                    Feature("s1", "sketch-rectangle", {"width_mm": 40, "height_mm": 20}),
                    Feature("p1", "pad", {"profile": "s1", "distance_mm": distance}),
                ]
            )
        ).bodies[0].volume_mm3

    assert volume(25) == pytest.approx(20000.0, rel=1e-9)
    assert volume(10) == pytest.approx(8000.0, rel=1e-9)


@needs_freecad
def test_rollback_truncates_the_feature_list(engine):
    """Rollback is expressed in the job, so the engine stays stateless."""
    features = [
        Feature("s1", "sketch-rectangle", {"width_mm": 40, "height_mm": 20}),
        Feature("p1", "pad", {"profile": "s1", "distance_mm": 10}),
    ]
    rolled = engine.build(BuildJob(features=features, rollback=1))
    assert rolled.status == "ok"
    # A sketch alone is no solid.
    assert rolled.bodies == [] or rolled.bodies[0].volume_mm3 == pytest.approx(0.0)


@needs_freecad
def test_a_bad_feature_is_reported_against_its_id_and_does_not_lose_the_build(engine):
    result = engine.build(
        BuildJob(
            features=[
                Feature("s1", "sketch-rectangle", {"width_mm": 40, "height_mm": 20}),
                Feature("p1", "pad", {"profile": "s1", "distance_mm": 10}),
                Feature("bad", "unicorn", {}),
            ]
        )
    )
    assert [d["feature_id"] for d in result.diagnostics if d["severity"] == "error"] == ["bad"]
    # The valid features still built.
    assert result.bodies[0].volume_mm3 == pytest.approx(8000.0, rel=1e-9)


@needs_freecad
def test_a_negative_dimension_is_refused_rather_than_guessed(engine):
    result = engine.build(
        BuildJob(features=[Feature("s1", "sketch-rectangle", {"width_mm": -5})])
    )
    assert any(d["severity"] == "error" for d in result.diagnostics), result


@needs_freecad
def test_face_ids_survive_a_rebuild_in_a_fresh_process():
    """The whole point of naming faces ourselves.

    A construction plane saves the id of the face it was built on, so an id
    that changes between builds leaves the saved reference pointing at
    nothing. FreeCAD's own `hashCode` is the TShape address and does exactly
    that, which is why we derive ids from geometry instead. Two separate
    engines means two separate FreeCAD processes — the case an in-process
    rebuild would not catch.
    """
    job = BuildJob(
        features=[
            Feature("s1", "sketch-rectangle", {"width_mm": 40, "height_mm": 20}),
            Feature("p1", "pad", {"profile": "s1", "distance_mm": 10}),
        ]
    )
    ids = []
    for _ in range(2):
        with FreeCADEngine() as instance:
            result = instance.build(job)
            assert result.status == "ok", result.message
            ids.append([r["faceId"] for r in result.bodies[0].face_ranges])
    assert ids[0] == ids[1]


@needs_freecad
def test_every_face_frame_is_orthonormal(engine):
    """Snaps, mates and sketch-on-face all hang off these frames.

    FreeCAD's `Vector.multiply()` scales in place and returns the same object,
    so building a frame with it quietly scaled the normal the frame was being
    built from — a face square to the fallback X axis came back with a zero
    normal. Zero vectors are not a crash, they are a part that cannot be
    sketched on, so assert the frames are actually frames.
    """
    result = engine.build(
        BuildJob(
            features=[
                Feature("s1", "sketch-rectangle", {"width_mm": 40, "height_mm": 20}),
                Feature("p1", "pad", {"profile": "s1", "distance_mm": 10}),
            ]
        )
    )
    assert result.status == "ok", result.message
    centres = [
        candidate
        for face in result.bodies[0].topology
        for candidate in face["candidates"]
        if candidate["kind"] == "face-center"
    ]
    assert len(centres) == 6
    for frame in centres:
        axes = [frame["xAxis"], frame["yAxis"], frame["zAxis"]]
        for axis in axes:
            length = sum(component**2 for component in axis) ** 0.5
            assert length == pytest.approx(1.0, abs=1e-9), f"not a unit axis: {axis}"
        for first, second in ((0, 1), (1, 2), (2, 0)):
            dot = sum(a * b for a, b in zip(axes[first], axes[second]))
            assert dot == pytest.approx(0.0, abs=1e-9), f"axes not square: {axes}"
    # A box points four different ways around its sides, so a frame builder
    # that collapses everything onto one axis fails here.
    assert len({tuple(frame["zAxis"]) for frame in centres}) >= 5


def _ring_job(angle_degrees):
    """A 20x10 rectangle held 2mm off the X axis, swept about it."""
    return BuildJob(
        features=[
            Feature(
                "s1",
                "sketch-polygon",
                {"points_mm": [[5, 2], [25, 2], [25, 12], [5, 12]], "plane": "XY"},
            ),
            Feature("r1", "revolve", {"profile": "s1", "axis": "X",
                                      "angle_deg": angle_degrees}),
        ]
    )


@needs_freecad
def test_revolve_sweeps_the_profile_about_a_named_axis(engine):
    result = engine.build(_ring_job(360))
    assert result.status == "ok", result.message
    # Pappus: a full sweep is 2*pi*(centroid radius)*(profile area). The
    # profile spans y 2..12, so its centroid sits 7mm off the axis.
    expected = 2 * math.pi * 7 * (20 * 10)
    assert result.bodies[0].volume_mm3 == pytest.approx(expected, rel=1e-6)


@needs_freecad
def test_a_partial_revolve_is_its_fraction_of_the_full_one(engine):
    quarter = engine.build(_ring_job(90))
    assert quarter.status == "ok", quarter.message
    expected = 2 * math.pi * 7 * (20 * 10) / 4
    assert quarter.bodies[0].volume_mm3 == pytest.approx(expected, rel=1e-6)


@needs_freecad
@pytest.mark.parametrize("kind", ["fillet", "chamfer"])
def test_edge_finishes_take_material_off_every_edge(engine, kind):
    """Both round or cut back the box, so both must lose volume."""
    result = engine.build(
        BuildJob(
            features=[
                Feature("s1", "sketch-rectangle", {"width_mm": 40, "height_mm": 20}),
                Feature("p1", "pad", {"profile": "s1", "distance_mm": 10}),
                Feature("f1", kind, {"radius_mm": 2}),
            ]
        )
    )
    assert result.status == "ok", result.message
    volume = result.bodies[0].volume_mm3
    assert 0 < volume < 8000, "an edge finish must remove material from the box"
    # A chamfer cuts the corner straight across; a fillet leaves the arc, so
    # the chamfer always takes more. Asserting the order catches the two being
    # wired to each other's FreeCAD feature.
    assert result.bodies[0].face_count > 6


@needs_freecad
def test_a_fillet_takes_less_material_than_the_chamfer_beside_it(engine):
    def volume(kind):
        result = engine.build(
            BuildJob(
                features=[
                    Feature("s1", "sketch-rectangle",
                            {"width_mm": 40, "height_mm": 20}),
                    Feature("p1", "pad", {"profile": "s1", "distance_mm": 10}),
                    Feature("f1", kind, {"radius_mm": 2}),
                ]
            )
        )
        assert result.status == "ok", result.message
        return result.bodies[0].volume_mm3

    assert volume("chamfer") < volume("fillet")


@needs_freecad
def test_an_unbuildable_feature_is_reported_not_silently_dropped(engine):
    """A part that half-built must say so, or the viewer lies about the model."""
    result = engine.build(
        BuildJob(
            features=[
                Feature("s1", "sketch-rectangle", {"width_mm": 40, "height_mm": 20}),
                Feature("p1", "pad", {"profile": "s1", "distance_mm": 10}),
                Feature("f1", "fillet", {"radius_mm": -1}),
            ]
        )
    )
    errors = [d for d in result.diagnostics if d["severity"] == "error"]
    assert errors, "a rejected feature has to surface as a diagnostic"
    assert errors[0]["feature_id"] == "f1"


@needs_freecad
@pytest.mark.parametrize("offset_mm", [0, 40])
def test_mirror_repeats_a_feature_across_a_plane(engine, offset_mm):
    """An offset mirror plane needs a datum; the origin planes sit at zero."""
    result = engine.build(
        BuildJob(
            features=[
                Feature(
                    "s1",
                    "sketch-polygon",
                    {"points_mm": [[10, 0], [30, 0], [30, 10], [10, 10]]},
                ),
                Feature("p1", "pad", {"profile": "s1", "distance_mm": 5}),
                Feature("m1", "mirror",
                        {"source": "p1", "plane": "YZ", "offset_mm": offset_mm}),
            ]
        )
    )
    assert result.status == "ok", result.message
    assert not [d for d in result.diagnostics if d["severity"] == "error"]
    # The pad is 20x10x5; mirrored it is that twice. FreeCAD computes the
    # mirror even when the body tip is left behind, so asserting the volume is
    # what catches a mirror that built but was never shown.
    assert result.bodies[0].volume_mm3 == pytest.approx(2000.0, rel=1e-9)


def _curved_wire(closed=True):
    """Line, arc through a middle point, then a cubic bezier — the three
    segment kinds a drawn contour can hold."""
    segments = [
        {"type": "line", "end": [20, 0]},
        {"type": "arc", "middle": [26, 6], "end": [20, 12]},
    ]
    if closed:
        segments.append({"type": "bezier", "controls": [[14, 18], [6, 16]], "end": [0, 0]})
    return Feature("s1", "sketch-wire", {"start_mm": [0, 0], "segments": segments})


@needs_freecad
def test_a_drawn_contour_with_curves_builds(engine):
    """`sketch-wire` is what a hand-drawn region translates to.

    Sketcher takes a `Part.Arc` as-is but rejects a raw Bezier, so the bezier
    goes in as the degree-3 B-spline it already is. Without that this whole
    feature kind was simply unsupported, and the part failed to build.
    """
    result = engine.build(
        BuildJob(features=[_curved_wire(), Feature("p1", "pad", {"profile": "s1", "distance_mm": 5})])
    )
    assert result.status == "ok", result.message
    assert not [d for d in result.diagnostics if d["severity"] == "error"]
    body = result.bodies[0]
    assert body.volume_mm3 > 0
    # One face per segment plus the two caps: the curves survived as curves.
    assert body.face_count == 5


@needs_freecad
def test_an_open_profile_is_refused_rather_than_built_into_nothing(engine):
    """FreeCAD pads an open wire to no solid and still reports success, so the
    feature would vanish from the part with nothing said about it."""
    result = engine.build(
        BuildJob(
            features=[
                _curved_wire(closed=False),
                Feature("p1", "pad", {"profile": "s1", "distance_mm": 5}),
            ]
        )
    )
    errors = [d for d in result.diagnostics if d["severity"] == "error"]
    assert errors, "an open profile must be reported, not silently dropped"
    assert "closed profile" in errors[0]["message"]
    assert errors[0]["feature_id"] == "p1"


@needs_freecad
def test_sweep_runs_a_profile_along_a_path(engine):
    """The UI offers Sweep, so the engine has to build one.

    A 10x10 profile carried 40mm along a straight path is 4000mm3 — if the
    spine were ignored and the profile merely padded, the number would differ.
    """
    result = engine.build(
        BuildJob(
            features=[
                Feature("s1", "sketch-polygon",
                        {"points_mm": [[-5, -5], [5, -5], [5, 5], [-5, 5]], "plane": "XY"}),
                Feature("s2", "sketch-wire",
                        {"start_mm": [0, 0], "plane": "XZ",
                         "segments": [{"type": "line", "end": [0, 40]}]}),
                Feature("w1", "sweep", {"profile": "s1", "path": "s2"}),
            ]
        )
    )
    assert result.status == "ok", result.message
    assert not [d for d in result.diagnostics if d["severity"] == "error"]
    assert result.bodies[0].volume_mm3 == pytest.approx(4000.0, rel=1e-9)


def _shelled_box(**shell):
    return BuildJob(
        features=[
            Feature("s1", "sketch-rectangle", {"width_mm": 40, "height_mm": 20}),
            Feature("p1", "pad", {"profile": "s1", "distance_mm": 10}),
            Feature("h1", "shell", shell),
        ]
    )


@needs_freecad
def test_shell_hollows_the_solid_and_opens_the_named_face(engine):
    result = engine.build(
        _shelled_box(thickness_mm=2, removed_plane="XY", removed_offset_mm=10)
    )
    assert result.status == "ok", result.message
    assert not [d for d in result.diagnostics if d["severity"] == "error"]
    # Hollow, so well under the solid 8000, and still a real solid.
    assert 0 < result.bodies[0].volume_mm3 < 8000


@needs_freecad
def test_a_shell_whose_opening_plane_matches_nothing_says_so(engine):
    """Faces are chosen by the plane they lie in, so a plane that matches none
    would otherwise shell the solid closed and look like it worked."""
    result = engine.build(
        _shelled_box(thickness_mm=2, removed_plane="XY", removed_offset_mm=999)
    )
    errors = [d for d in result.diagnostics if d["severity"] == "error"]
    assert errors and "no face on that plane" in errors[0]["message"]
