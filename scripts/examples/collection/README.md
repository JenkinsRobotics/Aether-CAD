# Native CAD example collection

These examples are native Aether Hybrid `.acad` documents. Their embedded Parts contain editable sketches and features, and their Assemblies contain occurrences and mates. They are not display meshes.

## Rebuild and qualification

Run `AETHER_EXAMPLE=<recipe name> python3 scripts/examples/collection/run-isolated-host.py` from the CAD repository after building the frontend and matching native worker. This uses Studio's disposable authenticated test host, OAuth PKCE, and the ordinary HTTP MCP modeling tools. It refuses the live host. Recipe names are the modules in `models/`. Evidence and source Parts are written to `build/Example-Collection/`; geometry-verified unchanged Parts can be reused by fingerprint.

Run `node scripts/examples/collection/verify-motion.mjs` to qualify the movable original assemblies. Run `node scripts/examples/collection/package.mjs` to package verified archives and reference comparisons. Packaged `.acad.bin` assets contain unmodified native archive bytes; the extra suffix is for Studio's static asset loader. Downloads and saved Studio copies use `.acad`.

The browser qualification script opens each packaged example without creating a file, saves a personal copy, checks its embedded Parts and materials, reloads it, and opens an internal Part. Set `AETHER_EXAMPLES_GROUP=original` or `reference` to keep each invocation below the disposable host's time limit.

## SolidCraft reference selection

The `reference-*` recipes recreate a curated selection from [SolidCraft](https://github.com/tangency-labs/solidcraft/tree/main/examples): bracket, demo enclosure, studio coating study, tumblers, and material finishes. Render-only variants and regression fixtures are not separate gallery models. Aether uses its own OpenCASCADE engine; no SolidCraft runtime is included.

The Chebyshev linkage was also attempted. Its four native Parts build correctly, but the saved workspace codec rejects its fourth revolute mate: “an instance may have only one incoming mate in Assembly v1.” It is retained as an unshipped comparison recipe, not listed as a working gallery example. Closed-loop assembly support requires a format/solver change; an open chain would not reproduce the source motion.

The translated design recipes are licensed under SolidCraft's MIT option; see `SOLIDCRAFT-LICENSE.txt`. Original design attribution: Copyright (c) 2026 SolidCraft contributors. Local reference snapshot: `reference/solidcraft-main` (untracked research input). The comparison artifacts record the specific source path, independently calculated expected measurements, actual native kernel measurements, and intentional differences.

Volume and removed-hole volume comparisons use relative tolerance 1e-6. Displayed bounding dimensions use 0.02 mm tolerance because the returned bounds include the kernel's bounding tolerance. Material appearance is an illustrative PBR approximation, not a certified optical or structural material model. Glass transparency is rendered opacity rather than spectral refraction. The enclosure uses the source's initial 80 mm width; its later 100 mm edit is not silently substituted.

The airplane and car are stylized engineering demonstrations, not manufacturing or flight/vehicle certification designs. The smartphone is an original generic handset study, not an Apple production design. The wrench roller and jaw have independent revolute/prismatic mates, not a screw transmission relation. The Scifirobot ducts are cooling/ventilation details.

## Qualification recorded 2026-10-29

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
