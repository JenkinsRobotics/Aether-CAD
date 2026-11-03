import * as THREE from 'three';
import { parsePartDocument } from '@aether/core/document';
import { readAetherCADText } from './document/aethercad-archive';
import { evaluatePart } from './engine/evaluate-part';
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
  // The library preview hands the document over as text; a Drawing-only document has no solid to show.
  const part = readAetherCADText(content).graph.part_definitions.find((item) => item.feature_document);
  if (!part) return null;
  const document = parsePartDocument(JSON.stringify(part.feature_document));
  if (!document.features.length) return null;
  const model = await evaluatePart(document);
  const result = createPreviewScene(model.parts.filter(part => document.bodyProperties?.[part.id]?.visible !== false));
  if (!result) return null;
  try {
    const renderer = thumbnailRenderer();
    renderer.render(result.scene,result.camera);
    return renderer.domElement.toDataURL('image/png');
  } finally { result.dispose(); previewRenderer?.renderLists.dispose(); }
}
