"""Translate the benchmark's limited profile/extrude/revolve subset to commands.
Unsupported constructs fail; reference conversion never silently drops a feature.
Sketch coordinates are fixed in all adapters for the construction benchmark.
"""
import json,sys
from pathlib import Path
src=json.loads(Path(sys.argv[1]).read_text()); doc=src['document']; commands=[]
def cmd(command,**params): commands.append(dict(command=command,params=params))
def cross(a,b): return [a[1]*b[2]-a[2]*b[1],a[2]*b[0]-a[0]*b[2],a[0]*b[1]-a[1]*b[0]]
names={f['id']:f'F{i}' for i,f in enumerate(doc['features'])}
for f in doc['features']:
    name=names[f['id']]
    if f['type']=='profile':
        frame=f.get('frame')
        if frame: o,x,n=frame['originMillimeters'],frame['xDirection'],frame['normal']
        elif f['plane']=='XY': o,x,n=[0,0,f['offsetMillimeters']],[1,0,0],[0,0,1]
        elif f['plane']=='XZ': o,x,n=[0,-f['offsetMillimeters'],0],[1,0,0],[0,-1,0]
        else: raise ValueError(f['plane'])
        cmd('sketch.create',name=name,plane=dict(origin=o,x_dir=x,y_dir=cross(n,x)))
        for i,c in enumerate(f['profile']['contours']):
            if c['type']=='circle':
                ident=f'c{i}';cmd('sketch.circle.center',center=c['center'],radius=c['radius'],id=ident)
                cmd('sketch.constraint.fix',entity=ident,fixed=True)
            elif c['type']=='path':
                previous=c['start']
                for j,seg in enumerate(c['segments']):
                    ident=f'e{i}_{j}'
                    if seg['type']=='line': cmd('sketch.line',points=[previous,seg['end']],ids=[ident])
                    elif seg['type']=='arc': cmd('sketch.arc.three_point',start=previous,end=seg['end'],through=seg['middle'],id=ident)
                    else: raise ValueError(seg)
                    cmd('sketch.constraint.fix',entity=ident,fixed=True)
                    previous=seg['end']
            else: raise ValueError(c)
        cmd('sketch.finish')
    elif f['type']=='extrude':
        p=dict(name=name,sketch=names[f['profileFeatureId']],distance=f['distanceMillimeters'],direction='negative' if f['operation']=='cut' else 'positive',operation={'add':'join'}.get(f['operation'],f['operation']))
        if f['operation']=='new': p['body_name']='Body'
        else: p['targets']=['Body']
        cmd('solid.extrude',**p)
    elif f['type']=='revolve':
        assert f['axis']=='Z' and f['operation']=='new'
        cmd('solid.revolve',name=name,sketch=names[f['profileFeatureId']],axis=dict(origin=[0,0,0],dir=[0,0,1]),angle=f['angleDegrees'],operation='new',body_name='Body')
    else: raise ValueError(f['type'])
Path(sys.argv[2]).write_text(json.dumps(dict(commands=commands),indent=2)+'\n')
