# Native CAD example collection

These examples are native Aether Hybrid `.acad` documents. Their embedded Parts contain editable sketches and features, and their Assemblies contain occurrences and mates. They are not display meshes.

## Rebuild and qualification

Run `AETHER_EXAMPLE=<recipe name> python3 scripts/examples/collection/run-isolated-host.py` from the CAD repository after building the frontend and matching native worker. This uses Studio's disposable authenticated test host, OAuth PKCE, and the ordinary HTTP MCP modeling tools. It refuses the live host. Recipe names are the modules in `models/`. Evidence and source Parts are written to `build/Example-Collection/`; geometry-verified unchanged Parts can be reused by fingerprint.

Run `node scripts/examples/collection/verify-motion.mjs` to qualify the movable original assemblies. Run `node scripts/examples/collection/package.mjs` to package verified archives and reference comparisons. Packaged `.acad.bin` assets contain unmodified native archive bytes; the extra suffix is for Studio's static asset loader. Downloads and saved Studio copies use `.acad`.

The browser qualification script opens each packaged example without creating a file, saves a personal copy, checks its embedded Parts and materials, reloads it, and opens an internal Part. Set `AETHER_EXAMPLES_GROUP=original`, `reference` or `space`, and optionally `AETHER_EXAMPLE_MODELS=space-shuttle` to keep each invocation below the disposable host's time limit.

## Spacecraft examples

Space Shuttle and Artemis SLS Block 1 / Orion each ship as one Hybrid document containing two Assemblies that share editable Part definitions. The gallery and example preview provide an assembly selector. Saving a personal copy preserves both assemblies and the selected view.

- **Shuttle:** a grounded external tank with a fixed launch stack, plus a separate grounded orbiter with two revolute payload-door hinges. Details include a lofted fuselage, delta wings, thermal panels, payload bay frames, radiators, science payload, hollow engine bells and four-segment boosters.
- **SLS / Orion:** a grounded core stage with a fixed launch stack, plus a separate grounded service module and Orion spacecraft with four revolute solar-wing roots. Details include five-segment boosters, upper stage, protective fairings, abort tower, capsule, heat shield, docking collar, hollow nozzles and three framed panels per wing.

These are **1:100 display-scale interpretations** based on the NASA/ESA public references linked in the gallery. Principal exterior proportions follow those references; wall thicknesses, internal fittings and joint mechanics are illustrative. Solar-cell grooves and panel divisions are modeled geometry. The exposed revolute joints demonstrate articulation, not a simulation of deployment sequences or flight dynamics.

`build-configurations.mjs` creates both assemblies through ordinary project and MCP operations, reuses embedded Parts by stable ID, and checks each occurrence pose and grounded base. `verify-motion.mjs` checks all six independently movable spacecraft joints and their fastened children. `verify-browser.mjs` checks switching both preview and saved assemblies without extra personal files; `verify-motion-browser.mjs` exercises the visible Motion study and CSV export. Use `AETHER_EXAMPLE_MODELS=space-shuttle,artemis-sls` for native motion and `AETHER_EXAMPLES_GROUP=space` for browser motion.

The additional assembly exposed workspace-wide mate metadata in the codec projection. The assembly adapter now scopes mates, relations and contact sets to the active assembly while retaining unknown or crossing references for normal error reporting. The portable archive and all other assemblies remain intact.

## SolidCraft reference selection

