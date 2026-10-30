import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { verifyNativeHistory } from './native-history.mjs';

const results = [];
for (const example of JSON.parse(await readFile('public/examples/catalog.json', 'utf8'))) {
  const path = 'public/examples/' + example.file;
  const result = verifyNativeHistory(path, example.assemblyId);
  results.push({ example: example.id, sha256: createHash('sha256').update(await readFile(path)).digest('hex'), ...result });
  console.log(`${example.name}: ${result.parts.length} native Parts, ${result.features} sketches/features, no imports`);
}
await mkdir('.verification/example-native-history-2026-10-29', { recursive: true });
await writeFile('.verification/example-native-history-2026-10-29/archives.json', JSON.stringify(results, null, 2));
