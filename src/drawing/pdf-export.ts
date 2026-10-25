import { exportDrawingPDF, type BuiltDrawing } from "@aether/core/drawing";
import regularFont from "@aether/assets/fonts/noto-sans/NotoSans-Regular.ttf?url";

let font: Promise<Uint8Array> | undefined;
export function loadDrawingFont(): Promise<Uint8Array> {
  return font ??= fetch(regularFont).then(async response => {
    if (!response.ok) throw Error("The bundled drawing font could not be loaded.");
    return new Uint8Array(await response.arrayBuffer());
  }).catch(error => { font = undefined; throw error; });
}

/** Browser resource adapter. The engine owns all PDF geometry and serialization. */
export async function drawingPDF(built: BuiltDrawing, sheetId?: string, allSheets = false): Promise<Uint8Array> {
  return exportDrawingPDF(built, { fontBytes: await loadDrawingFont(), sheetId, allSheets });
}
