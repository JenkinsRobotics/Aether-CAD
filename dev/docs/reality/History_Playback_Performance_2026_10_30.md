# Feature playback and CAD performance — 2026-10-30

## History playback

Open a Part, then Version control → History → Play. The bottom feature timeline
uses the same controls. Playback shows the canonical kernel result after each
feature, highlights the current entry and scrolls it into view. It includes
sketches, suppressed entries and placement operations. Pause/resume, Stop,
Escape and 0.5×/1×/2×/4× pacing are supported. Reduced-motion preferences disable
smooth history scrolling. The camera remains under the user's control.

This is a temporary display projection, not an edit of the Part. It does not
change rollback, undo history, revision or the saved document. Stop restores the
original view, including an existing rollback position. Changing documents or
starting an edit cancels playback; late worker responses cannot replace the
restored model. Only one frame rebuild runs at a time. A heavy feature finishes
before the next dwell interval, rather than accumulating work in the queue.
Failures remain visible and do not silently skip a feature.

Playback bypasses the persistent display cache so hundreds of temporary history
frames do not displace saved-document meshes. The kernel's normal replay cache
still applies. The displayed Build value comes from the worker; Present measures
display/update work until two animation frames have elapsed. Neither is a GPU
completion timer or proof of overall rendering FPS.

Whole-assembly animation is not part of feature playback. Open an occurrence's
source Part to watch its modeling history. Current playback reveals completed
steps; it does not interpolate solid topology or orbit the camera automatically.

## Faster picking

Dense surface meshes use `three-mesh-bvh` 0.9.17 (MIT, license shipped in
`public/licenses/`). Indirect indexing preserves triangle order and face IDs.
Repeated occurrences share immutable spatial buffers but keep separate geometry,
material groups and selection. Raycasts retain every intersection so a section
can discard the nearest wall and still select a retained wall behind it.
Changed attributes, index buffers, geometry or draw ranges fall back to ordinary
raycasting; disposed geometry releases its tree reference.

`node scripts/profile-picking.mjs build/picking-performance.json` compares both
implementations on identical rays. Initial results on this Mac, median ms/ray:

| Fixture | Browser | Before | After | One-time index build |
| --- | --- | ---: | ---: | ---: |
| One 81,408-triangle sphere | Chromium | 3.597 | 0.0043 | 25.6 ms |
| One 81,408-triangle sphere | WebKit | 5.733 | 0.0067 | 24 ms |
| 65 occurrences, 193,440 triangles | Chromium | 0.146 | 0.016 | 2.3 ms |
| 65 occurrences, 193,440 triangles | WebKit | 0.153 | 0.020 | 2 ms |

Each run checks all hit positions and face ordinals. There were no mismatches.
These are synthetic CPU picking measurements, not complete pointer-event or FPS
measurements. Index construction has an initial cost and does not accelerate
OCCT rebuilding or GPU drawing.

## Scoped boolean operations

Explicit extrusion scope previously intersected every selected body to check
overlap, then performed the requested cut/intersection again. The new path uses
the requested operation's exact volume once, with conservative bounds rejection
for definitely disjoint bodies. Missed parts remain unchanged and consuming an
entire selected solid still fails validation. Temporary results belong to the
existing replay-step owner.

`node scripts/profile-kernel-scope.mjs` compares the old and new paths, alternating
order and discarding warm-up rounds. On the perforated-plate fixture, cut fell
from 18.23 to 10.87 ms (40%); intersection fell from 13.34 to 7.40 ms (45%). Exact
volume, face count and edge count agree. Tests cover a tool inside an existing
bore, disjoint scope, parameter edits, refusal and saved reopen.

This improves explicit `targetBodyIds` cuts/intersections, not every boolean or
whole-model cold load. The robot's initial build remains dominated by exact OCCT
operations. No accuracy or tessellation quality was reduced. These measurements
are not an Onshape comparison or a claim of performance parity.

## Qualification

The release gates in `RELEASING.md` cover both playback browsers, unchanged saved
files, manual rollback, actual modeling, Home routing and section pixels on
WebGPU and WebGL. Picking has transformed-occurrence, material-group, retained
wall and invalidation tests. The release also requires the frontend, engine and
native service suites plus headless rebuild and region checks.

Evidence for this pass is under `build/performance-next/` and the disposable host
directories under `build/Example-Collection/`. WebKit is a useful Safari-engine
check; it does not replace a test in the user's actual Safari installation.
