"""Interchange decoding through FreeCAD's public Part and Mesh APIs.

Reference meshes stay meshes. Conversion makes faceted B-Rep geometry; it does
not recover the original analytic surfaces or the source feature history.
"""
import base64
import math
from pathlib import Path
import tempfile

FORMATS = {'step', 'iges', 'brep', 'stl', 'obj', 'ply', 'off'}
MESH_FORMATS = {'stl', 'obj', 'ply', 'off'}
UNIT_SCALE = {'mm': 1, 'cm': 10, 'm': 1000, 'in': 25.4, 'ft': 304.8}


def create_import(document, parameters):
    import FreeCAD
    import Part
    import Mesh

    kind = parameters.get('format')
    if kind not in FORMATS:
        raise ValueError('Choose STEP, IGES, BREP, STL, OBJ, PLY or OFF.')
    encoded = parameters.get('data_base64')
    if not isinstance(encoded, str) or not encoded or len(encoded) > 4 * 1024 * 1024:
        raise ValueError('Invalid CAD source (maximum 3 MiB).')
    try:
        data = base64.b64decode(encoded, validate=True)
    except ValueError:
        raise ValueError('Invalid encoded CAD source.') from None
    if not data or len(data) > 3 * 1024 * 1024:
        raise ValueError('CAD source must be nonempty and at most 3 MiB.')
    with tempfile.TemporaryDirectory(prefix='aether-cad-import-') as directory:
        path = Path(directory) / f'source.{kind}'
        # FreeCAD's STL format probe needs a full header buffer even for a
        # valid, very short ASCII STL. Pad only text; keep binary bytes intact.
        if kind == 'stl' and len(data) < 256 and data.lstrip().startswith(b'solid'):
            binary_size = 84 + 50 * int.from_bytes(data[80:84], 'little') if len(data) >= 84 else -1
            if binary_size != len(data):
                data = data.ljust(256, b' ')
        path.write_bytes(data)
        if kind in MESH_FORMATS:
            mode, units = parameters.get('mesh_mode'), parameters.get('mesh_units')
            if mode not in ('reference', 'solid') or units not in UNIT_SCALE:
                raise ValueError('Choose mesh handling and explicit source units.')
            mesh = Mesh.Mesh(str(path))
            if not 0 < mesh.CountFacets <= 100_000:
                raise ValueError('Mesh must contain 1–100,000 triangles.')
            points, _ = mesh.Topology
            if any(not math.isfinite(v) or abs(v * UNIT_SCALE[units]) > 1e9 for p in points for v in p):
                raise ValueError('Mesh coordinates must be finite and within 1,000 km.')
            matrix = FreeCAD.Matrix()
            matrix.scale(UNIT_SCALE[units], UNIT_SCALE[units], UNIT_SCALE[units])
            mesh.transform(matrix)
            if mode == 'reference':
                result = document.addObject('Mesh::Feature', 'ImportedMesh')
                result.Mesh = mesh
                return result
            if mesh.CountFacets > 10_000:
                raise ValueError('Solid conversion supports at most 10,000 triangles. Import as a mesh reference or simplify the source mesh.')
            if not mesh.isSolid():
                raise ValueError('Solid conversion needs a closed mesh. Import as a mesh reference or repair the source mesh.')
            shape = Part.Shape()
            # FreeCAD public makeShapeFromMesh, followed by closed-shell solids.
            shape.makeShapeFromMesh(mesh.Topology, 0.000001)
            shape = _closed_solids(shape).removeSplitter()
        else:
            if parameters.get('mesh_mode') is not None or parameters.get('mesh_units') is not None:
                raise ValueError('Exact CAD imports use their embedded source units.')
            shape = Part.Shape()
            shape.read(str(path))
            if kind == 'iges' and not shape.Solids and shape.Faces:
                shape.sewShape()
                shape = _closed_solids(shape)
    if shape.isNull() or not shape.isValid() or not shape.Solids or shape.Volume <= 1e-9:
        raise ValueError('Import must contain valid solid geometry. Surface-only files need sewing/repair in the source application.')
    if sum(len(s.Faces) for s in shape.Solids) != len(shape.Faces):
        raise ValueError('Import contains unsewn surfaces. Repair them before solid import.')
    result = document.addObject('PartDesign::Feature', 'ImportedCAD')
    result.Shape = shape
    return result


def _closed_solids(shape):
    import Part
    shells = shape.Shells
    if not shells or sum(len(s.Faces) for s in shells) != len(shape.Faces):
        raise ValueError('Geometry could not be sewn into closed shells. Import a mesh as a reference or repair the source.')
    solids = []
    for shell in shells:
        if not shell.isClosed():
            raise ValueError('Geometry contains an open shell. Import a mesh as a reference or repair the source.')
        solid = Part.makeSolid(shell)
        if solid.Volume < 0:
            solid.reverse()
        if not solid.isValid() or solid.Volume <= 1e-9:
            raise ValueError('Solid conversion failed: invalid or zero-volume shell.')
        solids.append(solid)
    for i, solid in enumerate(solids):
        for other in solids[:i]:
            if solid.common(other).Volume > 1e-9:
                raise ValueError('Nested or overlapping shells cannot be converted without changing their volume. Use a mesh reference or export a solid STEP file from the source application.')
    return Part.makeCompound(solids)


def mesh_geometry(mesh):
    vertices, normals, triangles = [], [], []
    for facet in mesh.Facets:
        base = len(vertices) // 3
        for point in facet.Points:
            vertices.extend(point)
            normals.extend(facet.Normal)
        triangles.extend((base, base + 1, base + 2))
    return {'geometry_kind': 'mesh', 'volume_mm3': 0, 'face_count': 0, 'edge_count': 0,
            'vertices': vertices, 'normals': normals, 'triangles': triangles,
            'edge_lines': [], 'face_ranges': [], 'topology': [], 'face_names': []}


def reject_mesh_targets(parameters, bodies, built):
    targets = [parameters.get('body_id'), *parameters.get('target_body_ids', []),
               *parameters.get('tool_body_ids', [])]
    source = built.get(parameters.get('source'))
    if any(hasattr(bodies.get(key), 'Mesh') for key in targets) or hasattr(source, 'Mesh'):
        raise ValueError('This operation requires a solid body. Edit the mesh import and choose solid conversion first.')
