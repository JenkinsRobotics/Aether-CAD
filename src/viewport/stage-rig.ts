/** Render layer: the stage around the model — lights, floor, grid and the
 *  camera's depth range. It applies a resolved theme (`ResolvedAppearance`,
 *  from appearance-themes) and never reads or changes the CAD document.
 *  Extracted unchanged from MateViewport so theme work happens here, not in
 *  the 2,000-line viewer. */
import * as THREE from "three/webgpu";
import type { CADAppearanceSnapshot } from "../cad-appearance-store";
import { cadFloorVisibility } from "../viewport-appearance";
import type { ResolvedAppearance } from "./appearance-themes";
import { applyContactShadows } from "./contact-shadows";
import { EnvironmentGrid } from "./environment-grid";
import { environmentLightDirection } from "./environment-light-direction";

/** Perspective depth range like the reference demo: near ≈ distance/200 and far
 *  ≥ 10× distance (~2000:1), widened only to reach visible content and the grid. */
export function perspectiveDepthRange(viewDistance: number, contentFar: number, gridFar: number): { near: number; far: number } {
  const far = Math.max(viewDistance * 10, contentFar, gridFar);
  return { near: Math.max(viewDistance / 200, far / 50_000), far };
}

export class StageRig {
  readonly hemisphereLight = new THREE.HemisphereLight(0xffffff, 0x6f8291, 2.2);
  readonly keyLight = new THREE.DirectionalLight(0xffffff, 3.2);
  readonly fillLight = new THREE.DirectionalLight(0xb9dcff, 1.25);
  readonly rimLight = new THREE.DirectionalLight(0x91bfff, 0.65);
  readonly grid = new EnvironmentGrid();
  private readonly solidFloorMaterial = new THREE.MeshStandardMaterial({ color: 0x1a1d1f, roughness: 0.9, metalness: 0 });
  private readonly shadowFloorMaterial = new THREE.ShadowMaterial({ color: 0x000000, transparent: true, depthWrite: false });
  readonly floor: THREE.Mesh<THREE.PlaneGeometry, THREE.MeshStandardMaterial | THREE.ShadowMaterial>;
  private upAxis: "y" | "z" = "y";
  private readonly depthBounds = new THREE.Box3();
  private readonly depthSphere = new THREE.Sphere();

  constructor(scene: THREE.Scene) {
    this.keyLight.position.set(4, 7, 5);
    this.fillLight.position.set(-5, 2, -4);
    this.rimLight.position.set(2, 4, -6);
    this.keyLight.castShadow = true;
    this.keyLight.shadow.mapSize.set(2048, 2048);
    this.keyLight.shadow.camera.near = 0.1;
    this.keyLight.shadow.camera.far = 4_000;
    this.grid.position.y = -0.01;
    this.floor = new THREE.Mesh(new THREE.PlaneGeometry(1_600, 1_600), this.solidFloorMaterial);
    this.floor.rotation.x = -Math.PI / 2;
    this.floor.position.y = -0.02;
    this.floor.receiveShadow = true;
    this.floor.visible = false;
    scene.add(this.hemisphereLight, this.keyLight, this.fillLight, this.rimLight, this.floor, this.grid);
  }

  /** Match the modeling up-axis and light the front-facing sides as well as the top. */
  setUpAxis(axis: "y" | "z"): void {
    this.upAxis = axis;
    const zUp = axis === "z";
    const place = (light: THREE.Light, x: number, y: number, z: number) => light.position.set(x, zUp ? y : z, zUp ? z : -y);
    place(this.hemisphereLight, 0, 0, 1);
    place(this.keyLight, -4, -6, 8);
    place(this.fillLight, 6, 2, 3);
    place(this.rimLight, 2, 5, 4);
    this.grid.rotation.x = zUp ? Math.PI / 2 : 0;
    this.grid.position.set(0, zUp ? 0 : -0.01, zUp ? -0.01 : 0);
    this.floor.rotation.x = zUp ? 0 : -Math.PI / 2;
    this.floor.position.set(0, zUp ? 0 : -0.02, zUp ? -0.02 : 0);
  }

