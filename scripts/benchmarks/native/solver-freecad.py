"""FreeCAD Sketcher on the solver fixtures written by solver.ts; run with FreeCAD's
Python. Each round edits the width datum (setDatum solves) and the time is the
same edit-and-solve our solver is timed on."""
import json, sys, time
from pathlib import Path
import FreeCAD as App, Part, Sketcher
root = Path('build/native-comparison')
results = {}
for fixture in sorted(root.glob('solver-fixtures/*.json'), key=lambda p: int(p.stem)):
    spec = json.loads(fixture.read_text()); drawing = spec['drawing']; size = spec['size']
    doc = App.newDocument('Solver'); sk = doc.addObject('Sketcher::SketchObject', 'Sketch')
    V = lambda p: App.Vector(p[0], p[1], 0)
    path = drawing['contours'][0]; p = path['start']; lines = []
    for s in path['segments']:
        lines.append(sk.addGeometry(Part.LineSegment(V(p), V(s['end'])), False)); p = s['end']
    for i in range(4): sk.addConstraint(Sketcher.Constraint('Coincident', lines[i], 2, lines[(i + 1) % 4], 1))
    sk.addConstraint(Sketcher.Constraint('DistanceX', -1, 1, lines[0], 1, 0)); sk.addConstraint(Sketcher.Constraint('DistanceY', -1, 1, lines[0], 1, 0))
    sk.addConstraint(Sketcher.Constraint('Horizontal', lines[0])); sk.addConstraint(Sketcher.Constraint('Horizontal', lines[2]))
    sk.addConstraint(Sketcher.Constraint('Vertical', lines[1])); sk.addConstraint(Sketcher.Constraint('Vertical', lines[3]))
    width = sk.addConstraint(Sketcher.Constraint('DistanceX', lines[0], 1, lines[0], 2, size))
    sk.addConstraint(Sketcher.Constraint('DistanceY', lines[0], 1, lines[3], 1, size))
    for c in drawing['contours'][1:]:
        g = sk.addGeometry(Part.Circle(V(c['center']), App.Vector(0, 0, 1), c['radius']), False)
        sk.addConstraint(Sketcher.Constraint('Radius', g, c['radius']))
        sk.addConstraint(Sketcher.Constraint('DistanceX', lines[0], 1, g, 3, c['center'][0]))
        sk.addConstraint(Sketcher.Constraint('DistanceY', lines[0], 1, g, 3, c['center'][1]))
    assert sk.solve() == 0
    times = []
    for r in range(spec['rounds']):
        value = size + (1 if r % 2 else 0.5)
        # setDatum solves; FreeCAD 1.1 returns None, so the geometry check below is the verdict.
        start = time.perf_counter(); sk.setDatum(width, App.Units.Quantity(f'{value} mm')); times.append((time.perf_counter() - start) * 1000)
        geo = sk.Geometry[lines[0]]
        assert abs(geo.EndPoint.x - geo.StartPoint.x - value) < 1e-6
    results[fixture.stem] = dict(constraints=sk.ConstraintCount, freecadMs=times, dof=sk.solve())
    App.closeDocument(doc.Name)
Path('build/native-comparison/solver-freecad.json').write_text(json.dumps(dict(version=App.Version(), results=results), indent=2) + '\n')
print(json.dumps(results))
