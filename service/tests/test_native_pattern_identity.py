"""Whole-body pattern identities survive the packaged save/rebuild boundary."""
import json

import pytest
from test_native_connected_profile import invoke, bodies


def test_pattern_copy_ids_survive_suppression_restoration_and_reopen(tmp_path):
    document = {
        "format": "aether-part", "formatVersion": 22, "documentId": "pattern-contract",
        "name": "Body pattern", "units": "millimeter", "features": [
            {"id": "profile", "name": "Rectangle", "type": "profile", "suppressed": False,
             "plane": "XY", "offsetMillimeters": 0, "profile": {"type": "polygon", "pointsMillimeters": [[10, 0], [20, 0], [20, 10], [10, 10]]}},
            {"id": "pad", "name": "Extrude", "type": "extrude", "suppressed": False,
             "profileFeatureId": "profile", "operation": "new", "bodyId": "base", "distanceMillimeters": 5},
            {"id": "plane", "name": "Datum", "type": "plane", "suppressed": False, "plane": "YZ", "offsetMillimeters": 0},
            {"id": "axis", "name": "Axis", "type": "axis", "suppressed": False,
             "definition": {"method": "two-planes", "references": [{"kind": "feature", "featureId": "plane"}, {"kind": "principal", "plane": "XZ"}]}},
            {"id": "pattern", "name": "Pattern", "type": "pattern", "suppressed": False,
             "sourceFeatureId": "pad", "patternType": "polar", "axis": "Z", "count": 3,
             "axisReference": {"kind": "feature", "featureId": "axis"}, "angleDegrees": 360,
             "reversed": False, "bodyIds": ["base"], "copyBodyIds": {"base": "copy"}},
        ],
    }
    first = bodies(invoke(tmp_path, document))
    assert {body["id"] for body in first} == {"base", "copy:1", "copy:2"}
    assert [body["volume_mm3"] for body in first] == pytest.approx([500, 500, 500])
    suppressed = invoke(tmp_path, document, "cad.feature.suppress", {"feature_id": "plane", "action": "suppress"})
    assert len(bodies(suppressed)) == 1
    hidden = json.loads(suppressed["content"])
    assert [f["id"] for f in hidden["features"] if f["suppressed"]] == ["plane", "axis", "pattern"]
    restored = invoke(tmp_path, hidden, "cad.feature.suppress", {"feature_id": "pattern", "action": "unsuppress"})
    assert bodies(restored) == first
    saved = tmp_path / "Pattern.acpart"
    saved.write_text(restored["content"])
    assert bodies(invoke(tmp_path, json.loads(saved.read_text()))) == first
