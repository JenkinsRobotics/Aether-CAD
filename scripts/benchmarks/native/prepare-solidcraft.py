"""Author native reference documents, retain failures, and record the exact build."""
import hashlib,json,subprocess,time
from pathlib import Path
root=Path('build/native-comparison');cli=root/'../comparison-solidcraft-target/release/solidcraft-cli'
results=[]
for name in ['plate','ten-bores','annular-shell','robot-front']:
    fixture=root/'fixtures'/f'{name}.json';script=root/f'{name}-script.json';design=root/f'{name}.solidcraft'
    subprocess.run(['python3','scripts/benchmarks/native/to-solidcraft.py',str(fixture),str(script)],check=True)
    design.unlink(missing_ok=True)  # Generated benchmark output only; never retain a stale success.
    start=time.perf_counter()
    with (root/f'{name}-solidcraft-author.log').open('w') as log:
        try:
            code=subprocess.run([str(cli),'run',str(script),'--save',str(design),'--profile','--json-out',str(root/f'{name}-authoring.json')],stdout=log,stderr=log,timeout=180).returncode
        except subprocess.TimeoutExpired: code='timeout-180s'
    results.append(dict(fixture=name,exit=code,wallMs=(time.perf_counter()-start)*1000))
    print(results[-1],flush=True)
    if code==0:
        subprocess.run([str(cli),'eval',str(design),'--json-out',str(root/f'{name}-measure.json')],check=True,timeout=120)
    src=json.loads(fixture.read_text());edit=src['edit'];index=next(i for i,f in enumerate(src['document']['features']) if f['id']==edit['featureId'])
    if edit['field']=='distanceMillimeters':
        (root/f'{name}-ops.json').write_text(json.dumps([dict(command='timeline.edit',params=dict(feature=f'F{index}',set=dict(extent=dict(distance=str(edit['value'])))))]))
(root/'reference-authoring.json').write_text(json.dumps(results,indent=2)+'\n')
reference=Path('reference/solidcraft-main');files=sorted(p for p in reference.rglob('*') if p.is_file() and (p.suffix=='.rs' or p.name in ['Cargo.toml','Cargo.lock','config.toml']))
h=hashlib.sha256()
for p in files: h.update(str(p.relative_to(reference)).encode()+b'\0'+p.read_bytes()+b'\0')
(root/'reference-source.json').write_text(json.dumps(dict(version='0.23.0',sourceSha256=h.hexdigest(),sourceFiles=len(files),binarySha256=hashlib.sha256(cli.read_bytes()).hexdigest()),indent=2)+'\n')
