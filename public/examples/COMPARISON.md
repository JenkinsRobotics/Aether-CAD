# SolidCraft reference comparison

Aether recreates five source examples as native editable Hybrid files. These are source-recipe comparisons, not side-by-side runs of the SolidCraft renderer.

| Example | Geometry retained | Aether implementation / differences |
| --- | --- | --- |
| Mounting bracket | 40 × 30 × 60 mm L profile, R2 edge, two Ø8 holes | Native sketch, extrude, fillet and Hole Wizard; volume and removed volume match within 1e-6 relative tolerance. |
| Electronics enclosure | Initial 80 × 60 × 30 mm shell, 2 mm walls, USB opening and mounting bosses | Native shell and Hole Wizard; fitted lid added. The source’s later 100 mm edit is not applied. Displayed bounds agree within 0.02 mm. |
| Coating study | Curved shell, floating lid, sphere, puck at source positions | Native extrusions and revolve; all four analytic volumes match. Photographic floor and light rig omitted. |
| Glass tumblers | Both source vessel meridians | Native revolved solids; analytic volumes match. Arranged together for inspection. Room props omitted. Glass uses opacity rather than spectral refraction. |
| Material finishes | Six R10 spheres on 30 mm centers | Native revolved spheres with named materials and PBR colors; analytic volumes match. Procedural grain and optical presets are approximate. |
| Chebyshev four-bar | Four Parts successfully rebuilt; 20/40/50/50 mm linkage lengths | **Not shipped:** saved Assembly v1 rejects closed-loop mates. The source mechanism cannot be faithfully animated with the current format. |

Each gallery reference card links its source recipe and machine-readable measurements. Measurements use Aether’s exact native OpenCASCADE solids, not mesh estimates. License: SolidCraft contributors, MIT; see SOLIDCRAFT-LICENSE.txt.

Original sources: https://github.com/tangency-labs/solidcraft/tree/main/examples

This is a curated selection. Coffee-machine scenes, render variants, and individual regression fixtures are not included.
