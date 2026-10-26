import { pass, vec4 } from 'three/tsl';
import { Camera, PostProcessing, Scene, WebGPURenderer } from 'three/webgpu';

/** The canvas is transparent over the theme's CSS background. Convert straight
 * RGB to the output color space, then premultiply again for browser compositing.
 * Converting already-premultiplied RGB brightens fading lines (white on light
 * themes). Opaque pixels have alpha 1 and retain the usual color transform. */
export class TransparentViewportOutput {
  private readonly scenePass;
  private readonly output: PostProcessing;
  private transform = '';

  constructor(private readonly renderer: WebGPURenderer, scene: Scene, camera: Camera) {
    this.scenePass = pass(scene, camera);
    const texture = this.scenePass.getTextureNode();
    const straight = vec4(texture.rgb.div(texture.a.max(1e-6)), texture.a).renderOutput();
    this.output = new PostProcessing(renderer, vec4(straight.rgb.mul(texture.a), texture.a));
    this.output.outputColorTransform = false;
  }

  private prepare(camera: Camera) {
    this.scenePass.camera = camera;
    const transform = `${this.renderer.toneMapping}:${this.renderer.outputColorSpace}`;
    if (transform !== this.transform) {
      this.transform = transform;
      this.output.needsUpdate = true;
    }
  }

  render(camera: Camera) { this.prepare(camera); this.output.render(); }
  async renderAsync(camera: Camera) { this.prepare(camera); await this.output.renderAsync(); }
  dispose() { this.scenePass.dispose(); this.output.dispose(); }
}
