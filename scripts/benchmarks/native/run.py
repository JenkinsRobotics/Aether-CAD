"""Run serially on one machine; raw evidence survives failed/unsupported cases.
Build the Aether runner and SolidCraft release CLI before invoking this script.
"""
import hashlib,json,os,platform,subprocess,sys,time
from pathlib import Path
OUT=Path(sys.argv[1] if len(sys.argv)>1 else 'build/native-comparison/measured');OUT.mkdir(parents=True,exist_ok=True)
ROOT=Path.cwd(); fixtures=ROOT/'build/native-comparison/fixtures'
cli=ROOT/'build/comparison-solidcraft-target/release/solidcraft-cli'
fc=Path(os.environ.get('FREECAD_PYTHON','/Applications/FreeCAD.app/Contents/Resources/bin/python'))
env=dict(os.environ,BENCH_RUNS='1',PYTHONPATH=str(fc.parent.parent/'lib'))
metadata=dict(platform=platform.platform(),machine=platform.machine(),cpu=subprocess.check_output(['sysctl','-n','machdep.cpu.brand_string'],text=True).strip(),memoryBytes=int(subprocess.check_output(['sysctl','-n','hw.memsize'],text=True)),cadCommit=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),sourceDirty=bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],text=True).strip()),solidcraftVersion='0.23.0',solidcraftCargoLockSha256=hashlib.sha256((ROOT/'reference/solidcraft-main/Cargo.lock').read_bytes()).hexdigest(),samples=[],failures=[])
def run(args,name,extra={}):
    start=time.perf_counter()
    with (OUT/f'{name}.log').open('w') as log:
        try:
            p=subprocess.run([str(a) for a in args],env=dict(env,**extra),stdout=log,stderr=log,timeout=120)
            code=p.returncode
        except subprocess.TimeoutExpired: code='timeout-120s'
    wall=(time.perf_counter()-start)*1000
    row=dict(name=name,exit=code,processWallMs=wall)
    metadata['samples' if code==0 else 'failures'].append(row)
    (OUT/'run.json').write_text(json.dumps(metadata,indent=2)+'\n')
    print(json.dumps(row),flush=True)
    return code==0
for round in range(int(os.environ.get('BENCH_SAMPLES','5'))):
    for name in os.environ.get('BENCH_CASES','plate,ten-bores,annular-shell,robot-front').split(','):
        engines=['aether','freecad'] if round%2==0 else ['freecad','aether']
        for engine in engines:
            label=f'{engine}-{name}-{round}'
            command=['node','build/native-comparison/aether-runner/run.mjs'] if engine=='aether' else [fc,'scripts/benchmarks/native/freecad.py']
            run(command+[fixtures/f'{name}.json',OUT/f'{label}.json'],label)
        design=ROOT/'build/native-comparison'/f'{name}.solidcraft'
        if design.exists():
            run([cli,'bench-open',design],f'solidcraft-{name}-{round}',dict(SOLIDCRAFT_NO_MODEL_CACHE='1'))
        if name=='robot-front':
            run(['node','build/native-comparison/aether-obb/run.mjs',fixtures/f'{name}.json',OUT/f'obb-{name}-{round}.json'],f'obb-{name}-{round}')
# Cached file opening is deliberately a different series from a full rebuild.
for round in range(int(os.environ.get('BENCH_SAMPLES','5'))):
    for name in ['plate','ten-bores','annular-shell']:
        if name not in os.environ.get('BENCH_CASES','plate,ten-bores,annular-shell,robot-front').split(','): continue
        run([cli,'bench-open',ROOT/'build/native-comparison'/f'{name}.solidcraft','--ops',ROOT/'build/native-comparison'/f'{name}-ops.json'],f'solidcraft-cached-edit-{name}-{round}')
if 'robot-front' in os.environ.get('BENCH_CASES','plate,ten-bores,annular-shell,robot-front').split(','):
    for round in range(3):
        for variant in (['runner','no-history'] if round%2==0 else ['no-history','runner']):
            run(['node',f'build/native-comparison/aether-{variant}/run.mjs',fixtures/'robot-front.json',ROOT/'build/native-comparison'/f'{variant}-pair-{round}.json'],f'{variant}-pair-{round}')
