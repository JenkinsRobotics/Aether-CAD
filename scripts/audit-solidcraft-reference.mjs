/** Inventory the user-supplied reference without executing its code.
 * Historical tracker labels are evidence pointers, never newly awarded parity.
 * Usage: node scripts/audit-solidcraft-reference.mjs [output.json] */
import { readFileSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';

const root = new URL('../', import.meta.url);
const read = path => readFileSync(new URL(path, root), 'utf8');
const cargo = read('reference/solidcraft-main/Cargo.toml');
const features = read('reference/solidcraft-main/docs/features.md');
const tracker = read('dev/docs/roadmap/Tool_Parity_Tracker.md');
const previous = new Map([...tracker.matchAll(/^\| `([^`]+)` \|.*? \| (parity|ours\+|partial|gap|verify|n\/a|parity-ish) \|/gm)]
  .map(match => [match[1], match[2]]));
let area;
const commands = [];
for (const line of features.split('\n')) {
  if (line.startsWith('## ')) area = line.slice(3);
  const match = /^\| ([^|]+) \| `([^`]+)` \| (.*) \|$/.exec(line);
  if (!match) continue;
  commands.push({ id: match[2], title: match[1].trim(), area, toolbar: match[3].trim(),
    previous_status: previous.get(match[2]) ?? null, review: 'needs-0.23-workflow-verification' });
}
if (!commands.length || new Set(commands.map(command => command.id)).size !== commands.length) {
  throw Error('Reference command inventory is empty or contains duplicate IDs. Check the source format.');
}
const ids = new Set(commands.map(command => command.id));
const report = {
  reference_version: /^version = "([^"]+)"/m.exec(cargo)?.[1],
  reference_path: 'reference/solidcraft-main',
  registry_document_sha256: createHash('sha256').update(features).digest('hex'),
  scope: 'Static command inventory, not functional or geometric parity.',
  counts: { current: commands.length, previous: previous.size,
    added: commands.filter(command => !previous.has(command.id)).length,
    absent: [...previous.keys()].filter(id => !ids.has(id)).length },
  added: commands.filter(command => !previous.has(command.id)).map(command => command.id),
  absent: [...previous.keys()].filter(id => !ids.has(id)),
  commands,
};
if (process.argv[2]) writeFileSync(process.argv[2], JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ version: report.reference_version, ...report.counts, added_commands: report.added,
  ...(process.argv[2] ? { evidence: fileURLToPath(new URL(process.argv[2], root)) } : {}) }, null, 2));
