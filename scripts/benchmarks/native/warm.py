"""Warm uncached phase: the same Aether and FreeCAD runners, several rounds per
process with the replay cache cleared before each, so first-construction warm-up
(WASM/JIT code paths, FreeCAD's first recompute) is reported apart from the
steady rebuild cost. Three rows per engine: startup, first build, steady rebuild.
Run after build-aether.mjs and fixtures.py; writes measured/warm-*.json and
build/native-comparison/warm-summary.json.
"""
import json, os, statistics, subprocess
from pathlib import Path
ROOT = Path.cwd(); OUT = ROOT / 'build/native-comparison/measured'; OUT.mkdir(parents=True, exist_ok=True)
fc = Path(os.environ.get('FREECAD_PYTHON', '/Applications/FreeCAD.app/Contents/Resources/bin/python'))
env = dict(os.environ, BENCH_RUNS=os.environ.get('BENCH_RUNS', '4'), PYTHONPATH=str(fc.parent.parent / 'lib'))
cases = os.environ.get('BENCH_CASES', 'plate,ten-bores,annular-shell,robot-front').split(',')
samples = int(os.environ.get('BENCH_SAMPLES', '3'))
for i in range(samples):
    for name in cases:
        for engine in (['aether', 'freecad'] if i % 2 == 0 else ['freecad', 'aether']):
            command = ['node', 'build/native-comparison/aether-runner/run.mjs'] if engine == 'aether' else [str(fc), 'scripts/benchmarks/native/freecad.py']
            with (OUT / f'warm-{engine}-{name}-{i}.log').open('w') as log:
                subprocess.run(command + [str(ROOT / 'build/native-comparison/fixtures' / f'{name}.json'), str(OUT / f'warm-{engine}-{name}-{i}.json')], env=env, stdout=log, stderr=log, check=True, timeout=900)
            print(name, engine, i, flush=True)
cold = lambda run: next(p for p in run['phases'] if p['phase'] == 'cold')['solidMs']
summary = {}
for name in cases:
    summary[name] = {}
    for engine in ['aether', 'freecad']:
        files = [json.loads((OUT / f'warm-{engine}-{name}-{i}.json').read_text()) for i in range(samples)]
        steady = [cold(run) for f in files for run in f['runs'][1:]]
        summary[name][engine] = dict(startupMs=statistics.median(f['initMs'] for f in files), firstBuildMs=statistics.median(cold(f['runs'][0]) for f in files),
                                     steadyMs=statistics.median(steady), steadySamplesMs=steady, roundsPerProcess=int(env['BENCH_RUNS']), processes=samples)
(ROOT / 'build/native-comparison/warm-summary.json').write_text(json.dumps(summary, indent=2) + '\n')
print('| Fixture | Phase | Aether ms | FreeCAD ms |\n|---|---|---:|---:|')
for name, engines in summary.items():
    for key, label in [('startupMs', 'startup (kernel import/init)'), ('firstBuildMs', 'first build, fresh process'), ('steadyMs', 'steady rebuild, cache cleared')]:
        print(f"| {name} | {label} | {engines['aether'][key]:.1f} | {engines['freecad'][key]:.1f} |")
