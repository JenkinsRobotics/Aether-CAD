"""Native CAD commands through the real host revision/permission boundary."""

import base64
import json
import os
import subprocess
import sys
import threading
from http.server import ThreadingHTTPServer
from pathlib import Path

import pytest
from aether_cad_service.automation import execute, worker
from aether_cad_service.service import CADService
from core.host.products import Products
from core.host.server import StudioHost, make_handler
from core.host.state import Problem


def part_bytes():
    return json.dumps(
        {
            "format": "aether-part",
            "formatVersion": 3,
            "documentId": "agent-part",
            "name": "Agent part",
            "units": "millimeter",
            "features": [
                {
                    "id": "profile",
                    "type": "profile",
                    "name": "Profile",
                    "plane": "XY",
                    "offsetMillimeters": 0,
                    "suppressed": False,
                    "profile": {
                        "type": "polygon",
                        "pointsMillimeters": [[0, 0], [10, 0], [10, 20], [0, 20]],
                    },
                },
                {
                    "id": "pad",
                    "type": "extrude",
                    "name": "Extrude",
                    "profileFeatureId": "profile",
                    "distanceMillimeters": 5,
                    "operation": "new",
                    "suppressed": False,
                },
            ],
        }
    ).encode()


def test_invalid_assembly_archive_is_a_product_validation_error():
    with pytest.raises(Problem) as error:
        execute(CADService(), "cad.assembly.inspect", b"not an archive", {})
    assert error.value.status == 400


@pytest.fixture
def host(tmp_path):
    dist = tmp_path / "dist"
    dist.mkdir()
    (dist / "index.html").write_text("test")
    host = StudioHost(
        tmp_path / "data",
        packages={"cad": ("CAD", "cad", dist)},
        products=Products({"cad": CADService}),
    )
    host.store.create_user("owner", "test-cad-agent-password", "admin", False)
    session = host.store.sign_in("owner", "test-cad-agent-password", "local")

    def call(path, data=None, token=session):
        with host.lock:
            return host.dispatch(path, data or {}, token, "local")

    file = call(
        "/api/library/create",
        {
            "app": "cad",
            "name": "Agent.acpart",
            "data_base64": base64.b64encode(part_bytes()).decode(),
        },
    )

    def grant(**opts):
        return call(
            "/api/automation/connections/create",
            {"label": "CAD test", "apps": ["cad"], **opts},
        )["token"]

    def command(name, token, **args):
        return call(
            "/api/automation/commands/run",
            {"id": name, "arguments": {"app": "cad", "id": file["id"], **args}},
            token,
        )["result"]

    yield host, call, file, grant, command
    for engine in host.products.get("cad").engines.values():
        engine.close()
    host.store.db.close()


def test_inspect_and_edit_permission_before_worker(host):
    _, call, _, grant, command = host
    token = grant()
    result = command("cad.part.inspect", token)
    assert result["saved_state_only"] and not result["changed"]
    assert [f["id"] for f in result["features"]] == ["profile", "pad"]
    assert (
        len(
            [
                c
                for c in call("/api/automation/commands/list", token=token)["commands"]
                if c["id"].startswith("cad.")
            ]
        )
        == 10
    )
    with pytest.raises(Problem) as error:
        command(
            "cad.extrude.setdepth",
            token,
            feature_id="pad",
            depth_mm=10,
            expected_revision=1,
        )
    assert error.value.status == 403


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_FREECAD") != "1", reason="Required native release gate"
)
def test_native_preview_edit_conflict_and_history_restore(host):
    _, call, file, grant, command = host
    token = grant(can_write=True, can_edit_content=True)
    p = command("cad.extrude.preview", token, feature_id="pad", depth_mm=8)
    assert (
        not p["changed"]
        and p["document"]["revision"] == 1
        and p["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(1600)
    )
    edited = command(
        "cad.extrude.setdepth", token, feature_id="pad", depth_mm=8, expected_revision=1
    )
    assert edited["changed"] and edited["document"]["revision"] == 2
    body_id = edited["evaluated_bodies"][0]["id"]
    faces = command("cad.part.topology", token, body_id=body_id)
    assert faces["coordinate_units"] == "millimeter" and len(faces["faces"]) == 6
    assert all(face["id"] and face["candidates"] for face in faces["faces"])
    assert faces["document"]["revision"] == 2 and not faces["changed"]
    assert not command(
        "cad.extrude.setdepth", token, feature_id="pad", depth_mm=8, expected_revision=2
    )["changed"]
    with pytest.raises(Problem) as e:
        command(
            "cad.extrude.setdepth",
            token,
            feature_id="pad",
            depth_mm=9,
            expected_revision=1,
        )
    assert e.value.status == 409
    with pytest.raises(Problem):
        command(
            "cad.feature.move",
            token,
            feature_id="pad",
            direction=-1,
            expected_revision=2,
        )
    assert command("cad.part.inspect", token)["document"]["revision"] == 2
    call(
        "/api/library/restore",
        {"app": "cad", "id": file["id"], "revision": 1, "expected_revision": 2},
    )
    restored = command("cad.part.evaluate", token)
    assert restored["document"]["revision"] == 3 and restored["evaluated_bodies"][0][
        "volume_mm3"
    ] == pytest.approx(1000)


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_FREECAD") != "1", reason="Required native release gate"
)
def test_native_rejection_never_saves_and_next_command_recovers(host):
    _, call, file, grant, command = host
    source = json.loads(part_bytes())
    source["features"][-1].update(operation="intersect", targetBodyId="missing")
    call(
        "/api/library/save",
        {
            "app": "cad",
            "id": file["id"],
            "expected_revision": 1,
            "data_base64": base64.b64encode(json.dumps(source).encode()).decode(),
        },
    )
    token = grant(can_write=True, can_edit_content=True)
    with pytest.raises(Problem):
        command(
            "cad.extrude.setdepth",
            token,
            feature_id="pad",
            depth_mm=8,
            expected_revision=2,
        )
    assert command("cad.part.inspect", token)["document"]["revision"] == 2
    call(
        "/api/library/restore",
        {"app": "cad", "id": file["id"], "revision": 1, "expected_revision": 2},
    )
    assert command("cad.part.evaluate", token)["evaluated_bodies"][0][
        "volume_mm3"
    ] == pytest.approx(1000)


