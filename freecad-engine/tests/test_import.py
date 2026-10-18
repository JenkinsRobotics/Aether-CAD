import base64
import math
from aether_freecad import BuildJob, Feature, FreeCADEngine
import pytest


def test_saved_step_rebuild_cut_and_reexport():
    with FreeCADEngine() as engine:
        source = BuildJob(
            features=[
                Feature("s", "sketch-rectangle", {"width_mm": 20, "height_mm": 20}),
                Feature("p", "pad", {"profile": "s", "distance_mm": 10}),
            ]
        )
        exported = engine.export(source, {"format": "step"})
        assert exported["status"] == "ok", exported
        imported = Feature(
            "import",
            "import-step",
            {
                "data_base64": exported["data_base64"],
                "body_id": "saved",
                "operation": "new",
            },
        )
        job = BuildJob(features=[imported])
        for _ in range(2):
            result = engine.build(job)
            assert not result.diagnostics
            assert result.bodies[0].id == "saved"
            assert result.bodies[0].volume_mm3 == pytest.approx(4000)
        cut = BuildJob(
            features=[
                imported,
                Feature(
                    "hole",
                    "sketch-circle",
                    {"radius_mm": 2, "center_mm": [10, 10], "offset_mm": 10},
                ),
                Feature(
                    "cut",
                    "pocket",
                    {
                        "profile": "hole",
                        "depth_mm": 10,
                        "body_id": "saved",
                        "operation": "cut",
                    },
                ),
            ]
        )
        result = engine.build(cut)
        assert not result.diagnostics, result.diagnostics
        assert result.bodies[0].volume_mm3 == pytest.approx(4000 - math.pi * 40)
        reexport = engine.export(cut, {"format": "step"})
        assert reexport["status"] == "ok", reexport
        bad = engine.build(
            BuildJob(
                features=[
                    Feature(
                        "bad",
                        "import-step",
                        {"data_base64": base64.b64encode(b"broken").decode()},
                    )
                ]
            )
        )
        assert bad.diagnostics and not bad.bodies
