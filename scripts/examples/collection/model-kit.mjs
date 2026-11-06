// Design inputs for the ordinary CAD MCP commands, never display meshes.
export const ref = (id, field = "feature_id") => ({ $ref: `${id}.${field}` });
export const polygon = (points) => ({
  type: "path",
  start: points[0],
  segments: [...points.slice(1), points[0]].map((end) => ({
    type: "line",
    end,
  })),
});
export const circle = (r, center = [0, 0]) => ({
  type: "circle",
  center,
  radius: r,
});
export const rectangle = (w, h, x = 0, y = 0) =>
  polygon([
    [x - w / 2, y - h / 2],
    [x + w / 2, y - h / 2],
    [x + w / 2, y + h / 2],
    [x - w / 2, y + h / 2],
  ]);
export function rounded(w, h, r, x = 0, y = 0) {
  const a = w / 2,
    b = h / 2,
    k = Math.SQRT1_2;
  const p = (u, v) => [x + u, y + v];
  return {
    type: "path",
    start: p(-a + r, -b),
    segments: [
      { type: "line", end: p(a - r, -b) },
      {
        type: "arc",
        middle: p(a - r + r * k, -b + r - r * k),
        end: p(a, -b + r),
      },
      { type: "line", end: p(a, b - r) },
      {
        type: "arc",
        middle: p(a - r + r * k, b - r + r * k),
        end: p(a - r, b),
      },
      { type: "line", end: p(-a + r, b) },
      {
        type: "arc",
        middle: p(-a + r - r * k, b - r + r * k),
        end: p(-a, b - r),
      },
      { type: "line", end: p(-a, -b + r) },
      {
        type: "arc",
        middle: p(-a + r - r * k, -b + r - r * k),
        end: p(-a + r, -b),
      },
    ],
  };
}
export const materials = {
  aluminum: {
    name: "Aluminum 6061",
    densityKgPerM3: 2700,
    color: "#aebcc7",
    roughness: 0.32,
    metalness: 0.8,
    opacity: 1,
  },
  steel: {
    name: "Stainless steel",
    densityKgPerM3: 7850,
    color: "#afbdc9",
    roughness: 0.23,
    metalness: 0.88,
    opacity: 1,
  },
  rubber: {
    name: "Rubber",
    densityKgPerM3: 1100,
    color: "#20252a",
    roughness: 0.88,
    metalness: 0,
    opacity: 1,
  },
  glass: {
    name: "Glass",
    densityKgPerM3: 2500,
    color: "#365d70",
    roughness: 0.12,
    metalness: 0.12,
    opacity: 0.74,
  },
  plastic: {
    name: "ABS",
    densityKgPerM3: 1040,
    color: "#313b48",
    roughness: 0.4,
    metalness: 0,
    opacity: 1,
  },
  blue: {
    name: "Painted aluminum",
    densityKgPerM3: 2700,
    color: "#166fbd",
    roughness: 0.25,
    metalness: 0.45,
    opacity: 1,
  },
  red: {
    name: "Painted aluminum",
    densityKgPerM3: 2700,
    color: "#b72f35",
    roughness: 0.22,
    metalness: 0.45,
    opacity: 1,
  },
  ivory: {
    name: "Painted aluminum",
    densityKgPerM3: 2700,
    color: "#e8e6dd",
    roughness: 0.3,
    metalness: 0.25,
    opacity: 1,
  },
  brass: {
    name: "Brass",
    densityKgPerM3: 8500,
    color: "#b28a42",
    roughness: 0.26,
    metalness: 0.8,
    opacity: 1,
  },
  pcb: {
    name: "FR-4 circuit board",
    densityKgPerM3: 1850,
    color: "#174e39",
    roughness: 0.68,
    metalness: 0,
    opacity: 1,
  },
};
export class Part {
  constructor(key, name, material = "aluminum", description = "") {
    Object.assign(this, {
      key,
      name,
      material: structuredClone(
        typeof material === "string" ? materials[material] : material,
      ),
      description,
      steps: [],
      body: `${key}-solid`,
    });
  }
  add(name, feature) {
    const id = `f${this.steps.length}`;
    this.steps.push({
      id,
      tool: "aether_cad_feature_add",
      arguments: { feature_json: { ...feature, name, suppressed: false } },
    });
    return id;
  }
  sketch(name, contours, z = 0, plane = "XY") {
    return this.add(name, {
      type: "profile",
      plane,
      offsetMillimeters: z,
      profile: {
        type: "drawing",
        contours,
        constraints: contours.flatMap((c, i) =>
          c.type === "circle"
            ? [
                {
                  id: `center-${i}`,
                  kind: "fix",
                  a: { contour: i, kind: "point", index: 0 },
                  point: c.center,
                },
                {
                  id: `diameter-${i}`,
                  kind: "diameter",
                  a: { contour: i, kind: "circle" },
                  value: 2 * c.radius,
                },
              ]
            : [
                {
                  id: `datum-${i}`,
                  kind: "fix",
                  a: { contour: i, kind: "contour" },
                  fixedGeometry: structuredClone(c),
                },
              ],
        ),
      },
    });
  }
  pad(
    name,
    contours,
    z,
    depth,
    operation = "new",
    plane = "XY",
    reversed = false,
    point,
  ) {
    const p = this.sketch(`${name} — sketch`, contours, z, plane),
      id = `f${this.steps.length}`;
    this.steps.push({
      id,
      tool: "aether_cad_extrude",
      arguments: {
        name,
        profile_id: ref(p),
        depth_mm: depth,
        operation,
        ...(operation === "new"
          ? {}
          : { target_body_id: ref(this.solid, "body_id") }),
        ...(reversed ? { reversed: true } : {}),
        ...(point
          ? { profile_point_mm: point }
          : contours.length > 1
            ? { all_regions: true }
            : {}),
      },
    });
    if (operation === "new") this.solid = id;
    return this;
  }
  ring(name, outer, inner, z, depth, operation = "new") {
    return this.pad(
      name,
      [circle(outer), ...(inner ? [circle(inner)] : [])],
      z,
      depth,
      operation,
      "XY",
      false,
      inner ? [(outer + inner) / 2, 0] : undefined,
    );
  }
  revolve(name, contour) {
    const p = this.sketch(`${name} — section`, [contour], 0, "XZ");
    this.solid = this.add(name, {
      type: "revolve",
      profileFeatureId: ref(p),
      axis: "Z",
      angleDegrees: 360,
      operation: "new",
      bodyId: this.body,
    });
    return this;
  }
  loft(name, sections, plane = "XY", ruled = false) {
    const ids = sections.map(([z, contour], i) =>
      this.sketch(`${name} — station ${i + 1}`, [contour], z, plane),
    );
    this.solid = this.add(name, {
      type: "loft",
      sections: ids.map((id) => ({ profileFeatureId: ref(id) })),
      operation: "new",
      ruled,
      bodyId: this.body,
    });
    return this;
  }
  sweep(name, profile, spine, plane = "XZ", offset = 0) {
    const a = this.sketch(`${name} — section`, [profile]),
      b = this.sketch(`${name} — path`, [spine], offset, plane);
    this.solid = this.add(name, {
      type: "sweep",
      profileFeatureId: ref(a),
      pathFeatureId: ref(b),
      operation: "new",
      bodyId: this.body,
    });
    return this;
  }
  holes(
    name,
    centers,
    diameter,
    z,
    depth,
    {
      cutType = "plain",
      counterDiameter,
      counterDepth,
      angle = 90,
      through = false,
      plane = "XY",
      reversed = false,
    } = {},
  ) {
    const p = this.sketch(
      `${name} — centers`,
      centers.map((c) => circle(diameter / 2, c)),
      z,
      plane,
    );
    this.add(name, {
      type: "hole",
      profileFeatureId: ref(p),
      allCircles: true,
      targetBodyId: ref(this.solid, "body_id"),
      diameterMillimeters: diameter,
      depthMillimeters: depth,
      depthType: through ? "through-all" : "blind",
      cutType,
      ...(counterDiameter
        ? { counterDiameterMillimeters: counterDiameter }
        : {}),
      ...(counterDepth ? { counterDepthMillimeters: counterDepth } : {}),
      ...(cutType === "countersink" ? { countersinkAngleDegrees: angle } : {}),
      ...(reversed ? { reversed: true } : {}),
    });
    return this;
  }
  finishFace(name, radius, normal, type = "chamfer") {
    // A unique oriented native face follows upstream dimensions. Ambiguous
    // normals are rejected by the evaluator rather than selecting a neighbor.
    this.add(name, {
      type,
      radiusMillimeters: radius,
      targetBodyId: ref(this.solid, "body_id"),
      edges: [{
        kind: "face-edges",
        sourceFeatureId: ref(this.solid),
        bodyId: ref(this.solid, "body_id"),
        label: name,
        normal,
      }],
    });
    return this;
  }
  finish(name, r, z, type = "chamfer") {
    this.add(name, {
      type,
      radiusMillimeters: r,
      targetBodyId: ref(this.solid, "body_id"),
      edgePlane: { plane: "XY", offsetMillimeters: z },
    });
    return this;
  }
}
export const radial = (count, pitch, phase = 0) =>
  Array.from({ length: count }, (_, i) => [
    pitch * Math.cos(phase + (i * 2 * Math.PI) / count),
    pitch * Math.sin(phase + (i * 2 * Math.PI) / count),
  ]);
