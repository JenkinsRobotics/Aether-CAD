import { DataTexture, EquirectangularReflectionMapping, FloatType, LinearSRGBColorSpace, RGBAFormat } from 'three/webgpu';

/** Small local studio light map, prefiltered by the renderer for rough PBR
 * surfaces. It needs no remote HDRI or document geometry. */
export function createStudioReflectionMap(): DataTexture {
  const width = 128, height = 64;
  const texture = new DataTexture(new Float32Array(width * height * 4), width, height, RGBAFormat, FloatType);
  texture.mapping = EquirectangularReflectionMapping;
  texture.colorSpace = LinearSRGBColorSpace;
  texture.name = 'Aether procedural studio reflections';
  rotateStudioReflectionMap(texture, 0);
  return texture;
}

/** Rotate the source longitude and invalidate its filtered lighting too. This
 * keeps cloned per-part materials and the scene on the same reflection map. */
export function rotateStudioReflectionMap(texture: DataTexture, degrees: number): void {
  const rotation = Number.isFinite(degrees) ? ((degrees % 360) + 360) % 360 : 0;
  if (texture.userData.studioRotationDegrees === rotation) return;
  const { width, height } = texture.image;
  const data = texture.image.data as Float32Array;
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const u = ((x + .5) / width + rotation / 360) % 1, v = (y + .5) / height;
    const wrapped = (a: number, b: number) => Math.min(Math.abs(a - b), 1 - Math.abs(a - b));
    const panel = (cx: number, cy: number, sx: number, sy: number) => Math.exp(-((wrapped(u, cx) / sx) ** 4 + ((v - cy) / sy) ** 4));
    const light = .12 + .2 * Math.sin(Math.PI * v) + 1.8 * panel(.2, .42, .08, .18) + .8 * panel(.68, .35, .12, .1);
    const i = (y * width + x) * 4;
    data[i] = light; data[i + 1] = light * .98; data[i + 2] = light * .95; data[i + 3] = 1;
  }
  texture.userData.studioRotationDegrees = rotation;
  texture.needsUpdate = true;
  texture.needsPMREMUpdate = true;
}
