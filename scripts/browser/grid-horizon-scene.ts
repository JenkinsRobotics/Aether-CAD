import * as THREE from 'three/webgpu';
import { TransparentViewportOutput } from '../../src/viewport/transparent-output';
import { StageRig } from '../../src/viewport/stage-rig';
import { resolveAppearance } from '../../src/viewport/appearance-themes';
import { defaultCADAppearance } from '../../src/cad-appearance-store';

const renderer = new THREE.WebGPURenderer({ antialias: true, alpha: true, forceWebGL: new URLSearchParams(location.search).has('webgl') });
renderer.setSize(1000, 800); renderer.setPixelRatio(1);
document.body.style.margin = '0'; document.body.append(renderer.domElement);
await renderer.init();
const scene = new THREE.Scene();
const stage = new StageRig(scene);
const body = new THREE.Mesh(new THREE.BoxGeometry(35, 35, 15), new THREE.MeshBasicMaterial({ color: 0x68a5c6 }));
scene.add(body); body.position.z = 7.5;
const target = new THREE.Vector3();
let camera: THREE.PerspectiveCamera | THREE.OrthographicCamera;
const output = new TransparentViewportOutput(renderer, scene, new THREE.PerspectiveCamera());
window.gridCheck = {
  async render({ distance = 160, projection = 'perspective', theme = 'dark', elevation = 22, pan = 0, up = 'z', width = 1, model = false, axes = true, toneMapped = false, opaque = false } = {}) {
    stage.setUpAxis(up);
    stage.apply(resolveAppearance({ ...defaultCADAppearance,
      gridMinorColor: theme === 'dark' ? '#546068' : '#a0a4a7', gridMajorColor: theme === 'dark' ? '#63727c' : '#92999e',
      gridMinorOpacityPercent: 75, gridMajorOpacityPercent: 80, gridAxisOpacityPercent: axes ? 85 : 0,
      gridMinorWidthPx: width, floorMode: 'grid',
    }), { ...defaultCADAppearance, floorMode: 'grid' });
    stage.frame(60, 160);
    renderer.toneMapping = toneMapped ? THREE.ACESFilmicToneMapping : THREE.NoToneMapping;
    renderer.toneMappingExposure = toneMapped ? 1.5 : 1;
    scene.background = opaque ? new THREE.Color(theme === 'dark' ? '#101112' : '#f2f5f7') : null; renderer.setClearColor(0, 0);
    renderer.domElement.style.backgroundColor = theme === 'dark' ? '#101112' : '#f2f5f7';
    body.visible = model;
    target.set(pan, 0, 0);
    const angle = elevation * Math.PI / 180;
    camera = projection === 'perspective' ? new THREE.PerspectiveCamera(50, 1.25, .01, 1e8) : new THREE.OrthographicCamera(-distance * .6, distance * .6, distance * .48, -distance * .48, -1e8, 1e8);
    camera.up.set(0, up === 'y' ? 1 : 0, up === 'z' ? 1 : 0);
    camera.position.set(pan + distance * Math.cos(angle) * .4, up === 'y' ? distance * Math.sin(angle) : -distance * Math.cos(angle), up === 'z' ? distance * Math.sin(angle) : -distance * Math.cos(angle));
    camera.lookAt(target); camera.updateMatrixWorld(true);
    stage.beforeRender(camera, target, [body]);
    await output.renderAsync(camera);
    return { backend: renderer.backend.isWebGPUBackend ? 'webgpu' : 'webgl', vertices: stage.grid.children[4].geometry.attributes.position.count };
  },
};
