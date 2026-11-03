# CAD workspace codec dependency

2026-11-03: immutable build `0.1.0-25` (Animation commit `2d61599`) lets a document hold
every Part version CAD still reads (1..22, including the v1 `open-cad-part` header), so the
one-time store conversion can wrap any saved Part file and CAD migrates features on read.
`codec25-provenance.json` records the module hashes.

2026-11-03: immutable build `0.1.0-24` adopts the derived document kind from Animation
commit `6be7a86`: `AetherWorkspace.kind` (part, assembly, drawing or mixed), written to
`manifest.json` as `kind` beside `app: "cad"`, and carried by the project projection.
No file schema or version changes; older archives read unchanged and gain a kind on
their next save. `codec24-provenance.json` records the module hashes.

2026-10-24: immutable build `0.1.0-21` adopts canonical tree grounding and
relation dependency evaluation from Animation commit
`855619103608f0c6edd79e29141af30dde39db60`. All five runtime modules match that
commit; only `aether_workspace.py` differs from codec20. The snapshot changes no
file fields/schema and preserves authored rest poses. Both endpoint grounding,
conflicting anchors, signed relation chains and cycle refusal are qualified at
source and through CAD's saved native worker. `codec21-provenance.json` records
exact module hashes. Older archives and the installed Animation app are unchanged.

2026-10-24: immutable build `0.1.0-20` adopts canonical contact metadata and cam
lift-table preservation plus the reader-version guard from Animation commit
`453b382a2d690ab588848c5e917c75a6c1158be8`. All five bundled runtime modules match
that commit exactly; `aether_workspace.py` and `relation_kinds.py` changed from
codec19. As with prior snapshots, other unused wheel files retain their previous
bytes. This is a portable-codec dependency snapshot, not a new Animation app build.
`codec20-provenance.json` records source and per-module hashes; older wheels remain
unchanged. CAD does not import sibling source at runtime.

Graph schema 2 protects contact/cam intent from older readers; plain files retain
schema 1 and identical roundtrips. Legacy schema-1 contact data is upgraded on
save. Frozen codec19 refusal and native CAD worker roundtrips qualify this guard.
CAD now routes portable Assembly operations through its own released worker at
`/api/cad/assembly`, not Studio's Animation runtime. Exact geometry/contact checks
stay in the in-process Aether engine. Cam authoring/sampling is not implemented
by adopting the metadata library.

2026-10-23: immutable build `0.1.0-19` adopts the already-verified eight-mate
workspace change from Animation commit `726c0afff55a966643454bf264f0b4a0e09126d6`.
All five runtime modules match that commit; only `aether_workspace.py` changes
from codec18. CAD previously offered eight mate kinds while its packaged codec
accepted only three. This updates the dependency, without copying newer contact
or cam semantics into this release. Existing wheels remain unchanged. The full
native service suite runs with this exact wheel through
`scripts/test-native-service.py`; eight isolated-worker compose/reopen cases
exercise the offered kinds. Packaging provenance is retained in Studio's
`.verification/cad-functional-audit-2026-10-23/codec19-provenance.json` and
`package-codec19.py`.

2026-10-14: immutable build `0.1.0-17` adds Part20 conic records. It retains the
previous wheel's files and changes only the canonical `aether_workspace.py`
version whitelist, wheel build metadata and RECORD hashes. The five bundled
runtime modules match Animation's source exactly. Codec16 and the frozen Part19
reader refuse new files; codec17 round-trips the actual authored conic Part and
workspace bytes. Reproducible packaging and validation:
`.verification/sketch-conic-integration-2026-10-14/RESULTS.md`.

`workspace-codec.json` pins the exact local Animation wheel and SHA-256 used to
package CAD's existing `.acad` / `.acasm` workspace format. The codec already
belongs to `aether_animation`; this checkpoint does not fork its semantics.
The wheel includes the relation vocabulary extraction made for this migration.
It is a local, unpublished dependency snapshot, not a remote release.

`build-native-automation.py` verifies the archive hash and bundles only the five
listed pure-Python modules into the isolated CAD worker. It never imports a
sibling checkout, Studio, NumPy or site packages at runtime. The worker uses
Studio-authorized bytes only; the Rust host owns accounts, ACLs and history.

Update this dependency deliberately from a verified Animation build and update
the fingerprint together. Do not silently change a pinned archive. The full
Animation application and its numerical playback engine are not embedded in CAD.

2026-10-13: the `0.1.0-1` build adds embedded Part v4 acceptance to the
canonical codec, retaining the old wheel unchanged. Of the five bundled modules,
only `aether_workspace.py` differs (version whitelist and integer-header check).
Codec roundtrip/refusal and isolated CAD project/settings/native tests qualify
the update; see `.verification/part-format-v4-2026-10-13/codec-package.json`.
This does not change the workspace container format or animation semantics.

