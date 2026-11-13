"""Run serially on one machine; raw evidence survives failed/unsupported cases.
Build the Aether runners (build-aether.mjs) before invoking this script.
"""
import json,os,platform,subprocess,sys,time
from pathlib import Path
OUT=Path(sys.argv[1] if len(sys.argv)>1 else 'build/native-comparison/measured');OUT.mkdir(parents=True,exist_ok=True)
ROOT=Path.cwd(); fixtures=ROOT/'build/native-comparison/fixtures'
env=dict(os.environ,BENCH_RUNS='1')
metadata=dict(platform=platform.platform(),machine=platform.machine(),cpu=subprocess.check_output(['sysctl','-n','machdep.cpu.brand_string'],text=True).strip(),memoryBytes=int(subprocess.check_output(['sysctl','-n','hw.memsize'],text=True)),cadCommit=subprocess.check_output(['git','rev-parse','HEAD'],text=True).strip(),sourceDirty=bool(subprocess.check_output(['git','status','--porcelain','--untracked-files=no'],text=True).strip()),samples=[],failures=[])
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
        label=f'aether-{name}-{round}'
        run(['node','build/native-comparison/aether-runner/run.mjs',fixtures/f'{name}.json',OUT/f'{label}.json'],label)
        if name=='robot-front':
            run(['node','build/native-comparison/aether-obb/run.mjs',fixtures/f'{name}.json',OUT/f'obb-{name}-{round}.json'],f'obb-{name}-{round}')
if 'robot-front' in os.environ.get('BENCH_CASES','plate,ten-bores,annular-shell,robot-front').split(','):
    for round in range(3):
        for variant in (['runner','no-history'] if round%2==0 else ['no-history','runner']):
            run(['node',f'build/native-comparison/aether-{variant}/run.mjs',fixtures/'robot-front.json',ROOT/'build/native-comparison'/f'{variant}-pair-{round}.json'],f'{variant}-pair-{round}')