def test_malformed_and_bounded_requests():
    for content in (b"bad", b"\xff", b"a" * (4 * 1024 * 1024 + 1)):
        with pytest.raises(Problem):
            execute(CADService(), "cad.part.inspect", content, {})
    assert (
        Path(__file__)
        .parents[1]
        .joinpath("aether_cad_service/runtime/runner.mjs")
        .is_file()
    )


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_FREECAD") != "1", reason="Required native release gate"
)
def test_real_mcp_http_native_edit_and_stale_revision(host):
    studio, _, file, grant, _ = host
    key = grant(can_write=True, can_edit_content=True)
    server = ThreadingHTTPServer(("127.0.0.1", 0), make_handler(studio))
    server.daemon_threads = True
    address = f"http://127.0.0.1:{server.server_port}"
    studio.running_settings["public_url"] = address
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()

    def tool(ident, name, **args):
        return {
            "jsonrpc": "2.0",
            "id": ident,
            "method": "tools/call",
            "params": {
                "name": name,
                "arguments": {"app": "cad", "id": file["id"], **args},
            },
        }

    calls = [
        {
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2025-11-25",
                "capabilities": {},
                "clientInfo": {"name": "cad-test", "version": "1"},
            },
        },
        {"jsonrpc": "2.0", "method": "notifications/initialized"},
        {"jsonrpc": "2.0", "id": 2, "method": "tools/list"},
        tool(3, "cad_extrude_preview", feature_id="pad", depth_mm=8),
        tool(
            4, "cad_extrude_setdepth", feature_id="pad", depth_mm=8, expected_revision=1
        ),
        tool(5, "cad_part_evaluate"),
        tool(
            6, "cad_extrude_setdepth", feature_id="pad", depth_mm=9, expected_revision=1
        ),
    ]
    try:
        process = subprocess.run(
            [sys.executable, "-m", "core.host.automation", "mcp"],
            input="\n".join(map(json.dumps, calls)) + "\n",
            text=True,
            capture_output=True,
            timeout=60,
            check=False,
            env={
                **os.environ,
                "AETHER_SERVER_URL": address,
                "AETHER_AUTOMATION_TOKEN": key,
            },
        )
        assert process.returncode == 0, process.stderr
        assert key not in process.stdout + process.stderr
        replies = [json.loads(line) for line in process.stdout.splitlines()]
        assert len(replies) == 6
        assert "cad_extrude_setoffset" in {
            t["name"] for t in replies[1]["result"]["tools"]
        }
        preview = replies[2]["result"]["structuredContent"]["result"]
        edited = replies[3]["result"]["structuredContent"]["result"]
        evaluated = replies[4]["result"]["structuredContent"]["result"]
        assert not preview["changed"] and preview["document"]["revision"] == 1
        assert edited["changed"] and edited["document"]["revision"] == 2
        assert evaluated["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(1600)
        assert replies[5]["result"]["isError"]
    finally:
        server.shutdown()
        server.server_close()
        thread.join()


def test_missing_runtime_and_timeout_fail_clearly(monkeypatch):
    import aether_cad_service.automation_runtime as module

    def timed_out(*args, **kwargs):
        raise subprocess.TimeoutExpired("node", 15)

    monkeypatch.setattr(module.subprocess, "run", timed_out)
    with pytest.raises(Problem) as error:
        worker({})
    assert error.value.status == 504
    monkeypatch.setattr(module.shutil, "which", lambda name: None)
    with pytest.raises(Problem) as error:
        worker({})
    assert error.value.status == 503


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_FREECAD") != "1", reason="Required native release gate"
)
def test_native_agent_finalizes_attached_sketch_after_upstream_edit():
    source = json.loads(part_bytes())
    source["features"][1]["bodyId"] = "block"
    source["features"].append(
        {
            "id": "attached",
            "name": "Attached",
            "type": "profile",
            "plane": "XY",
            "offsetMillimeters": 0,
            "suppressed": False,
            "profile": {
                "type": "circle",
                "radiusMillimeters": 1,
                "centerMillimeters": [0, 0],
            },
            "frame": {
                "originMillimeters": [5, 10, 5],
                "normal": [0, 0, 1],
                "xDirection": [1, 0, 0],
            },
            "support": {
                "sourceFeatureId": "pad",
                "bodyId": "block",
                "normal": [0, 0, 1],
                "xDirection": [1, 0, 0],
                "label": "Face of Extrude",
            },
        }
    )
    service = CADService()
    try:
        result = execute(
            service,
            "cad.extrude.setdepth",
            json.dumps(source).encode(),
            {"feature_id": "pad", "depth_mm": 8},
        )
        saved = json.loads(result["content"])
        assert saved["features"][-1]["frame"]["originMillimeters"][2] == pytest.approx(
            8
        )
        assert result["result"]["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(
            1600
        )
    finally:
        for engine in service.engines.values():
            engine.close()


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_FREECAD") != "1", reason="Required native release gate"
)
def test_agent_offset_preview_commit_and_invalid_edit_recovery():
    import math

    source = json.loads(part_bytes())
    source["features"][0]["offsetMillimeters"] = 10
    source["features"][1].update(bodyId="limit", distanceMillimeters=3)
    source["features"].extend(
        [
            {
                "id": "circle",
                "name": "Circle",
                "type": "profile",
                "plane": "XY",
                "offsetMillimeters": 0,
                "suppressed": False,
                "profile": {
                    "type": "circle",
                    "radiusMillimeters": 2,
                    "centerMillimeters": [5, 10],
                },
            },
            {
                "id": "post",
                "name": "Post",
                "type": "extrude",
                "profileFeatureId": "circle",
                "distanceMillimeters": 1,
                "operation": "new",
                "bodyId": "post",
                "endType": "up-to-next",
                "suppressed": False,
            },
        ]
    )
    content = json.dumps(source).encode()
    service = CADService()
    try:
        preview = execute(
            service,
            "cad.extrude.previewoffset",
            content,
            {"feature_id": "post", "end_offset_mm": 2},
        )
        assert "content" not in preview
        assert preview["result"]["evaluated_bodies"][-1]["volume_mm3"] == pytest.approx(
            math.pi * 4 * 8
        )
        edited = execute(
            service,
            "cad.extrude.setoffset",
            content,
            {"feature_id": "post", "end_offset_mm": -2},
        )
        assert (
            json.loads(edited["content"])["features"][-1]["endOffsetMillimeters"] == -2
        )
        assert edited["result"]["evaluated_bodies"][-1]["volume_mm3"] == pytest.approx(
            math.pi * 4 * 12
        )
        with pytest.raises(Problem, match="Native rebuild refused"):
            execute(
                service,
                "cad.extrude.setoffset",
                edited["content"],
                {"feature_id": "post", "end_offset_mm": 12},
            )
        recovered = execute(service, "cad.part.evaluate", edited["content"], {})
        assert recovered["result"]["evaluated_bodies"][-1][
            "volume_mm3"
        ] == pytest.approx(math.pi * 4 * 12)
    finally:
        for engine in service.engines.values():
            engine.close()


