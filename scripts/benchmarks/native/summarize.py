"""Validate benchmark completion/correctness and produce a portable small report."""
import hashlib,json,statistics,sys
from pathlib import Path
root=Path('build/native-comparison');r=root/'measured'
median=statistics.median
out=dict(method='Fresh headless processes, five samples, serial execution. Construction excludes kernel import/init, file IO and final display generation. No model-cache adoption in full rebuilds.',metadata=json.loads((r/'run.json').read_text()),reference=json.loads((root/'reference-source.json').read_text()),fixtures=[],experiments=[])
assert not out['metadata']['failures'],out['metadata']['failures']
for name in ['plate','ten-bores','annular-shell','robot-front']:
    source=json.loads((root/'fixtures'/f'{name}.json').read_text())
    fixture=dict(name=name,sourceSha256=hashlib.sha256((root/'fixtures'/f'{name}.json').read_bytes()).hexdigest(),features=len(source['document']['features']),engines={})
    if 'sourceArchiveSha256' in source: fixture['sourceArchiveSha256']=source['sourceArchiveSha256']
    for engine in ['aether','freecad']:
        samples=[json.loads((r/f'{engine}-{name}-{i}.json').read_text()) for i in range(5)]
        result=dict(phases={})
        for phase in ['cold','repeat','edit']:
            rows=[next(p for p in s['runs'][0]['phases'] if p['phase']==phase) for s in samples]
            normalized=[dict(solidMs=p['solidMs'],displayMs=p.get('displayMs',p.get('meshMs')),triangles=p['triangles'],measures=p['measures'][0] if isinstance(p['measures'],list) else p['measures']) for p in rows]
            result['phases'][phase]=dict(solidMedianMs=median(p['solidMs'] for p in normalized),displayMedianMs=median(p['displayMs'] for p in normalized),samples=normalized)
            if engine=='aether': assert all(p['replayed']==(fixture['features'] if phase=='cold' else 0 if phase=='repeat' else 2 if name=='robot-front' else 1) for p in rows)
        cold=result['phases']['cold']['samples'][0]['measures']['volume_mm3'];edit=result['phases']['edit']['samples'][0]['measures']['volume_mm3']
        assert abs(cold-edit)>1, (name,engine,'edit did not change the part')
        if 'expectedVolume' in source: assert abs(cold-source['expectedVolume'])<1e-5
        result['version']=samples[0].get('version',samples[0].get('node'));result['initMs']=[s['initMs'] for s in samples]
        fixture['engines'][engine]=result
    if name=='robot-front':
        assert not (root/f'{name}.solidcraft').exists()
        failure=(root/f'{name}-solidcraft-author.log').read_text().strip()
        assert 'step 35 (solid.extrude)' in failure and 'no result' in failure
        fixture['engines']['solidcraft']=dict(status='failed',feature='Left hub — passage',featureIndex=9,commandIndex=34,error=failure)
        x=fixture['engines']['aether']['phases']['cold']['samples'][0]['measures']['volume_mm3'];y=fixture['engines']['freecad']['phases']['cold']['samples'][0]['measures']['volume_mm3']
        fixture['reportedVolumeDifferenceMm3']=x-y
    else:
        measures=json.loads((root/f'{name}-measure.json').read_text());assert measures['body_count']==1 and measures['bodies'][0]['closed']
        assert len(measures['timeline'])==fixture['features'] and all(not f['error'] for f in measures['timeline'])
        assert all(s['dof']==0 for s in measures['sketches'])
        phases={}
        for phase,pattern in [('cold',f'solidcraft-{name}'),('cachedOpen',f'solidcraft-cached-edit-{name}')]:
            samples=[]
            for i in range(5):
                events=[json.loads(l) for l in (r/f'{pattern}-{i}.log').read_text().splitlines() if l.startswith('{')]
                e=next(x for x in events if x['step']=='evaluate');m=next(x for x in events if x['step']=='mesh')
                assert e['adopted']==(phase=='cachedOpen'),(name,phase,e)
                samples.append(dict(solidMs=e['ms'],displayMs=m['ms'],triangles=m['triangles'],recomputed=e['recomputed'],ops=[x for x in events if x['step']=='op']))
            phases[phase]=dict(solidMedianMs=median(s['solidMs'] for s in samples),displayMedianMs=median(s['displayMs'] for s in samples),samples=samples)
        phases['edit']=dict(commandMedianMs=median(next(o['ms'] for o in s['ops'] if o['command']=='timeline.edit') for s in phases['cachedOpen']['samples']))
        fixture['engines']['solidcraft']=dict(status='completed',phases=phases,measures=measures['bodies'][0],reportedVolumeErrorMm3=measures['bodies'][0]['volume_mm3']-source['expectedVolume'])
    out['fixtures'].append(fixture)
for variant,pattern,count in [('obb','measured/obb-robot-front',5),('no-history','no-history-pair',3),('history-control','runner-pair',3)]:
    samples=[]
    for i in range(count):
        x=json.loads((root/f'{pattern}-{i}.json').read_text())['runs'][0]['phases'][0];samples.append(x['solidMs'])
    out['experiments'].append(dict(variant=variant,samplesMs=samples,medianMs=median(samples)))
p=Path(sys.argv[1] if len(sys.argv)>1 else 'build/native-comparison/summary.json');p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(out,indent=2)+'\n')
for f in out['fixtures']:
    print(f['name'],{k:round(v['phases']['cold']['solidMedianMs'],2) if 'phases' in v else v['status'] for k,v in f['engines'].items()})
print(out['experiments'])
# Per-feature construction medians for the robot front shell, from the same
# five cold Aether samples (the evaluator's optional observer events).
runs=[[e for e in next(x for x in json.loads((r/f'aether-robot-front-{i}.json').read_text())['runs'][0]['phases'] if x['phase']=='cold')['events'] if e['phase']=='feature'] for i in range(5)]
assert all([e['id'] for e in run]==[e['id'] for e in runs[0]] and not any(e['failed'] for e in run) for run in runs)
features=[dict(id=e['id'],name=e['name'],type=e['type'],medianMs=median(run[k]['milliseconds'] for run in runs),samplesMs=[run[k]['milliseconds'] for run in runs]) for k,e in enumerate(runs[0])]
p.with_name('front-shell-profile.json').write_text(json.dumps(dict(features=sorted(features,key=lambda f:-f['medianMs'])),indent=2)+'\n')