2026-10-13: immutable build `0.1.0-2` adds embedded Part v5 acceptance for
associative sketch-line extrusion directions. Previous wheels are retained.
Only the canonical codec version whitelist differs among the bundled modules;
CAD owns reference validation and geometry. Packaged native evaluation, upstream
line edits and project roundtrips are qualified in
`.verification/extrude-line-direction-2026-10-13/RESULTS.md`.

2026-10-13: immutable build `0.1.0-3` adds embedded Part v6 acceptance for
Thin extrusion. Older wheels remain unchanged. Only the canonical codec version
whitelist differs among the five bundled modules; CAD owns thin geometry and
validation. Evidence: `.verification/thin-extrusion-2026-10-13/RESULTS.md`.

2026-10-13: immutable build `0.1.0-4` adds embedded Part v7 acceptance for
selected-part extrusion limits. Only the version whitelist differs among the
five bundled canonical modules. Prior archives remain unchanged; native project
and codec roundtrips are qualified in
`.verification/extrude-up-to-part-2026-10-13/RESULTS.md`.

2026-10-13: immutable build `0.1.0-5` adds embedded Part v8 acceptance for
selected-point extrusion limits. Only the canonical codec whitelist changes among
the five bundled modules; prior archives remain unchanged. CAD owns references
and geometry. Source, frozen-reader, packaged project and native acceptance:
`.verification/extrude-up-to-vertex-2026-10-13/RESULTS.md`.


2026-10-13: immutable build `0.1.0-8` adds embedded Part v11 acceptance for
curved stopping-face references. Codec8 is built from canonical Animation source;
only `aether_workspace.py` differs among the five bundled modules relative to
codec7. Earlier wheels remain unchanged. Current project roundtrip and actual
codec7 refusal of a new curved-reference project are verified, along with the
native worker's exact packaged bytes. CAD owns reference validation and geometry.
Evidence: `.verification/extrude-curved-face-2026-10-13/RESULTS.md`.

2026-10-13: immutable build `0.1.0-9` adds embedded Part v12 acceptance for
selected-face offsets. Only the canonical workspace version whitelist differs
among the five bundled modules compared with codec8; all five match Animation's
canonical source. Existing wheels remain unchanged. CAD owns offset geometry,
reference validation and history. Evidence:
`.verification/offset-face-2026-10-13/RESULTS.md`.

2026-10-13: immutable build `0.1.0-10` adds embedded Part v13 acceptance for
solid part transforms and copy identities. Only the canonical workspace version
whitelist differs among the five bundled modules compared with codec9; every
bundled module matches Animation source. Existing wheels remain unchanged. CAD
owns transform validation, geometry and history. Current roundtrip and codec9
refusal are verified in `.verification/part-transform-2026-10-13/RESULTS.md`.

2026-10-13: immutable build `0.1.0-11` adds embedded Part v14 acceptance for
geometry-referenced transforms. Only the canonical version whitelist differs
among the five packaged modules compared with codec10; every module matches
Animation source. CAD owns reference validation and native geometry. Previous
archives remain unchanged. Current roundtrip and codec10 refusal are verified in
`.verification/referenced-transform-2026-10-13/RESULTS.md`.

2026-10-14: immutable build `0.1.0-14` adds embedded Part17 acceptance for
whole-entity sketch Fix. All five bundled modules match canonical Animation
source; only the workspace version whitelist differs from codec13. Current
byte-roundtrip and actual codec13 rejection of a Part17 project are verified.
CAD owns all fixed-geometry interpretation and native Block translation.
See `.verification/sketch-fixed-geometry-2026-10-14/RESULTS.md` (source qualified;
live browser and installation still pending).
# CAD Part18 codec — 2026-10-14

`aether_animation-0.1.0-15-py3-none-any.whl` is an immutable build of the canonical
Animation-owned portable container. The Part-version whitelist is the only
changed bundled module relative to build14. CAD's `workspace-codec.json` pins
its SHA-256. It preserves Part18 spline-end semantics as opaque feature records;
codec14 refuses these newer files. Evidence and byte roundtrip/reader checks:
`.verification/sketch-end-tangents-2026-10-14/`.

2026-10-14: immutable build `0.1.0-16` accepts embedded Part19 for connected
sketch-region references. All five bundled modules match canonical Animation;
only the workspace Part-version whitelist changed from build15. CAD owns group
validation and geometry. Prior wheels are retained. Current byte roundtrip and
actual codec15 refusal are recorded in
`.verification/sketch-connected-region-integration-2026-10-14/`.

2026-10-24: immutable build `0.1.0-22` accepts embedded Part22 signed distance
intent. All five runtime modules match canonical Animation commit
`0aa5519e929a39fb40c6992014f5aa82cc4c7021`; only `aether_workspace.py` differs
from codec21. The new reader preserves Part22 bytes; actual codec21 refuses them.
Both preserve legacy Part21 bytes. Prior wheels remain unchanged. CAD owns all
constraint interpretation. Evidence: `.verification/baseline-2026-10-24/` under
`projected-dimension-codec-*` and `codec22-provenance.json`.
