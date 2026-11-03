import { verifyNativeHistory } from "./native-history.mjs";
import { compareReference } from "./compare-reference.mjs";
import { readFile, writeFile, copyFile, mkdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
const root = fileURLToPath(new URL("../../../", import.meta.url));
const destination = join(root, "public/examples");
await mkdir(destination, { recursive: true });
const selection = process.env.AETHER_EXAMPLE_MODELS?.split(",");
const previous = selection
  ? JSON.parse(await readFile(join(destination, "catalog.json"), "utf8"))
  : [];
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
  if (selection && !selection.includes(key)) {
    const retained = previous.find((r) => r.id === model.id);
    if (!retained) throw Error(`No packaged example to retain: ${key}`);
    catalog.push(retained);
    continue;
  }
  const source = join(root, "build/Example-Collection", model.id);
  const result = JSON.parse(
    await readFile(join(source, "evidence/result.json"), "utf8"),
  );
  const history = verifyNativeHistory(join(source, model.name + ".aethercad"), result.configurations?.[0]?.id ?? "assembly-000001");
  if (history.parts.length !== result.parts || history.features !== result.features) throw Error("Example native history differs from its build proof");
  const bytes = await readFile(join(source, model.name + ".aethercad"));
  const sha256 = createHash("sha256").update(bytes).digest("hex");
  if (sha256 !== result.sha256)
    throw Error(`Unverified artifact: ${model.name}`);
  if (key === "scifirobot") {
    const fit = JSON.parse(
      await readFile(join(source, "fit/result.json"), "utf8"),
    );
    if (
      fit.archive_sha256 !== sha256 ||
      fit.overlaps.length ||
      fit.seats.length < 60 ||
      fit.seats.some((s) => Math.abs(s.gap_mm - s.expected_mm) >= 0.005) ||
      fit.checked_pairs !== (result.instances * (result.instances - 1)) / 2
    )
      throw Error(
        "Scifirobot requires complete exact interference and seating proof for these archive bytes",
      );
    const concept = JSON.parse(
      await readFile(join(source, "concept/result.json"), "utf8"),
    );
    if (
      concept.archive_sha256 !== sha256 ||
      concept.checks.length !== 31 ||
      concept.checks.some((check) => !check.passed)
    )
      throw Error(
        "Scifirobot requires forward barrel/sensor orientation and finish proof for these archive bytes",
      );
  }
  if (key === "space-shuttle") {
    const dimensions = JSON.parse(
      await readFile(join(source, "dimensions/result.json"), "utf8"),
    );
    if (
      dimensions.archive_sha256 !== sha256 ||
      dimensions.checks.length !== 15 ||
      dimensions.checks.some((check) => !check.passed)
    )
      throw Error(
        "Shuttle requires passing NASA dimension checks for these archive bytes",
      );
  }
  await writeFile(join(destination, model.id + ".aethercad.bin"), bytes);
  if (model.reference)
    await writeFile(
      join(destination, model.id + "-comparison.json"),
      JSON.stringify(compareReference(model, result.proofs), null, 2) + "\n",
    );
  catalog.push({
    id: model.id,
    name: model.name,
    description: model.description,
    file: model.id + ".aethercad.bin",
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
