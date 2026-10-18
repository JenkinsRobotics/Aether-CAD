import { Color, DataTexture, LinearFilter, RGBAFormat, SRGBColorSpace } from 'three/webgpu';
/** One small texture per changed gradient; no viewport-sized canvas allocation. */
export function gradientBackground(top: number, bottom: number): DataTexture {
  const data = new Uint8Array(256 * 4), a = new Color(bottom), b = new Color(top), color = new Color();
  for (let i = 0; i < 256; i++) {
    color.copy(a).lerp(b, i / 255).convertLinearToSRGB();
    data.set([Math.round(color.r * 255), Math.round(color.g * 255), Math.round(color.b * 255), 255], i * 4);
  }
  const texture = new DataTexture(data, 1, 256, RGBAFormat);
  texture.colorSpace = SRGBColorSpace; texture.magFilter = LinearFilter; texture.minFilter = LinearFilter; texture.needsUpdate = true;
  return texture;
}
