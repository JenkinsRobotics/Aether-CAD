import { compareReference } from "./compare-reference.mjs";
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const destination = join(root, "public/examples");
await mkdir(destination, { recursive: true });
const catalog = [];
for (const key of [
  "scifirobot",
  "airplane",
  "wrench",
  "car",
  "phone",
  "space-shuttle",
  "artemis-sls",
  "reference-bracket",
  "reference-enclosure",
  "reference-studio",
  "reference-tumblers",
  "reference-materials",
]) {
  const model = (await import(`./models/${key}.mjs`)).default;
  const source = join(root, "build/Example-Collection", model.id);
  const result = JSON.parse(
    await readFile(join(source, "evidence/result.json"), "utf8"),
  );
  const bytes = await readFile(join(source, model.name + ".acad"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== result.sha256)
    throw Error(`Unverified artifact: ${model.name}`);
  await writeFile(join(destination, model.id + ".acad.bin"), bytes);
  if (model.reference)
    await writeFile(
      join(destination, model.id + "-comparison.json"),
      JSON.stringify(compareReference(model, result.proofs), null, 2) + "\n",
    );
  catalog.push({
    id: model.id,
    name: model.name,
    description: model.description,
    file: model.id + ".acad.bin",
    thumbnail: model.id + ".png",
    parts: result.parts,
    instances: result.instances,
    features: result.features,
    assemblyId: result.configurations?.[0]?.id ?? "assembly-000001",
    configurations: result.configurations,
    sources: model.sources,
    tags: model.tags,
    motion: model.motion,
    reference: model.reference
      ? {
          source: `https://github.com/tangency-labs/solidcraft/blob/main/${model.reference.source}`,
          comparison: model.id + "-comparison.json",
        }
      : undefined,
    sha256,
  });
}
await writeFile(
  join(destination, "catalog.json"),
  JSON.stringify(catalog, null, 2) + "\n",
);
console.log(
  catalog
    .map(
      (x) =>
        `${x.name}: ${x.parts} Parts, ${x.instances} components, ${x.features} features`,
    )
    .join("\n"),
);