export const qx = (a) => [Math.sin(a / 2), 0, 0, Math.cos(a / 2)];
export const qy = (a) => [0, Math.sin(a / 2), 0, Math.cos(a / 2)];
export const qz = (a) => [0, 0, Math.sin(a / 2), Math.cos(a / 2)];
export function rotate(q, v) {
  const [x, y, z, w] = q,
    [a, b, c] = v,
    t = [2 * (y * c - z * b), 2 * (z * a - x * c), 2 * (x * b - y * a)];
  return [
    a + w * t[0] + y * t[2] - z * t[1],
    b + w * t[1] + z * t[0] - x * t[2],
    c + w * t[2] + x * t[1] - y * t[0],
  ];
}
export class Model {
  constructor(id, name, description) {
    Object.assign(this, {
      id,
      name,
      description,
      parts: [],
      instances: [],
      tags: [],
      joints: new Map(),
    });
  }
  part(...args) {
    const p = new Part(...args);
    this.parts.push(p);
    return p;
  }
  place(name, part, position = [0, 0, 0], rotation = [0, 0, 0, 1]) {
    this.instances.push({
      key: name,
      part: typeof part === "string" ? part : part.key,
      position_mm: position,
      rotation_xyzw: rotation,
      grounded: !this.instances.length,
    });
    return this;
  }
  mate(
    instance,
    kind = "fastened",
    parent = this.instances[0].key,
    axis = [0, 0, 1],
  ) {
    this.joints.set(instance, { kind, parent, axis });
    return this;
  }
  recipe(documents) {
    const anchor = this.instances[0];
    if (
      anchor.position_mm.some((x) => x !== 0) ||
      anchor.rotation_xyzw[3] !== 1
    )
      throw Error("Grounded base must use the assembly datum");
    const mates = this.instances.slice(1).map((i) => {
      const joint = this.joints.get(i.key) ?? {
        kind: "fastened",
        parent: anchor.key,
        axis: [0, 0, 1],
      };
      const parent = this.instances.find((p) => p.key === joint.parent);
      const inverse = [
        ...parent.rotation_xyzw.slice(0, 3).map((x) => -x),
        parent.rotation_xyzw[3],
      ];
      const xAxis = Math.abs(joint.axis[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
      return {
        key: `${joint.kind === "revolute" ? "Rotate" : joint.kind === "prismatic" ? "Slide" : "Mount"} ${i.key}`,
        kind: joint.kind,
        a: {
          instance: parent.key,
          origin_mm: rotate(
            inverse,
            i.position_mm.map((x, k) => x - parent.position_mm[k]),
          ),
          z_axis: rotate(inverse, rotate(i.rotation_xyzw, joint.axis)),
          x_axis: rotate(inverse, rotate(i.rotation_xyzw, xAxis)),
        },
        b: { instance: i.key, z_axis: joint.axis, x_axis: xAxis },
      };
    });
    return {
      version: 1,
      parts: this.parts.map((p) => ({
        key: p.key,
        name: p.name,
        document: documents[p.key],
      })),
      instances: this.instances,
      mates,
    };
  }
}
