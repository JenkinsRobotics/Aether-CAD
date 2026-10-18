"""Aether CAD's FreeCAD engine boundary.

FreeCAD (LGPL-2.1-or-later, (C) 2001-2026 FreeCAD contributors) does the
geometry and parametric-feature work behind this module. See ATTRIBUTION.md.

Nothing outside this package imports FreeCAD; everything crosses the JSON
protocol in `protocol.py`, so the engine can be replaced centrally.
"""

from .engine import FreeCADEngine, FreeCADUnavailable, locate_freecad
from .protocol import (
    JOINT_KINDS,
    PROTOCOL_VERSION,
    AssemblyJob,
    AssemblyResult,
    Body,
    BuildJob,
    BuildResult,
    Feature,
    GeometryEngine,
    Instance,
    Joint,
    JointEnd,
    PartDefinition,
    SolvedInstance,
    assembly_job_from_json,
    assembly_job_to_json,
    assembly_result_from_json,
)

__all__ = [
    "JOINT_KINDS",
    "PROTOCOL_VERSION",
    "AssemblyJob",
    "AssemblyResult",
    "Instance",
    "Joint",
    "JointEnd",
    "PartDefinition",
    "SolvedInstance",
    "assembly_job_from_json",
    "assembly_job_to_json",
    "assembly_result_from_json",
    "Body",
    "BuildJob",
    "BuildResult",
    "Feature",
    "FreeCADEngine",
    "FreeCADUnavailable",
    "GeometryEngine",
    "locate_freecad",
]
