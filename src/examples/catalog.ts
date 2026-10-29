import records from "../../public/examples/catalog.json";
export interface CADExample {
  id: string;
  name: string;
  description: string;
  file: string;
  thumbnail: string;
  parts: number;
  instances: number;
  features: number;
  assemblyId: string;
  motion?: string;
  tags: string[];
  sha256: string;
  reference?: { source: string; comparison: string };
}
export const cadExamples: readonly CADExample[] = records;
export function cadExample(id: string | null): CADExample {
  const example = cadExamples.find((item) => item.id === id);
  if (!example) throw Error("This CAD example is not available.");
  return example;
}
export function exampleAsset(path: string): string {
  return new URL(
    `./examples/${path}`,
    new URL(import.meta.env.BASE_URL, location.href),
  ).href;
}
export async function readExample(example: CADExample): Promise<File> {
  const response = await fetch(exampleAsset(example.file));
  if (!response.ok) throw Error("The example could not be loaded. Try again.");
  const bytes = await response.arrayBuffer();
  if (bytes.byteLength > 6 * 1024 * 1024)
    throw Error("The example exceeds the CAD file size limit.");
  const hash = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
    .map((n) => n.toString(16).padStart(2, "0"))
    .join("");
  if (hash !== example.sha256)
    throw Error(
      "The example failed its integrity check. Reload CAD before trying again.",
    );
  return new File([bytes], example.name + ".acad", {
    type: "application/vnd.aether.workspace+zip",
  });
}
export function base64(bytes: Uint8Array): string {
  let raw = "";
  for (let offset = 0; offset < bytes.length; offset += 8192)
    raw += String.fromCharCode(...bytes.subarray(offset, offset + 8192));
  return btoa(raw);
}
