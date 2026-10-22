import * as THREE from 'three';
import { parsePartDocument } from '@aether/core/document';
import { evaluatePart } from './engine/evaluate-part';
import { createPreviewScene } from './preview-scene';

/** Product entry point for the hosted library. Builds saved geometry, on the
 *  same engine as the app, without opening or saving it. */
export async function previewDocument(content: string): Promise<string | null> {
  const document = parsePartDocument(content);
  if (!document.features.length) return null;
  const model = await evaluatePart(document);
  const result = createPreviewScene(model.parts.filter(part => document.bodyProperties?.[part.id]?.visible !== false));
  if (!result) return null;
  let renderer: THREE.WebGLRenderer | undefined;
  try {
    renderer = new THREE.WebGLRenderer({alpha:true, antialias:true, preserveDrawingBuffer:true});
    renderer.setSize(320,240); renderer.setPixelRatio(1);
    renderer.setClearColor(0,0); renderer.render(result.scene,result.camera);
    return renderer.domElement.toDataURL('image/png');
  } finally { result.dispose(); renderer?.dispose(); renderer?.forceContextLoss(); }
}
