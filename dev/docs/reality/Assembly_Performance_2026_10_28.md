# Assembly loading and redraw — 2026-10-28

WebGPU remains the viewport backend. This change separates definition evaluation
from occurrence placement in the browser; it does not replace OCCT, change the
saved model, or approximate exact modeling operations.

## Findings and implementation

The previous canonical assembly loader and solve/motion display adapter parsed
and evaluated a Part for every visible occurrence. The kernel retains exact
history for only three documents, so an assembly cycling through ten definitions
could evict and rebuild them repeatedly. Each worker response also transferred
another complete set of mesh buffers. Moving an occurrence discarded every
rendered body, selection and GPU resource, then rebuilt the whole scene.

`AssemblyGeometryCache` keeps one evaluated version per definition, keyed by
workspace, definition ID and the entire serialized feature document. Unchanged
occurrences reuse the returned buffers. A changed definition, undo, or another
document using the same ID cannot accidentally reuse a different source. Failed
requests are evicted; concurrent identical requests share one promise; stale
completions cannot replace a newer entry. The session cache bounds its estimated
retained source/geometry payload to 128 MiB and 2,048 entries. This is not a limit
on total browser memory. The currently displayed assembly also owns its data.

The common preparation adapter evaluates each distinct visible definition once
per render even under cache pressure. A superseded canonical render stops before
submitting another definition. Canonical display, Solve, Explode and Motion use
the same cache. An occurrence with unchanged buffers/topology keeps its mesh,
materials and selection. Only its matrix changes; an active section recomputes
that occurrence's local cap and clipped edges. Changed or removed geometry drops
its obsolete selections. Metrics and selection notifications publish once per
assembly update instead of once per body.

Surface draw groups now combine consecutive faces with the same appearance.
Face topology/ranges remain independent for picking, anchors and measurements.
Hovering/selecting a face splits only the required draw ranges. Repeated
occurrences retain independent selection, materials and section scopes.
GPU instancing/shared GPU allocations are **not** implemented by this change.

## Reproducible measurements

Run `node scripts/benchmark-assembly.mjs`. Optional environment variables:
`AETHER_ASSEMBLY_PERFORMANCE_EVIDENCE` chooses the output directory;
`AETHER_ASSEMBLY_PERFORMANCE_CASES` is a JSON list of `[occurrences, definitions]`.
The fixture uses the real OCCT worker and `MateViewport` on Chromium WebGPU/Metal,
at 1200 × 800, with visible edges. It records definition preparation, scene update,
the next rendered frame, draw counts and buffer identity. It also asserts source
invalidation, retained GPU geometry on movement and independent face selection.

Baseline source: `a9c2cdb`. Initial measurements on this Mac (milliseconds):

| Scenario | Before | Candidate |
| --- | ---: | ---: |
| First display: 1,000 occurrences / 10 definitions | 3,104 | 240 |
| Move those occurrences | 16,765 | 19 |
| Edit one shared definition | 16,887 | 44 |
| First display: 1,000 unique definitions | 2,929 | 3,446 |
| Move those unique parts | 16,887 | 26 |
| Edit one of those definitions | 16,845 | 37 |

A final run with geometry-retention and independent-selection assertions gave
249 ms / 43 ms / 46 ms for the 1,000/10 scenario, and 3,945 ms / 34 ms / 36 ms
for 1,000 unique definitions. With 5,000 occurrences / 20 definitions: first
display 1,072 ms, movement 103 ms, one-definition edit 244 ms. All 5,000 surface
geometries survive movement; editing one definition replaces only its 250
occurrences. Steady rendering in that larger fixture was about **13 FPS**, with
10,003 draw calls: submission/batching is a remaining measured viewport limit.

These are synthetic rectangular solids, **after engine initialization**, and not
end-to-end document-opening or mate-solving timings. The worker's startup was
recorded separately (312 ms baseline, 948 ms candidate in these runs). Files are
generated locally; no PDM download, assembly metadata service, contact solving,
constraint solving or disk-cache speed is included. Absolute timings vary with
load and hardware; operation/resource counts are deterministic regression gates.
Cold unique-part loading did not improve and is explicitly not claimed to do so.

At 1,000 occurrences / 10 definitions, geometry requests fall from 1,000 on every
update to 10 initially, zero on movement and one for the changed definition.
Transferred vertex buffer sets fall from 1,000 to 10. Ordinary scene draw calls
fall from 7,003 to 2,003. These are CPU-side Three.js draw counts, not GPU timings.

Private evidence: `.verification/assembly-performance-2026-10-28/` in CAD and
`.verification/cad-assembly-performance-2026-10-28/` in Studio. Browser workflow
tests use a disposable PostgreSQL/object-store clone and the selected installed
workers, with only the CAD frontend replaced by the candidate build.

## SolidCraft comparison and remaining work

Reviewed the supplied 0.23.0 sources in
`reference/solidcraft-main/crates/engine/src/product_scene.rs`,
`crates/engine/src/frames.rs`, `crates/doc/src/model_cache.rs`, and
`crates/io/src/design/native_cache.rs`. Their cached evaluated states and reused
occurrence geometry are relevant to loading/rebuilding independently of the GPU
API. Their native saved cache ties results to document content, build and platform,
stores shared parts once, and can thin history to its budget. No SolidCraft code
or runtime is imported by this implementation; no matched hardware performance
comparison with SolidCraft was run here.

This is a measured first scalability improvement, not certification for arbitrary
large assemblies. Further qualification needs realistic imported/filleted parts,
high triangle counts, many unique definitions, deep feature histories, mates and
contacts, representative devices and memory pressure. Important remaining paths:

- Persist validated evaluated/display caches for fast reopening in a fresh tab,
  while keeping authored features authoritative and rejecting stale engine caches.
- Load visible/needed definitions progressively and yield during large scene
  creation. The current first display waits for all requested definitions.
- Instance or batch repeated GPU geometry with independent picking, appearance,
  transparency and section clipping; retain correct per-occurrence identities.
- Measure and optimize assembly solving, metadata/archive transport and full
  open-to-interactive latency separately. Display tests do not establish solver
  scaling or performance for thousands of constrained components.
- Replace the kernel's fixed three-document history limit with a measured resource
  policy if exact-operation profiling shows cache thrashing beyond the display path.
