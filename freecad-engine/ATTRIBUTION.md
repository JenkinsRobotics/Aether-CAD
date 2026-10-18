# Attribution — FreeCAD

Aether CAD's `freecad-engine` module runs **FreeCAD** as its geometry and
parametric-feature engine. FreeCAD is not ours; we owe it the credit.

- **FreeCAD** — https://www.freecad.org — https://github.com/FreeCAD/FreeCAD
- © 2001–2026 FreeCAD contributors
- Licensed under the **GNU Lesser General Public License, version 2.1 or
  later** (LGPL-2.1+). FreeCAD's own notice: *"FreeCAD is free and
  open-source software licensed under the terms of LGPL2+ license."*
- Verified in use here: FreeCAD **1.1.3**, Libs 1.1.3R20260725.

FreeCAD in turn builds on **Open CASCADE Technology** (LGPL-2.1 with an
additional exception), which Aether CAD also uses directly in the browser.

## How we use it, and why that matters for the licence

We **do not vendor, modify or statically link** FreeCAD source. This module
invokes an installed FreeCAD through its own `freecadcmd` console binary and
its public Python API, in a separate process, over a JSON boundary. That is
ordinary use of an LGPL program as a program — the obligation is notice and
attribution, which this file provides, and keeping FreeCAD replaceable by the
user's own build, which the `AETHER_FREECAD_CMD` environment variable does.

If we ever patch FreeCAD itself, those patches fall under LGPL-2.1+ and must
be published. Keep any such patches in this directory so that obligation is
impossible to lose track of.

## Where FreeCAD's source lives

A reference checkout sits at the repository root as `FreeCAD-main/`, **not
committed** (it is in `.gitignore`; 436 MB plus a 112 MB archive). It is read
for algorithm recipes — which OCCT calls a feature makes, how the Sketcher
maps constraints onto PlaneGCS — and those readings are credited in code
comments that name the FreeCAD file they came from.

## PlaneGCS

`@salusoft89/planegcs`, used by the browser-side sketch solver spike, is a
WebAssembly build of FreeCAD's own `planegcs` solver, LGPL-2.0-or-later.
Same principle: separate module, notice given, replaceable.
