import type { PartDocument } from "./part-document";

/** Export a PartDocument as a deterministic, self-contained TypeScript build script
 *  (`timeline.export_script`) that reconstructs the document's variables, materials,
 *  rules, configurations, notes, and full parametric feature timeline. */
export function exportPartScript(doc: PartDocument): string {
  const lines: string[] = [
    `// Aether CAD parametric script exported from "${doc.name}"`,
    `// Format: ${doc.format} v${doc.formatVersion} · Units: ${doc.units} · Features: ${doc.features.length}`,
    `import { createEmptyPartDocument, insertFeature, validatePartDocument, type PartDocument, type PartFeature } from "@aether/core/document";`,
    ``,
    `export function buildPart(): PartDocument {`,
    `  let doc: PartDocument = {`,
    `    ...createEmptyPartDocument(${JSON.stringify(doc.name)}),`,
    `    documentId: ${JSON.stringify(doc.documentId)},`,
    `  };`,
  ];

  if (doc.variables?.length) {
    lines.push(`  // Parametric variables`);
    lines.push(`  doc = { ...doc, variables: ${JSON.stringify(doc.variables, null, 2).replace(/\n/g, "\n  ")} };`);
  }

  if (doc.bodyProperties && Object.keys(doc.bodyProperties).length) {
    lines.push(`  // Body materials and appearance`);
    lines.push(`  doc = { ...doc, bodyProperties: ${JSON.stringify(doc.bodyProperties, null, 2).replace(/\n/g, "\n  ")} };`);
  }

  if (doc.plasticRules) {
    lines.push(`  // Plastic design rules`);
    lines.push(`  doc = { ...doc, plasticRules: ${JSON.stringify(doc.plasticRules, null, 2).replace(/\n/g, "\n  ")} };`);
  }

  if (doc.sheetMetalRules) {
    lines.push(`  // Sheet metal rules`);
    lines.push(`  doc = { ...doc, sheetMetalRules: ${JSON.stringify(doc.sheetMetalRules, null, 2).replace(/\n/g, "\n  ")} };`);
  }

  if (doc.features.length) {
    lines.push(`  // Parametric feature timeline (${doc.features.length} features)`);
    doc.features.forEach((feature, i) => {
      lines.push(`  // ${i + 1}. ${feature.name} (${feature.type})${feature.suppressed ? " [suppressed]" : ""}`);
      lines.push(`  doc = insertFeature(doc, ${JSON.stringify(feature, null, 2).replace(/\n/g, "\n  ")} as PartFeature);`);
    });
  }

  if (doc.configurations) {
    lines.push(`  // Configurations`);
    lines.push(`  doc = { ...doc, configurations: ${JSON.stringify(doc.configurations, null, 2).replace(/\n/g, "\n  ")} };`);
  }

  if (doc.notes?.length) {
    lines.push(`  // 3D viewport notes & PMI`);
    lines.push(`  doc = { ...doc, notes: ${JSON.stringify(doc.notes, null, 2).replace(/\n/g, "\n  ")} };`);
  }

  lines.push(`  validatePartDocument(doc);`);
  lines.push(`  return doc;`);
  lines.push(`}`);
  lines.push(``);
  return lines.join("\n");
}
