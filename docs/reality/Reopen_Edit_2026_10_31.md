# Exact replay steps across reopening — 2026-10-31

`Native_Comparison_2026_10_31.md` ranked "keep exact solids across opens" first:
reopening reused display meshes, but the first edit after opening replayed the whole
history. On the Scifirobot front shell that meant all 76 features (~5 s) for a change to
the last two. The worker now keeps its replay steps across reopening, so that first edit
replays only sketches and the changed tail.

## Change

- `snapshotEvaluation(document)` (`aether-engine/src/kernel/part-evaluator.ts`) turns a
  document's cached replay steps into plain data. Each distinct exact shape (bodies and
  feature tools) is written once as OCCT binary B-rep (`BinTools`, `brep-bytes.ts`), with
  its face triangulation. Steps refer to shapes by index and keep their body outputs,
  sketch frames, scope resolutions, current body and mesh-import buffers. Bytes are kept
  per shape object, so a snapshot after an edit only writes the shapes that edit built.
- `restoreEvaluation(document, snapshot)` seeds an **empty** step cache. It keeps steps
  only while each step key matches this document and each stored feature's JSON is
  identical to this document's feature at that position. Anything malformed (bad source,
  foreign document, unreadable or truncated B-rep, bad mesh buffers) restores nothing and
  frees any shape it read.
- Sketch profiles (replicad drawings and planes) are not stored. The first replay after a
  restore re-solves each sketch/profile and adopts the saved shapes and state for every
  other feature, then evaluates the changed tail as usual. `replayedFeatures` counts the
  re-solved sketches and the tail; adopted features are not counted.
- The worker (`occt.worker.ts`) restores before any document request when it holds no
  steps for that document, and saves a snapshot 1.5 s after the worker is idle following a
  non-preview build. Storage is `ReplayStore` (`replay-store.ts`): IndexedDB
  `aether-cad-replay-cache`, one record per document id, bounded to about 256 MiB and 64
  documents with separate LRU metadata, as the display cache does. The record's version is
  the fingerprinted worker URL, so a new engine build never restores older shapes.
  Production builds only; development builds skip it, like the display cache.

The cache never replaces the source document and never saves one. Features stay editable;
measurements, exports and stable references are computed from the same exact shapes,
now read back from B-rep instead of rebuilt.

## Results

Apple M1 Max (32 GB), Node 24, five fresh-process samples
(`scripts/benchmarks/native/reopen-edit.ts`), medians. The edit raises the gasket plane
(`features[-2].offsetMillimeters`) from 0.6 to 1.6 mm, as in the native comparison.
Portable data: `data/Reopen_Edit_2026_10_31.json`. To reproduce, after
`python3 scripts/benchmarks/native/fixtures.py`:

```sh
BENCH_ENTRY=reopen-edit node scripts/benchmarks/native/build-aether.mjs
node build/native-comparison/reopen-edit/run.mjs build/native-comparison/fixtures/robot-front.json build/native-comparison/reopen-edit.json
node scripts/verify-replay-reopen.mjs
```

| First edit after reopening | Total ms | Features evaluated | Feature ms | Display ms |
|---|---:|---:|---:|---:|
| Before: empty worker, full replay | 5,352 | 76 | 4,826 | 484 |
| After: restore snapshot, then build | **671** | 39 | 134 | 305 |
| (of which restore) | 177 | | | |

- 8.0× faster. The 39 evaluated features are the 37 sketches before the edit (re-solved,
  not stored) and the two changed features.
- Snapshot: 76 distinct shapes, 28.9 MB; writing it takes 142 ms in the worker after it
  goes idle; `structuredClone` (IndexedDB's copy) 8 ms.
- Results are identical to a cold edit: volume 316,223.337 mm³, 94 faces, 329 edges.

**Browser** (`scripts/verify-replay-reopen.mjs`): a production bundle of the real
`OCCTWorkerClient` and worker in headless Chromium with real IndexedDB. It opens the front
shell, waits for the snapshot, reloads the page (new page and worker), then edits:

| Case | ms | Features evaluated |
|---|---:|---:|
| Edit with no snapshot (reference) | 5,234 | 76 |
| Open | 5,205 | 76 |
| **Reload, then edit** | **911** | **39** |
| Damaged snapshot (first shape truncated) | 5,058 | 76 |
| Obsolete engine version | 5,645 | 76 |
| Storage unavailable (newer schema held open) | 5,221 | 76 |

Every case's display output (vertices, triangles, edges, topology and face ranges by
SHA-256; normals by value) matched the reference edit exactly. The browser figure includes
reading the 29 MB record from IndexedDB.

**Engine test** (`aether-engine/src/kernel/replay-snapshot.test.ts`): Scifirobot.acpart
(120 features, 39 bodies, fillets and chamfers) is built cold, snapshotted through
`structuredClone`, restored into an empty cache and rebuilt. Meshes, topology references,
face ranges, body outputs, sketch frames, scope resolutions, volumes and face/edge counts
equal the cold build, unchanged and after editing the last extrusion; only sketches and
the edited tail replay. Damaged, foreign, malformed and diverging snapshots restore
nothing or only the matching prefix.

## Limits

- Restored faces can give an exactly-zero normal component the opposite sign (`-0`/`0`)
  in display buffers. The vectors are identical; tests compare normals by value.
- Snapshots are large for boolean-heavy histories (28.9 MB here): every body version is a
  separate B-rep. The stock OCCT build has no `TopoDS_Iterator` or `BinTools` version
  binding, so shapes cannot share one compound. Sharing sub-shapes across steps, or
  compressing, would shrink it.
- After a restore, unchanged bodies of a multi-body Part still rebuild their display
  meshes (the in-memory mesh cache is keyed by shape object). Feature replay is fast but
  display is not: Scifirobot.acpart's restored rebuild took about 8 s, nearly all display.
  Persisting per-body display data with the snapshot would remove it. Single-body parts
  such as the front shell redraw only the changed body anyway.
- The worker keeps three documents' steps in memory, so in large assemblies only the
  most recently built parts are saved. A display-cache hit on open does not touch the
  worker; the snapshot is read on the first request for that document.
- Step keys cover features only, as the in-memory cache already did.
- The browser check exercises the production worker and IndexedDB, not the full editor
  through Studio's authenticated host. This is a local commit; no release was staged, and
  the `RELEASING.md` gates (including `verify-modeling-browser.mjs` through the disposable
  host) still apply before one.
