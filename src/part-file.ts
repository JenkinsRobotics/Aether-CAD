import { AETHER_CAD_EXTENSION } from "@aether/core/document/file-types";
import type { PartDocument } from "@aether/core/document";
import { partGraph, writeAetherCAD } from "./document/aethercad-archive";

export { parsePartDocument, serializePartDocument } from "@aether/core/document";

function safeFileStem(name: string): string {
  return (
    name.trim().replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "") ||
    "Part"
  );
}

/** Save the Part Studio as a `.aethercad` document on the local machine. */
export async function savePartDocument(
  partDocument: PartDocument,
): Promise<string> {
  const contents = writeAetherCAD(partGraph(partDocument));
  const suggestedName = `${safeFileStem(partDocument.name)}${AETHER_CAD_EXTENSION}`;
  const pickerWindow = window as Window & {
    showSaveFilePicker?: (options: unknown) => Promise<{
      createWritable(): Promise<{
        write(data: Uint8Array): Promise<void>;
        close(): Promise<void>;
      }>;
    }>;
  };
  if (pickerWindow.showSaveFilePicker) {
    const handle = await pickerWindow.showSaveFilePicker({
      suggestedName,
      types: [
        {
          description: "Aether CAD document",
          accept: { "application/vnd.aether.workspace+zip": [AETHER_CAD_EXTENSION] },
        },
      ],
    });
    const writable = await handle.createWritable();
    await writable.write(contents);
    await writable.close();
    return suggestedName;
  }

  const url = URL.createObjectURL(
    new Blob([contents], { type: "application/vnd.aether.workspace+zip" }),
  );
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = suggestedName;
  anchor.click();
  URL.revokeObjectURL(url);
  return suggestedName;
}
