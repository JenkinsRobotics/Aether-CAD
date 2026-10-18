import * as THREE from 'three';
import { parsePartDocument } from '@aether/core/document';
import { translateDocument } from './freecad-translate';
import { buildWithFreeCAD } from './freecad-geometry';
import { createPreviewScene } from './preview-scene';

/** Product entry point for the hosted library. Builds saved geometry without opening or saving it. */
export async function previewDocument(content: string): Promise<string | null> {
  const document = parsePartDocument(content);
  if (!document.features.length) return null;
  const translated = translateDocument(document);
  if (!translated.complete) throw new Error("Preview unavailable: " + translated.untranslated.map(item => item.reason).join("; "));
  const built = await buildWithFreeCAD(translated.features);
  if (built.status !== 'ok' || built.diagnostics.some(d => d.severity === 'error')) throw new Error(built.message || 'Geometry preview unavailable');
  const result = createPreviewScene(built.parts.filter(part => document.bodyProperties?.[part.id]?.visible !== false));
  if (!result) return null;
  let renderer: THREE.WebGLRenderer | undefined;
  try {
    renderer = new THREE.WebGLRenderer({alpha:true, antialias:true, preserveDrawingBuffer:true});
    renderer.setSize(320,240); renderer.setPixelRatio(1);
    renderer.setClearColor(0,0); renderer.render(result.scene,result.camera);
    return renderer.domElement.toDataURL('image/png');
  } finally { result.dispose(); renderer?.dispose(); renderer?.forceContextLoss(); }
}
