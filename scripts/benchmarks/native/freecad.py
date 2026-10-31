"""FreeCAD native Sketcher/PartDesign benchmark; run with FreeCAD's Python.
No server requests, imported solids, or display caches in the full-rebuild timer.
"""
import time
startup=time.perf_counter()
import FreeCAD as App, Part, Sketcher, MeshPart
import json,os,sys
from pathlib import Path
init_ms=(time.perf_counter()-startup)*1000
source=json.loads(Path(sys.argv[1]).read_text()); spec=source['document']
clock=lambda: time.perf_counter()*1000
vec=lambda p: App.Vector(*(p+[0] if len(p)==2 else p))
def placement(f):
    if 'frame' in f:
        fr=f['frame']; origin,x,n=map(vec,[fr['originMillimeters'],fr['xDirection'],fr['normal']])
    elif f['plane']=='XY': origin,x,n=vec([0,0,f['offsetMillimeters']]),vec([1,0,0]),vec([0,0,1])
    elif f['plane']=='XZ': origin,x,n=vec([0,-f['offsetMillimeters'],0]),vec([1,0,0]),vec([0,-1,0])
    else: raise ValueError(f['plane'])
    return App.Placement(origin,App.Rotation(x,n.cross(x),n,'ZXY'))
def create():
    d=App.newDocument('Benchmark'); body=d.addObject('PartDesign::Body','Body'); objects={}; last=None
    for i,f in enumerate(spec['features']):
        if f['type']=='profile':
            obj=d.addObject('Sketcher::SketchObject',f'F{i}');body.addObject(obj);obj.Placement=placement(f)
            for c in f['profile']['contours']:
                geom=[]
                if c['type']=='circle': geom=[Part.Circle(vec(c['center']),vec([0,0,1]),c['radius'])]
                elif c['type']=='path':
                    p=c['start']
                    for s in c['segments']:
                        if s['type']=='line': geom.append(Part.LineSegment(vec(p),vec(s['end'])))
                        elif s['type']=='arc': geom.append(Part.Arc(vec(p),vec(s['middle']),vec(s['end'])))
                        else: raise ValueError(s)
                        p=s['end']
                else: raise ValueError(c)
                for g in geom:
                    idx=obj.addGeometry(g,False);obj.addConstraint(Sketcher.Constraint('Block',idx))
        elif f['type']=='extrude':
            obj=body.newObject('PartDesign::Pocket' if f['operation']=='cut' else 'PartDesign::Pad',f'F{i}')
            obj.Profile=objects[f['profileFeatureId']];obj.Length=f['distanceMillimeters'];obj.Refine=True
            if last is not None: obj.BaseFeature=last
            last=obj
        elif f['type']=='revolve':
            assert f['axis']=='Z' and f['operation']=='new'
            obj=body.newObject('PartDesign::Revolution',f'F{i}');obj.Profile=objects[f['profileFeatureId']];obj.ReferenceAxis=(objects[f['profileFeatureId']],['V_Axis']);obj.Angle=f['angleDegrees'];obj.Refine=True;last=obj
        else: raise ValueError(f['type'])
        obj.Label=f['name'];objects[f['id']]=obj
    return d,body,objects
runs=[]
for round in range(int(os.environ.get('BENCH_RUNS','5'))):
    d,body,objects=create();phases=[]
    for phase in ['cold','repeat','edit']:
        if phase=='edit':
            edit=source['edit'];obj=objects[edit['featureId']]
            if edit['field']=='distanceMillimeters': obj.Length=edit['value']
            elif edit['field']=='offsetMillimeters':
                f=next(f for f in spec['features'] if f['id']==edit['featureId']).copy();f[edit['field']]=edit['value'];obj.Placement=placement(f)
            else: raise ValueError(edit)
        start=clock();d.recompute();solid_ms=clock()-start
        errors=[(o.Name,o.State) for o in objects.values() if 'Invalid' in o.State]
        shape=body.Tip.Shape
        if errors or shape.isNull() or not shape.isValid(): raise ValueError(f'Invalid native model: {errors}')
        start=clock();mesh=MeshPart.meshFromShape(Shape=shape,LinearDeflection=0.1,AngularDeflection=0.2,Relative=False);mesh_ms=clock()-start
        phases.append(dict(phase=phase,solidMs=solid_ms,meshMs=mesh_ms,triangles=mesh.CountFacets,measures=dict(volume_mm3=shape.Volume,face_count=len(shape.Faces),edge_count=len(shape.Edges),solids=len(shape.Solids))))
    if round==0:
        d.saveAs(str(Path(sys.argv[2]).with_suffix('.FCStd').resolve()))
    runs.append(dict(round=round,phases=phases));App.closeDocument(d.Name)
output=dict(engine='FreeCAD native OCCT',version=App.Version(),occt=Part.OCC_VERSION,initMs=init_ms,document=spec['name'],features=len(spec['features']),runs=runs)
Path(sys.argv[2]).write_text(json.dumps(output,indent=2)+'\n')
print(json.dumps(output))
