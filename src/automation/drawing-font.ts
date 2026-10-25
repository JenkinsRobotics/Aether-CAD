import { readFile } from "node:fs/promises";

/** The build extracts this exact font from the hash-pinned shared asset archive. */
export async function drawingFont(): Promise<Uint8Array> {
  return readFile(new URL("./NotoSans-Regular.ttf", import.meta.url));
}
