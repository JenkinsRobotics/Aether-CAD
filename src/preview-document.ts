import * as THREE from 'three';
import { previewBodies } from './preview-model';
import { createPreviewScene } from './preview-scene';
import { createPreviewCache } from './preview-cache';

/** Product entry point for the hosted library. Builds saved geometry, on the
 *  same engine as the app, without opening or saving it. */
export const previewDocument = createPreviewCache(renderDocument);

// One offscreen context for the entire preview queue. Creating one per Part
// churns GPU contexts and can evict the editor's context in large designs.
let previewRenderer: THREE.WebGLRenderer | undefined;
function thumbnailRenderer() {
  if (previewRenderer?.getContext().isContextLost()) {
    previewRenderer.dispose(); previewRenderer = undefined;
  }
  if (!previewRenderer) {
    previewRenderer = new THREE.WebGLRenderer({ alpha: true, antialias: true, preserveDrawingBuffer: true });
    previewRenderer.setPixelRatio(1); previewRenderer.setSize(320, 240);
    previewRenderer.setClearColor(0, 0);
  }
  return previewRenderer;
}

async function renderDocument(content: string): Promise<string | null> {
  const bodies = await previewBodies(content);
  const result = createPreviewScene(bodies.map(body => body.data), new Map(bodies.map(body => [body.data.id, body])));
  if (!result) return null;
  try {
    const renderer = thumbnailRenderer();
    renderer.render(result.scene,result.camera);
    return renderer.domElement.toDataURL('image/png');
  } finally { result.dispose(); previewRenderer?.renderLists.dispose(); }
}
