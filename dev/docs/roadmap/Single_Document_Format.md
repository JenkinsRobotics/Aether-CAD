# One CAD document: `.aethercad` — Jonathan, 2026-11-03

Decision: Aether CAD has one file type, `Name.aethercad`, like an Onshape document.
What the document holds is metadata, not an extension. `.acpart`, `.acdrw`, `.acad`
and `.acasm` stop existing; every current file is converted once, nothing is imported.

## Format
- Container: the existing Aether workspace archive (zip, stored entries,
  `manifest.json` + `state/graph.json`; codec `aether_animation.aether_workspace`).
- Manifest gains `"app": "cad"` and `"kind"`; the project projection carries `kind`.
- `kind` is derived from content, never typed by the user:
  - `part`: part definitions with feature documents, no instances, no drawings;
  - `assembly`: instances (or mates), no drawings;
  - `drawing`: drawings only;
  - `mixed`: more than one of the above; an empty document is `part`.
- A Part Studio, an Assembly and a Drawing are tabs of one document (`?part=`,
  `?assembly=`, `?drawing=` as today). "New Part" creates a document with Part 1;
  "New Assembly" one with an empty Main Assembly; "New Drawing" adds a drawing tab.

## Work, in order (the app works after every step)
1. Codec (Aether-Animation): `workspace_kind`, manifest `kind`/`app`, projection `kind`; rebuild `runner.pyz`.
2. Engine `file-types.ts`: `AETHER_CAD_EXTENSION`, `isAetherCADFile`, `aetherCADFileName`; the three predicates are deleted.
3. CAD app: host-library returns the opened tab's kind explicitly (no extension-named in-memory files);
   hosted create/save go through `project_create`/`project_edit` only; standalone open/save read and
   write the archive in the browser (`src/document/aethercad-archive.ts`, stored zip, no dependency);
   pickers, Home filters, labels, examples (`*.aethercad.bin`), scripts, tests.
4. Studio: Rust server (`uploads.rs`, `cad_projects.rs`, `cad_settings.rs`), Python host
   (`drive_storage.py`, `documents.py`), session (`create-native-file.ts`, `LibraryHome.tsx`),
   `@aether/ui` file-types: one `cad` type ("CAD document"); Drive shows the kind from the file.
5. Conversion of the live store: a one-time Studio maintenance script rewrites every CAD row and
   revision: `.acad`/`.acasm` renamed; `.acpart`/`.acdrw` wrapped into a document with one tab.
   Cross-file links (`link_part`) keep their file ids, so they resolve unchanged.

Evidence per step: engine/app unit tests, `AETHER_TEST_NATIVE=1` service suite, the browser gates on
the disposable host, and a round trip of a converted store copy before the live conversion.
