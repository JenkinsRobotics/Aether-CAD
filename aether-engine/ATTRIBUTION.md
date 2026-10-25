# Aether engine attribution

The Aether engine builds geometry with Open CASCADE Technology (OCCT), compiled to
WebAssembly by OpenCascade.js and driven through replicad.

- Open CASCADE Technology — © Open Cascade SAS, LGPL-2.1 with the OCCT exception.
  https://dev.opencascade.org
- OpenCascade.js (`opencascade.js`, `replicad-opencascadejs`) — LGPL-2.1, by Sebastian Alff and contributors.
  https://github.com/donalffons/opencascade.js
- replicad — MIT, by Steve Genoud and contributors. https://github.com/sgenoud/replicad
- Drawing PDF serialization: pdf-lib 1.17.1 — MIT, Andrew Dillon and contributors.
  https://github.com/Hopding/pdf-lib
- PDF font embedding: @pdf-lib/fontkit 1.1.1 — MIT, Devon Govett and contributors.
  https://github.com/Hopding/fontkit
- Drawing PDF text embeds a subset of the existing shared Noto Sans font — SIL
  Open Font License 1.1. The pinned asset package supplies the font and license.
  PDF library licenses ship in `licenses/drawing-pdf/` in the frontend and in the
  worker archive's `licenses/`; the worker retains NotoSans-LICENSE.txt beside its font.

The wasm kernels ship unmodified beside the engine (`replicad_single.wasm`, `opencascade.full.wasm`);
Aether's modeling layer (`aether-engine/src`) is Aether's own code. Keep this file with every build
that carries the kernels.

PDF dependency notices (including fontkit bundled Brotli/Node code and the Apache
2.0 text) are retained in `public/licenses/drawing-pdf/dependencies.txt`. The
frontend and worker package the same notices with the pinned Noto Sans OFL.
