# Aether engine attribution

The Aether engine builds geometry with Open CASCADE Technology (OCCT), compiled to
WebAssembly by OpenCascade.js and driven through replicad.

- Open CASCADE Technology — © Open Cascade SAS, LGPL-2.1 with the OCCT exception.
  https://dev.opencascade.org
- OpenCascade.js (`opencascade.js`, `replicad-opencascadejs`) — LGPL-2.1, by Sebastian Alff and contributors.
  https://github.com/donalffons/opencascade.js
- replicad — MIT, by Steve Genoud and contributors. https://github.com/sgenoud/replicad

The wasm kernels ship unmodified beside the engine (`replicad_single.wasm`, `opencascade.full.wasm`);
Aether's modeling layer (`aether-engine/src`) is Aether's own code. Keep this file with every build
that carries the kernels.