The `reference-*` recipes recreate a curated selection from [SolidCraft](https://github.com/tangency-labs/solidcraft/tree/main/examples): bracket, demo enclosure, studio coating study, tumblers, and material finishes. Render-only variants and regression fixtures are not separate gallery models. Aether uses its own OpenCASCADE engine; no SolidCraft runtime is included.

The Chebyshev linkage was also attempted. Its four native Parts build correctly, but the saved workspace codec rejects its fourth revolute mate: “an instance may have only one incoming mate in Assembly v1.” It is retained as an unshipped comparison recipe, not listed as a working gallery example. Closed-loop assembly support requires a format/solver change; an open chain would not reproduce the source motion.

The translated design recipes are licensed under SolidCraft's MIT option; see `SOLIDCRAFT-LICENSE.txt`. Original design attribution: Copyright (c) 2026 SolidCraft contributors. Local reference snapshot: `reference/solidcraft-main` (untracked research input). The comparison artifacts record the specific source path, independently calculated expected measurements, actual native kernel measurements, and intentional differences.

Volume and removed-hole volume comparisons use relative tolerance 1e-6. Displayed bounding dimensions use 0.02 mm tolerance because the returned bounds include the kernel's bounding tolerance. Material appearance is an illustrative PBR approximation, not a certified optical or structural material model. Glass transparency is rendered opacity rather than spectral refraction. The enclosure uses the source's initial 80 mm width; its later 100 mm edit is not silently substituted.

The airplane and car are stylized engineering demonstrations, not manufacturing or flight/vehicle certification designs. The smartphone is an original generic handset study, not an Apple production design. The wrench roller and jaw have independent revolute/prismatic mates, not a screw transmission relation. The Scifirobot ducts are cooling/ventilation details.

## Scifirobot mechanical interfaces

The robot uses real radial mounting bosses and bored passages for its sensors and
ducts. Its optical carrier, hub covers, rear service cover, grille, windows and
antenna have matching shoulders, recesses and locating diameters. The equatorial
gasket is two occurrences of one connected arc Part, separated by the hub ports.
The nominal seal thickness occupies an authored gap, rather than overlapping the
shells. Fasteners have actual clearance holes and seated heads; threads remain
simplified. This is a rigid inspection-robot assembly, with fastened mates to each
component's physical parent (window to sensor, screen to duct, cover to hub).

Rebuild and qualify this example with:

```sh
AETHER_EXAMPLE=scifirobot node scripts/examples/collection/author-parts.mjs
AETHER_EXAMPLE=scifirobot AETHER_EXAMPLE_LOCAL_PARTS=1 python3 scripts/examples/collection/run-isolated-host.py
node scripts/examples/collection/verify-fit.mjs 'build/Example-Collection/scifirobot/Scifirobot Detailed.acad'
AETHER_EXAMPLE_MODELS=scifirobot node scripts/examples/collection/package.mjs
```

The optional in-process author uses the same `prepareSavedProgramStep`, exact
kernel evaluation and `acceptSavedProgramStep` used by CAD's agent commands. It
reduces repeated process startup for detailed Parts. The isolated HTTP MCP pass
still measures each Part and composes, solves, saves and reopens the assembly.
Candidate fingerprints must match the exact recipe; they are not distributable
proof by themselves. `AETHER_EXAMPLE_BUILD_PARTS` and `AETHER_EXAMPLE_BATCH_SIZE`
also allow bounded HTTP-only authoring runs. No installed user file is touched.

`verify-fit.mjs` checks the saved archive, including exact B-rep validity, one
connected solid per Part, every pair's common volume (1e-6 mm³ limit), and actual
distance between all declared seating pairs (0.005 mm tolerance). It also moves
the grounded datum in a copy of the solver job and requires all rigid children to
follow. Packaging refuses missing, stale or failing fit evidence. The screenshot
is a visual check, not the interference test. Evidence lives in
`build/Example-Collection/scifirobot/fit/`.

The 2026-10-29 interface revision retains 22 Part definitions and now uses 65
occurrences, 64 fastened mates and 196 editable features. The previous archive
had 81 interfering pairs. The revised saved archive passes all 2,080 pair checks
with no overlapping volume above tolerance, all 67 seating checks, exact solid
validity/connectivity and all 65 rigid-follow checks. The browser test also passes
preview without a file write, explicit personal copy, saved reopen and access to
the editable embedded Part. Original user copies are not rewritten by updating
the built-in example.

## Original collection qualification recorded 2026-10-29

- 10 native Hybrid examples: 90 embedded Part definitions, 162 assembly occurrences, 400 sketches/features.
- All Part recipes rebuilt via the ordinary HTTP MCP tools. Positive exact solids, actual Hole Wizard material removal, native serialization and assembly placement were checked.
- 17 independent reference measurements pass: 13 solid volumes, one removed-hole volume, three enclosure bounding dimensions.
- Original assemblies: nine independent joint drives checked. Every grounded base stayed fixed and every fastened child retained its relative transform.
- Actual browser Motion study playback and CSV export passed for the Roadster, Airplane and Wrench. Closing a study restores the authored pose.
- Every built-in example was opened without creating a Studio file, explicitly copied to personal My files, reopened, and inspected through an embedded Part.
- Native Hybrid regression passed internal Part/Assembly creation, embedded Drawing edits and saved reopen, Drive navigation and scope isolation.
- Frontend: 338 test files, 2,076 tests passed (one existing skipped test). Engine: 263 files, 1,190 tests passed. Native service: 319 passed with release gates enabled. Headless-kernel and sketch-region checks passed. Both TypeScript checks and the production build passed.
- The unshipped Chebyshev recipe documents a real saved-format limitation. It is not counted among the 10 working examples or nine joint drives.

Screenshots, MCP request/results, geometry proofs and browser results are retained locally in `build/Example-Collection/`. Gallery assets ship in `public/examples/`; temporary account/server state does not ship.

## Spacecraft extension qualification, 2026-10-29

- The collection now has 12 examples: 156 embedded Part definitions, 484 assembly occurrences and 570 sketches/features. The two spacecraft examples contribute 66 Parts and four Assemblies.
- All additional Parts were built and measured through ordinary HTTP MCP tools. Both configurations retain the same Part definitions, exact solids, materials and intended occurrence transforms.
- Native joint checks passed both Shuttle door hinges and all four Orion solar-wing roots. Browser Motion study playback, CSV export and restoring the authored pose passed for both spacecraft.
- Both examples passed preview without file creation, assembly switching, one explicit personal copy per example, both saved assemblies reopening and embedded Part editing access.
- Frontend: 339 files / 2,078 tests passed (one existing skipped test). Engine: 263 files / 1,190 tests. Native service release gates: 319 tests. Type checks, production build, headless-kernel and sketch-region checks passed. Hybrid file and both core/pose assembly browser groups passed, including contact refusal, history and saved reopen. The first concurrent pose run exceeded the fixture deadline; its independent rerun passed all four workflows in 372 seconds.
