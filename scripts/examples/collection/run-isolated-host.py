import json, os, subprocess
from pathlib import Path
root = Path('/Users/jonathanjenkins/GITHUB/AetherStudio')
cad = root.parent/'Aether-CAD'
evidence = cad/'build/Example-Collection'/os.environ.get('AETHER_EXAMPLE','wrench')/'host'
evidence.mkdir(parents=True, exist_ok=True)
marker = Path.home()/'Library/Application Support/Aether Studio Native/current-installation.json'
env_config = json.loads(Path(json.loads(marker.read_text())['config']).read_text())['environment']
manifest = json.loads(Path(env_config['AETHER_NATIVE_FRONTENDS']).read_text())
manifest['apps']['cad'] = os.environ.get('AETHER_QUALIFY_FRONTEND', str(cad/'dist'))
manifest['apps']['ui'] = '/Users/jonathanjenkins/GITHUB/Aether-UI/dist'
manifest_path = evidence/'frontends.json';manifest_path.write_text(json.dumps(manifest,indent=2)+'\n')
env = dict(os.environ, LC_ALL='en_US.UTF-8', LANG='en_US.UTF-8', AETHER_TEST_RELEASE='1', AETHER_TEST_NODE='/usr/local/bin/node',
 AETHER_TEST_FRONTEND_MANIFEST=str(manifest_path), AETHER_TEST_ANIMATION=env_config['AETHER_NATIVE_ANIMATION'],
 AETHER_TEST_MAP_DOWNLOADS=env_config['AETHER_NATIVE_MAP_DOWNLOADS'], AETHER_FRONTEND_EVIDENCE=str(evidence/'browser'),
 AETHER_TEST_CAD_AGENT_BROWSER=str(cad/os.environ.get('AETHER_QUALIFY_SCRIPT','scripts/examples/collection/build-via-mcp.mjs')))
for path in json.loads(Path(env_config['AETHER_NATIVE_PRODUCTS']).read_text())['manifests']:
 app=json.loads(Path(path).read_text())['app'];env['AETHER_TEST_'+app.upper()+'_WORKER']=path
# Resolve the effective installed worker, including releases that inherited it.
updates = Path.home()/'Library/Application Support/Aether Studio Native/app-updates'
active = json.loads((updates/'active.json').read_text())
for app, release in active['active'].items():
 record = next(r for r in active['installed'] if r['app']==app and r['release']==release)
 if record.get('worker'):
  env['AETHER_TEST_'+app.upper()+'_WORKER'] = str(updates/'packages'/app/record['worker']/'worker/native-worker.json')

env['AETHER_TEST_CAD_WORKER'] = os.environ.get('AETHER_QUALIFY_WORKER', str(cad/'service/aether_cad_service/runtime/native-worker.json'))

with (evidence/'browser.log').open('w') as stream:
 subprocess.run([str(root/'.venv/bin/python'),'dev/rebuild/postgres_check.py','--cad-agents-browser'],cwd=root,env=env,stdout=stream,stderr=subprocess.STDOUT,check=True)
