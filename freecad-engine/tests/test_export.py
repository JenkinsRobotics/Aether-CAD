import base64
import json
import subprocess
import pytest
from aether_freecad import FreeCADEngine, BuildJob, Feature


def job():
    return BuildJob(
        features=[
            Feature("s", "sketch-rectangle", {"width_mm": 40, "height_mm": 20}),
            Feature(
                "p",
                "pad",
                {
                    "profile": "s",
                    "distance_mm": 10,
                    "body_id": "plate",
                    "operation": "new",
                },
            ),
            Feature("s2", "sketch-circle", {"radius_mm": 2, "offset_mm": 30}),
            Feature(
                "p2",
                "pad",
                {
                    "profile": "s2",
                    "distance_mm": 5,
                    "body_id": "other",
                    "operation": "new",
                },
            ),
        ]
    )


@pytest.mark.parametrize("format", ["step", "stl"])
def test_export_selected_body_reopens_at_correct_size_and_volume(tmp_path, format):
    with FreeCADEngine() as engine:
        result = engine.export(
            job(), {"format": format, "body_ids": ["plate"], "tolerance_mm": 0.05}
        )
        assert result["status"] == "ok", result
        assert result["body_count"] == 1
        exported = tmp_path / f"part.{format}"
        exported.write_bytes(base64.b64decode(result["data_base64"]))
        output = tmp_path / "metrics.json"
        script = tmp_path / "verify.py"
        script.write_text(
            "import Part,Mesh,json\n"
            + (
                f"s=Part.Shape();s.read({str(exported)!r})\nvalid=s.isValid() and len(s.Solids)==1\n"
                if format == "step"
                else f"s=Mesh.Mesh({str(exported)!r})\nvalid=s.isSolid()\n"
            )
            + f'open({str(output)!r},"w").write(json.dumps([valid,s.Volume,s.BoundBox.XLength,s.BoundBox.YLength,s.BoundBox.ZLength]))\n'
        )
        subprocess.run(
            [engine.command, str(script)],
            input="",
            text=True,
            capture_output=True,
            timeout=20,
            check=True,
        )
        valid, volume, x, y, z = json.loads(output.read_text())
        assert valid
        assert abs(volume) == pytest.approx(8000, rel=1e-5)
        assert [x, y, z] == pytest.approx([40, 20, 10])


def test_export_refuses_partial_build_and_unknown_body():
    with FreeCADEngine() as engine:
        bad = BuildJob(
            features=job().features
            + [Feature("bad", "fillet", {"radius_mm": 1000, "body_id": "plate"})]
        )
        result = engine.export(bad, {"format": "step"})
        assert result["status"] == "error"
        assert "data_base64" not in result
        result = engine.export(job(), {"format": "stl", "body_ids": ["missing"]})
        assert result["status"] == "error"
        assert "data_base64" not in result