@pytest.mark.skipif(
    os.environ.get("AETHER_TEST_FREECAD") != "1", reason="Required native release gate"
)
def test_revolve_agent_preview_edit_and_invalid_recovery(host):
    import math

    _, call, file, grant, command = host
    source = json.loads(part_bytes())
    source["features"][0]["profile"]["pointsMillimeters"] = [
        [5, 2],
        [25, 2],
        [25, 12],
        [5, 12],
    ]
    source["features"][1] = {
        "id": "rev",
        "type": "revolve",
        "name": "Revolve",
        "profileFeatureId": "profile",
        "axis": "X",
        "angleDegrees": 90,
        "operation": "new",
        "bodyId": "ring",
        "suppressed": False,
    }
    call(
        "/api/library/save",
        {
            "app": "cad",
            "id": file["id"],
            "expected_revision": 1,
            "data_base64": base64.b64encode(json.dumps(source).encode()).decode(),
        },
    )
    token = grant(can_write=True, can_edit_content=True)
    args = {
        "feature_id": "rev",
        "angle_deg": 90,
        "second_angle_deg": 30,
        "symmetric": False,
        "reversed": True,
    }
    preview = command("cad.revolve.preview", token, **args)
    assert not preview["changed"] and preview["document"]["revision"] == 2
    result = command("cad.revolve.setextent", token, expected_revision=2, **args)
    assert result["document"]["revision"] == 3
    assert result["evaluated_bodies"][0]["volume_mm3"] == pytest.approx(
        2800 * math.pi / 3
    )
    with pytest.raises(Problem):
        command(
            "cad.revolve.setextent",
            token,
            expected_revision=3,
            **{**args, "symmetric": True},
        )
    assert not command("cad.revolve.setextent", token, expected_revision=3, **args)[
        "changed"
    ]
    assert command("cad.part.inspect", token)["features"][-1]["reversed"]