  setFloorMode(mode: CADAppearanceSnapshot["floorMode"] | undefined): void {
    const { grid, floor } = cadFloorVisibility(mode ?? "none");
    this.grid.visible = grid;
    this.floor.visible = floor;
  }

  /** Apply the resolved theme's stage: grid, floor and lights. */
  apply(resolved: ResolvedAppearance, appearance: CADAppearanceSnapshot): void {
    this.grid.setUpAxis(this.upAxis);
    this.grid.apply(resolved);
    this.setFloorMode(appearance.floorMode);
    applyContactShadows(this.keyLight, this.floor, appearance.contactShadowsVisible);
    // The theme's stage decides: a transparent shadow catcher over the grid, or a lit floor.
    this.floor.material = resolved.stage.floor === "shadow" ? this.shadowFloorMaterial : this.solidFloorMaterial;
    this.solidFloorMaterial.color.setHex(resolved.floorColor);
    this.floor.material.opacity = resolved.floorOpacity;
    this.floor.material.transparent = resolved.floorOpacity < 1;
    this.floor.material.depthWrite = resolved.floorOpacity === 1;
    this.solidFloorMaterial.roughness = resolved.floorRoughness;
    this.floor.scale.setScalar(resolved.grid.extent / 1600);
    const lights = resolved.lights;
    this.hemisphereLight.color.setHex(lights.sky);
    this.hemisphereLight.groundColor.setHex(lights.ground);
    this.keyLight.color.setHex(lights.keyColor);
    this.fillLight.color.setHex(lights.fillColor);
    this.rimLight.color.setHex(lights.rimColor);
    this.hemisphereLight.intensity = lights.hemisphere;
    this.keyLight.intensity = lights.key;
    this.fillLight.intensity = lights.fill;
    this.rimLight.intensity = lights.rim;
    this.keyLight.position.set(...environmentLightDirection(lights.keyAzimuth, lights.keyElevation, this.upAxis));
    this.fillLight.position.set(...environmentLightDirection(lights.fillAzimuth, lights.fillElevation, this.upAxis));
    this.rimLight.position.set(...environmentLightDirection(lights.rimAzimuth, lights.rimElevation, this.upAxis));
  }

  /** Size the stage to a framed model, as the demo's Frame does. */
  frame(diagonal: number, distance: number): void { this.grid.frameStage(diagonal, distance); }

  /** Per frame, before drawing: grid fade follows the camera, and the depth range
   *  stays tight to what is visible. A fixed wide range (0.01–10,000 mm) leaves
   *  ~0.1 mm depth precision at normal distance, so faces, edges and floor flicker. */
  beforeRender(camera: THREE.Camera, target: THREE.Vector3, content: readonly (THREE.Object3D | null | undefined)[]): void {
    const viewDistance = camera.position.distanceTo(target);
    this.grid.followCamera(viewDistance);
    if (!(camera instanceof THREE.PerspectiveCamera)) return;
    this.depthBounds.makeEmpty();
    for (const root of content) if (root?.visible) this.depthBounds.expandByObject(root);
    let contentFar = 0;
    if (!this.depthBounds.isEmpty()) {
      this.depthBounds.getBoundingSphere(this.depthSphere);
      contentFar = camera.position.distanceTo(this.depthSphere.center) + this.depthSphere.radius * 1.2;
    }
    const reach = this.grid.reach();
    const { near, far } = perspectiveDepthRange(viewDistance, contentFar, reach ? camera.position.length() + reach : 0);
    if (Math.abs(camera.near - near) > near * 1e-3 || Math.abs(camera.far - far) > far * 1e-3) {
      camera.near = near; camera.far = far; camera.updateProjectionMatrix();
    }
  }
}
