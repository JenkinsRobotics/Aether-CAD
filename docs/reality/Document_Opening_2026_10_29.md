# Native CAD document opening — 2026-10-29

This work measures opening the actual packaged native examples through an
authenticated Studio host, including archive transport, assembly metadata,
kernel startup, feature evaluation and the first rendered model. The earlier
synthetic assembly benchmark excluded several of these stages.

## Changes

- Open the requested assembly directly. The previous path opened a temporary
  workspace for example tabs, opened the workspace again, published its default
  assembly, then selected the requested assembly. Even selecting the same
  assembly repeated its metadata reads. Normal example opens now make four
  assembly-service requests instead of nine.
- Describe, solve and BOM reads run concurrently against the same immutable
  archive. All three must pass the existing revision check before publication.
  Example tabs come from that canonical projection. Direct source-Part links
  still resolve the native Part document.
- Begin file loading alongside kernel readiness. Stop synthetic WASM warm-up
  work once a real request arrives, rather than interleaving it with real parts.
- Keep bounded, disposable display geometry in IndexedDB for production builds.
  Its key hashes the complete source and built module version. The stored source
  and version are checked again, as are mesh buffer types, sizes, finite values
  and triangle indices. Source edits and engine changes miss the cache.

The display cache contains results from the native feature evaluator. It never
replaces the source document with an imported solid or mesh. Sketches,
dimensions, construction geometry and features remain editable. Feature previews
and exact operations use the kernel; measurements and exports do not trust a
display mesh as an exact solid. The cache does not save documents or change save
conflict handling. It is limited to approximately 128 MiB and 512 records, with
small separate LRU metadata. Storage denial, quota errors, invalid entries and
failed evaluations fall back to the ordinary native build.

The production module URL includes Vite's transitive build fingerprint, so a new
engine build cannot reuse old display results. Development builds bypass disk
caching. A caller's source is captured before the asynchronous read, preventing
an intervening mutation from being stored under an older source key.

## Qualification

- 2,103 frontend tests passed, one existing integration test skipped; 1,190 engine
  tests and both TypeScript checks passed.
- All 319 native release tests passed with `AETHER_TEST_FREECAD=1`; headless exact
  build, bounds, lazy capability/export and saved sketch-region gates passed.
- Standalone and authenticated Home gates passed on the clean production build.
- The real editor opened Orion's native source sketch, saved a copy, changed a
  driving dimension in the UI, inspected and changed it through the live agent,
  undid/redid the change, saved and reopened it. All three stages passed.
- All 16 modeling browser flows passed, including display analysis, sketch on
  face, additive/subtractive/intersection extrusion, revolve, finishing, shell,
  mirror, pattern, Boolean, hole, surface thickening and sheet-metal DXF.
- Real IndexedDB browser checks: unchanged reload performed zero part builds;
  an obsolete engine version rebuilt all six wrench definitions; a damaged
  entry rebuilt just one; denied storage rebuilt normally. Body, face, edge and
  triangle counts stayed identical throughout.

The first modeling-browser attempt encountered an obsolete test selector for
the removed modal command palette. The harness now uses the current inline
CommandSearch, and the complete rerun passed. GPU browser qualification uses
Chromium with Metal/WebGPU enabled, consistent with the assembly benchmark.
Initial profiling also covered the slower default headless fallback; those
numbers are not mixed with the final matched GPU comparison.

## Measurement and limits

`scripts/examples/collection/profile-opening.mjs` records worker startup and
requests, native build time, HTTP calls, resource timings, long tasks and actual
viewport geometry counts. It waits for all expected bodies and two render frames
and captures the displayed model. `AETHER_PROFILE_RUNS=3` takes three independent
cold/repeat pairs per example; `AETHER_VALIDATE_DISPLAY_CACHE=1` runs cache failure
cases. Final measurements compare identical archive bytes from installed CAD57
and the candidate, including the current Scifirobot design.

These changes remove redundant work and repeated rebuilds. A previously unseen
complex native Part still requires exact feature evaluation. Scifirobot's front
shell remains a significant cold-build cost. This is not a claim that arbitrary
large assemblies open instantly: persistent file-level evaluated representations,
progressive display, GPU instancing and the current portable service's 512-instance
limit still need separate work. The full matched SolidCraft comparison remains
open. See `Assembly_Performance_2026_10_28.md` for the previous benchmark's limits.

Private evidence is in `build/Example-Collection/opening-*/host/`,
`build/opening-*.log`, `build/opening-release/`, and Studio's
`.verification/cad-opening-2026-10-29/`. The Studio release ledger records the
final timing medians, immutable package and live verification.
