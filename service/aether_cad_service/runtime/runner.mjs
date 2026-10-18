import { readFileSync } from "node:fs";
import { stdin, stdout } from "node:process";
function canonicalPlaneXDirection(normal) {
  const length = Math.hypot(...normal);
  if (!length) return [1, 0, 0];
  const n = normal.map((c) => c / length);
  const reference = Math.abs(n[0]) > 0.9 ? [0, 1, 0] : [1, 0, 0];
  const projection = reference.reduce((sum, c, i) => sum + c * n[i], 0);
  const x = reference.map((c, i) => c - projection * n[i]);
  const scale = Math.hypot(...x);
  return x.map((c) => {
    const v = c / scale;
    return v === 0 ? 0 : v;
  });
}
function principalFrame(plane2, offsetMillimeters = 0) {
  const n = plane2 === "XY" ? [0, 0, 1] : plane2 === "XZ" ? [0, -1, 0] : [1, 0, 0];
  return {
    originMillimeters: n.map((v) => v * offsetMillimeters),
    normal: n,
    xDirection: plane2 === "YZ" ? [0, 1, 0] : [1, 0, 0]
  };
}
function resolvePlaneFrame(feature, earlier = []) {
  const definition = feature.definition;
  if (!definition) return principalFrame(feature.plane, feature.offsetMillimeters);
  const frameOf = (reference) => {
    if (reference.kind === "principal") return principalFrame(reference.plane);
    if (reference.kind === "face") return reference.frame;
    const index = earlier.findIndex((f) => f.id === reference.featureId);
    const target = index >= 0 ? earlier[index] : void 0;
    if (!target || target.type !== "plane")
      throw new Error(`${feature.name}: plane references must be earlier construction planes.`);
    return resolvePlaneFrame(target, earlier.slice(0, index));
  };
  const maybeFlip = (frame) => definition.flip ? { ...frame, normal: frame.normal.map((v) => -v) } : frame;
  if (definition.method === "offset") {
    if (!Number.isFinite(definition.distanceMillimeters))
      throw new Error(`${feature.name}: offset distance must be finite.`);
    const base = frameOf(definition.reference);
    return maybeFlip({
      originMillimeters: base.originMillimeters.map(
        (v, i) => v + base.normal[i] * definition.distanceMillimeters
      ),
      normal: base.normal,
      xDirection: base.xDirection
    });
  }
  if (definition.method === "three-point") {
    const [p, q, r] = definition.points.map((point2) => point2.positionMillimeters);
    const u = q.map((v2, i) => v2 - p[i]);
    const v = r.map((value2, i) => value2 - p[i]);
    const normal = [
      u[1] * v[2] - u[2] * v[1],
      u[2] * v[0] - u[0] * v[2],
      u[0] * v[1] - u[1] * v[0]
    ];
    const length = Math.hypot(...normal);
    if (length < 1e-9)
      throw new Error(`${feature.name}: three point plane needs three non-collinear points.`);
    const unit = normal.map((c) => c / length);
    return maybeFlip({
      originMillimeters: p,
      normal: unit,
      // Canonical, so a three-point plane aligns like every other plane.
      xDirection: canonicalPlaneXDirection(unit)
    });
  }
  if (definition.method === "angle") {
    if (!Number.isFinite(definition.angleDegrees))
      throw new Error(`${feature.name}: plane angle must be finite.`);
    const axisLength = Math.hypot(...definition.axis.directionMillimeters);
    if (axisLength < 1e-9)
      throw new Error(`${feature.name}: the angle axis has no direction.`);
    const k = definition.axis.directionMillimeters.map((c) => c / axisLength);
    const base = frameOf(definition.reference);
    const theta = definition.angleDegrees * Math.PI / 180;
    const cos = Math.cos(theta);
    const sin = Math.sin(theta);
    const n = base.normal;
    const dot2 = k[0] * n[0] + k[1] * n[1] + k[2] * n[2];
    if (Math.abs(dot2) > 1e-7)
      throw new Error(`${feature.name}: the angle axis must be parallel to the reference plane.`);
    const cross2 = [
      k[1] * n[2] - k[2] * n[1],
      k[2] * n[0] - k[0] * n[2],
      k[0] * n[1] - k[1] * n[0]
    ];
    const rotated = n.map(
      (c, i) => c * cos + cross2[i] * sin + k[i] * dot2 * (1 - cos)
    );
    const length = Math.hypot(...rotated);
    if (length < 1e-9)
      throw new Error(`${feature.name}: the angle axis is parallel to the reference normal.`);
    const unit = rotated.map((c) => c / length);
    return maybeFlip({
      originMillimeters: definition.axis.originMillimeters,
      normal: unit,
      xDirection: canonicalPlaneXDirection(unit)
    });
  }
  const [a, b] = definition.references.map(frameOf);
  const alignment = a.normal[0] * b.normal[0] + a.normal[1] * b.normal[1] + a.normal[2] * b.normal[2];
  if (Math.abs(alignment) < 1 - 1e-6)
    throw new Error(`${feature.name}: mid plane needs two parallel planes.`);
  const gap = (b.originMillimeters[0] - a.originMillimeters[0]) * a.normal[0] + (b.originMillimeters[1] - a.originMillimeters[1]) * a.normal[1] + (b.originMillimeters[2] - a.originMillimeters[2]) * a.normal[2];
  return maybeFlip({
    originMillimeters: a.originMillimeters.map(
      (v, i) => v + a.normal[i] * gap / 2
    ),
    normal: a.normal,
    xDirection: a.xDirection
  });
}
function validatePlaneDefinition(feature, earlierPlaneIds, missingReference = () => false) {
  const definition = feature.definition;
  if (definition === void 0) return;
  const checkReference = (reference) => {
    if (reference.kind === "principal") {
      if (!["XY", "XZ", "YZ"].includes(reference.plane))
        throw new Error("Invalid principal plane reference.");
    } else if (reference.kind === "face") {
      const frame = reference.frame;
      const finite = (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite);
      if (typeof reference.partId !== "string" || !Number.isInteger(reference.faceId) || !frame || !finite(frame.originMillimeters) || !finite(frame.xDirection) || !finite(frame.normal))
        throw new Error("A face reference needs a part, a face and a captured frame.");
      if (!Math.hypot(...frame.normal))
        throw new Error("A face reference needs a non-degenerate normal.");
    } else if (reference.kind !== "feature" || typeof reference.featureId !== "string" || !missingReference(reference.featureId) && !earlierPlaneIds.has(reference.featureId))
      throw new Error("Plane references must point to earlier construction planes.");
  };
  if (definition.method === "three-point") {
    if (definition.points?.length !== 3)
      throw new Error("A three point plane needs exactly three points.");
    for (const point2 of definition.points)
      if (point2?.kind !== "point" || typeof point2.partId !== "string" || typeof point2.candidateId !== "string" || point2.positionMillimeters?.length !== 3 || !point2.positionMillimeters.every(Number.isFinite))
        throw new Error("A three point plane needs three picked points with positions.");
    return;
  }
  if (definition.method === "angle") {
    const axis = definition.axis;
    if (axis?.kind !== "axis" || typeof axis.partId !== "string" || typeof axis.candidateId !== "string" || axis.originMillimeters?.length !== 3 || axis.directionMillimeters?.length !== 3 || !axis.originMillimeters.every(Number.isFinite) || !axis.directionMillimeters.every(Number.isFinite))
      throw new Error("An angled plane needs a picked edge with an origin and direction.");
    if (!Number.isFinite(definition.angleDegrees))
      throw new Error("An angled plane needs a finite angle.");
    checkReference(definition.reference);
    return;
  }
  if (definition.method === "offset") {
    checkReference(definition.reference);
    if (!Number.isFinite(definition.distanceMillimeters))
      throw new Error("Plane offset distance must be finite.");
  } else if (definition.method === "mid") {
    if (!Array.isArray(definition.references) || definition.references.length !== 2)
      throw new Error("Mid plane needs exactly two references.");
    definition.references.forEach(checkReference);
  } else throw new Error("Unknown plane definition method.");
}
function validateProfileRegionSelection(selection) {
  const value2 = selection.profileRegion;
  if (value2 === void 0) return;
  if (!value2 || typeof value2 !== "object" || Array.isArray(value2) || Object.keys(value2).some((key) => key !== "contourIds") || !Array.isArray(value2.contourIds) || value2.contourIds.length < 2 || value2.contourIds.length > 1e3 || value2.contourIds.some((id2) => typeof id2 !== "string" || !id2.trim() || id2.length > 128) || new Set(value2.contourIds).size !== value2.contourIds.length || selection.profileContourId !== void 0) throw Error("A connected sketch region needs distinct source contour identities, without a single-contour reference.");
}
function profileRegionIdentity(selection) {
  return JSON.stringify(selection.profileRegion ? { contours: [...selection.profileRegion.contourIds].sort() } : selection.profileContourId ?? null);
}
function matchesProfileRegion(selection, candidate) {
  return selection.profileRegion ? !!candidate.sourceContourIds && profileRegionIdentity(selection) === profileRegionIdentity({ profileRegion: { contourIds: candidate.sourceContourIds } }) : selection.profileContourId !== void 0 ? candidate.contourId === selection.profileContourId : false;
}
function validateExtrusionScopeResolution(value2) {
  const ids = (v) => Array.isArray(v) && v.length <= 4096 && v.every((id2) => typeof id2 === "string" && !!id2.trim() && id2.length <= 512) && new Set(v).size === v.length;
  if (!value2 || !ids(value2.targets) || !value2.targets.length || !Array.isArray(value2.groups) || value2.groups.length > value2.targets.length) throw Error("Invalid automatic extrusion scope resolution.");
  const used = /* @__PURE__ */ new Set();
  for (const group of value2.groups) {
    if (!group || !ids(group.sources) || !group.sources.length || group.bodyId !== group.sources[0] || group.sources.some((id2) => !value2.targets.includes(id2) || used.has(id2))) throw Error("Invalid automatic extrusion scope group.");
    group.sources.forEach((id2) => used.add(id2));
  }
}
function scopeConsumedBodies(resolution) {
  return resolution?.targets.filter((id2) => !resolution.groups.some((group) => group.bodyId === id2)) ?? [];
}
function validatePlanarFaceAnchor(anchor) {
  if (anchor === void 0) return;
  if (!anchor || !Array.isArray(anchor.centerMillimeters) || anchor.centerMillimeters.length !== 3 || !anchor.centerMillimeters.every(Number.isFinite) || !Number.isFinite(anchor.areaSquareMillimeters) || anchor.areaSquareMillimeters <= 0)
    throw Error("Invalid planar face anchor. Reselect the face.");
}
function validateExtrusionStartReference(ref, earlier, missing) {
  const fail = () => {
    throw Error("Starting entity needs an earlier parallel face or reference plane.");
  };
  if (!ref || !["face", "plane", "principal"].includes(ref.kind) || typeof ref.label !== "string" || !ref.label.trim() || ref.label.length > 512) return fail();
  if (ref.kind === "principal") {
    if (!["XY", "XZ", "YZ"].includes(ref.plane)) fail();
    return;
  }
  if (typeof ref.sourceFeatureId !== "string" || !ref.sourceFeatureId.trim() || ref.sourceFeatureId.length > 128) return fail();
  const type = earlier.get(ref.sourceFeatureId);
  if (!missing(ref.sourceFeatureId) && (!type || (ref.kind === "plane" ? type !== "plane" : ["profile", "sketch", "plane"].includes(type)))) return fail();
  if (ref.kind === "face") {
    validatePlanarFaceAnchor(ref.faceAnchor);
    if (typeof ref.bodyId !== "string" || !ref.bodyId.trim() || ref.bodyId.length > 256 || !Array.isArray(ref.normal) || ref.normal.length !== 3 || !ref.normal.every(Number.isFinite) || Math.abs(Math.hypot(...ref.normal) - 1) > 1e-6) fail();
  }
}
function validateExtrusionPointReference(ref, earlier, missing) {
  const id2 = (v, max = 128) => typeof v === "string" && !!v.trim() && v.length <= max;
  if (!ref || !id2(ref.sourceFeatureId) || !id2(ref.label, 512) || !earlier.has(ref.sourceFeatureId) && !missing(ref.sourceFeatureId))
    throw Error("Up to vertex needs a point in earlier history.");
  if (ref.kind === "sketch-point") {
    if (!missing(ref.sourceFeatureId) && earlier.get(ref.sourceFeatureId) !== "profile" || !id2(ref.contourId) || !["vertex", "center"].includes(ref.point) || (ref.point === "vertex" ? !id2(ref.vertexId) : ref.vertexId !== void 0))
      throw Error("Invalid stopping sketch point reference.");
  } else if (ref.kind === "solid-vertex") {
    const a = ref.anchor;
    if (!id2(ref.bodyId, 256) || ["profile", "sketch", "plane"].includes(earlier.get(ref.sourceFeatureId) ?? "") || !a || !Array.isArray(a.positionMillimeters) || a.positionMillimeters.length !== 3 || !a.positionMillimeters.every(Number.isFinite) || !id2(a.signature, 16384) || !id2(a.incidence, 16384) || typeof a.shapeFingerprint !== "string" || !/^[a-f0-9]{64}$/.test(a.shapeFingerprint))
      throw Error("Invalid stopping solid vertex anchor.");
  } else throw Error("Unsupported stopping point reference.");
}
const current = 21;
const readable = [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21];
const partFormat = {
  current,
  readable
};
function validateImageCanvases(value2) {
  if (value2 === void 0) return;
  if (!Array.isArray(value2) || value2.length > 32) throw Error("A Part may contain at most 32 image canvases.");
  const ids = /* @__PURE__ */ new Set();
  for (const item of value2) {
    if (!item || typeof item.id !== "string" || !item.id || ids.has(item.id) || typeof item.name !== "string" || !item.name.trim() || item.name.length > 255) throw Error("Invalid image canvas identity.");
    ids.add(item.id);
    if (item.face) {
      const face = item.face, vec = (v) => Array.isArray(v) && v.length === 3 && v.every((n) => typeof n === "number" && Number.isFinite(n));
      if (typeof face.bodyId !== "string" || !face.bodyId || !vec(face.normal) || Math.abs(Math.hypot(...face.normal) - 1) > 1e-6) throw Error("Invalid decal face reference.");
      if (face.anchor && (!vec(face.anchor.centerMillimeters) || !Number.isFinite(face.anchor.areaSquareMillimeters) || face.anchor.areaSquareMillimeters <= 0)) throw Error("Invalid decal face anchor.");
    }
    if (typeof item.dataUrl !== "string" || item.dataUrl.length > 3 * 1024 * 1024 || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+={0,2}$/.test(item.dataUrl)) throw Error("Canvas must contain an embedded PNG, JPEG or WebP image.");
    if (!["XY", "XZ", "YZ"].includes(item.plane) || typeof item.visible !== "boolean") throw Error("Invalid canvas plane or visibility.");
    for (const key of ["widthMillimeters", "heightMillimeters", "xMillimeters", "yMillimeters", "offsetMillimeters", "rotationDegrees", "opacity"]) if (typeof item[key] !== "number" || !Number.isFinite(item[key])) throw Error("Canvas dimensions must be finite.");
    if (item.widthMillimeters <= 0 || item.heightMillimeters <= 0 || item.opacity < 0 || item.opacity > 1) throw Error("Canvas dimensions must be positive and opacity between 0 and 1.");
  }
}
function validateSolidEdgeReference(ref, earlier, missing) {
  if (!ref.anchor) throw Error("Select a straight solid edge with valid endpoint anchors.");
  for (const anchor of [ref.anchor.start, ref.anchor.end]) validateExtrusionPointReference({ ...ref, kind: "solid-vertex", anchor }, earlier, missing);
  if (ref.anchor.start.shapeFingerprint !== ref.anchor.end.shapeFingerprint || Math.hypot(...ref.anchor.start.positionMillimeters.map((v, i) => v - ref.anchor.end.positionMillimeters[i])) < 1e-9) throw Error("Solid edge endpoints must be distinct and come from the same source shape.");
}
function transformReferences(t) {
  if (t.kind === "scale-reference") return [t.centerReference];
  if (t.kind === "translate-reference" || t.kind === "rotate-reference") return t.reference?.kind === "two-points" ? [t.reference.from, t.reference.to] : [t.reference];
  return [];
}
const id = (value2) => typeof value2 === "string" && !!value2.trim() && value2.length <= 256;
const vector = (value2) => Array.isArray(value2) && value2.length === 3 && value2.every(Number.isFinite);
function validateTransform(feature, earlier = /* @__PURE__ */ new Map(), missing = () => false) {
  const ids = feature.bodyIds, t = feature.transform, copies = feature.copyBodyIds;
  if (!Array.isArray(ids) || !ids.length || ids.length > 256 || !ids.every(id) || new Set(ids).size !== ids.length) throw Error("Choose distinct solid parts to transform (up to 256).");
  if ("targetBodyId" in feature || "targetBodyIds" in feature) throw Error("Transform target parts are defined by bodyIds.");
  if (copies !== void 0) {
    if (!copies || typeof copies !== "object" || Array.isArray(copies) || Object.keys(copies).length !== ids.length || ids.some((key) => !Object.hasOwn(copies, key) || !id(copies[key])) || new Set(Object.values(copies)).size !== ids.length || Object.values(copies).some((key) => ids.includes(key))) throw Error("Each copied part needs a distinct new output identity.");
  }
  if (!t || typeof t !== "object" || Array.isArray(t)) throw Error("Choose a valid part transform.");
  for (const ref of transformReferences(t)) {
    if (ref?.kind === "sketch-line") {
      if (![ref.sourceFeatureId, ref.contourId, ref.segmentId].every((v) => id(v) && v.length <= 128) || !missing(ref.sourceFeatureId) && earlier.get(ref.sourceFeatureId) !== "profile") throw Error("Transform needs a straight line in an earlier sketch.");
    } else if (ref?.kind === "solid-edge") validateSolidEdgeReference(ref, earlier, missing);
    else validateExtrusionPointReference(ref, earlier, missing);
  }
  if (t.kind === "translate-reference") {
    if (t.distanceMillimeters !== void 0 && !Number.isFinite(t.distanceMillimeters)) throw Error("Translation distance must be finite.");
    if (t.reversed !== void 0 && typeof t.reversed !== "boolean") throw Error("Invalid transform direction.");
  } else if (t.kind === "rotate-reference") {
    if (!Number.isFinite(t.angleDegrees)) throw Error("Rotation angle must be finite.");
  } else if (t.kind === "scale-reference") {
    if (!vector(t.scaleFactors) || t.scaleFactors.some((v) => v <= 0) || !Number.isFinite(t.scaleFactors.reduce((a, b) => a * b, 1)) || t.scaleFactors.reduce((a, b) => a * b, 1) <= 0) throw Error("Scale needs positive factors within the supported numeric range.");
  } else if (t.kind === "translate") {
    if (!vector(t.translationMillimeters)) throw Error("Translation needs finite X, Y and Z distances.");
  } else if (t.kind === "rotate") {
    if (!vector(t.axisOriginMillimeters) || !vector(t.axisDirection) || Math.abs(Math.hypot(...t.axisDirection) - 1) > 1e-6 || !Number.isFinite(t.angleDegrees)) throw Error("Rotation needs a finite origin, unit axis and angle.");
  } else if (t.kind === "scale") {
    if (!vector(t.centerMillimeters) || !vector(t.scaleFactors) || t.scaleFactors.some((v) => v <= 0) || !Number.isFinite(t.scaleFactors.reduce((a, b) => a * b, 1)) || t.scaleFactors.reduce((a, b) => a * b, 1) <= 0) throw Error("Scale needs a finite center and positive factors within the supported numeric range.");
  } else if (t.kind === "copy") {
    if (!copies) throw Error("Copy in place needs new body identities.");
  } else throw Error("Choose Translate, Rotate, Scale or Copy in place.");
}
const curvedSurfaceTypes = ["cylinder", "cone", "sphere", "torus", "bspline", "bezier", "extrusion", "revolution"];
function validateSolidFaceReference(ref, earlier, missing, label = "Face selection") {
  if (!ref || typeof ref !== "object" || Array.isArray(ref)) throw Error(`${label} needs an earlier solid face reference.`);
  const id2 = (value2, max = 256) => typeof value2 === "string" && !!value2.trim() && value2.length <= max;
  if (!id2(ref.sourceFeatureId) || !earlier.has(ref.sourceFeatureId) && !missing(ref.sourceFeatureId) || ["profile", "sketch", "plane"].includes(earlier.get(ref.sourceFeatureId) ?? "") || !id2(ref.bodyId) || !id2(ref.label, 512))
    throw Error(`${label} needs an earlier solid face reference.`);
  validatePlanarFaceAnchor(ref.faceAnchor);
  if (ref.surfaceType !== void 0) {
    if (!curvedSurfaceTypes.includes(ref.surfaceType) || ref.normal !== void 0) throw Error(`${label} has an invalid curved surface reference.`);
  } else if (!Array.isArray(ref.normal) || ref.normal.length !== 3 || !ref.normal.every(Number.isFinite) || Math.abs(Math.hypot(...ref.normal) - 1) > 1e-6) {
    throw Error(`${label} needs a unit planar normal or a curved surface reference.`);
  }
}
function offsetFaceBodies(feature) {
  return [...new Set(feature.faces.map((face) => face.bodyId))];
}
function validateOffsetFace(feature, earlier, missing) {
  if (!Array.isArray(feature.faces) || !feature.faces.length || feature.faces.length > 256) throw Error("Choose one or more faces to offset (up to 256).");
  if (feature.transform !== void 0) {
    if (feature.distanceMillimeters !== void 0 || !["translate", "translate-reference", "rotate", "rotate-reference"].includes(feature.transform?.kind)) throw Error("Choose an offset distance or a face Translate/Rotate operation.");
    validateTransform({ id: feature.id, type: "transform", name: feature.name, suppressed: feature.suppressed, bodyIds: offsetFaceBodies(feature), transform: feature.transform }, earlier, missing);
  } else if (typeof feature.distanceMillimeters !== "number" || !Number.isFinite(feature.distanceMillimeters) || Math.abs(feature.distanceMillimeters) < 1e-6) throw Error("Offset distance must be finite and nonzero.");
  if ("targetBodyId" in feature || "targetBodyIds" in feature) throw Error("Offset target parts are determined by the selected faces.");
  const identities = /* @__PURE__ */ new Set();
  for (const face of feature.faces) {
    validateSolidFaceReference(face, earlier, missing, "Offset faces");
    const id2 = JSON.stringify([face.sourceFeatureId, face.bodyId, face.normal, face.surfaceType, face.faceAnchor?.centerMillimeters, face.faceAnchor?.areaSquareMillimeters]);
    if (identities.has(id2)) throw Error("Select each offset face only once.");
    identities.add(id2);
  }
}
function quantity(magnitudeSI, lengthPower = 0, anglePower = 0) {
  if (![magnitudeSI, lengthPower, anglePower].every(Number.isFinite))
    throw Error("Calculation must produce finite values.");
  return { magnitudeSI, lengthPower, anglePower };
}
function numeric(value2) {
  if (typeof value2 === "string")
    throw Error("This operation requires a quantity, not text.");
  return value2;
}
const sameUnits = (a, b) => Math.abs(a.lengthPower - b.lengthPower) < 1e-12 && Math.abs(a.anglePower - b.anglePower) < 1e-12;
function scalar(value2) {
  const q = numeric(value2);
  if (!sameUnits(q, quantity(0)))
    throw Error("This operation requires a dimensionless number.");
  return q.magnitudeSI;
}
function expressionText(value2) {
  return typeof value2 === "string" ? value2 : String(scalar(value2));
}
const expressionUnits = Object.freeze({
  mm: quantity(1e-3, 1),
  cm: quantity(0.01, 1),
  m: quantity(1, 1),
  in: quantity(0.0254, 1),
  ft: quantity(0.3048, 1),
  deg: quantity(Math.PI / 180, 0, 1),
  rad: quantity(1, 0, 1)
});
function parseExpression(source) {
  if (typeof source !== "string" || !source.trim() || source.length > 4096)
    throw Error("Enter an expression of at most 4096 characters.");
  let position = 0, depth = 0, nodes = 0;
  const node = (value2) => {
    if (++nodes > 1024) throw Error("Expression is too complex.");
    return value2;
  };
  const skip = () => {
    while (position < source.length && /\s/.test(source[position])) position++;
  };
  const take = (token) => {
    skip();
    if (source.startsWith(token, position)) {
      position += token.length;
      return true;
    }
    return false;
  };
  const error = () => Error(`Invalid expression near character ${position + 1}.`);
  const identifier = () => {
    skip();
    const match = /^[A-Za-z_][A-Za-z0-9_]*/.exec(source.slice(position));
    if (!match) throw error();
    position += match[0].length;
    return match[0];
  };
  const primary = () => {
    if (take("(")) {
      const result2 = concat();
      if (!take(")")) throw error();
      return result2;
    }
    if (take("#")) return node({ kind: "variable", name: identifier() });
    skip();
    if (source[position] === '"') {
      const match2 = /^"(?:[^"\\\u0000-\u001f]|\\(?:["\\/bfnrt]|u[0-9a-fA-F]{4}))*"/.exec(
        source.slice(position)
      );
      if (!match2) throw error();
      position += match2[0].length;
      return node({ kind: "text", value: JSON.parse(match2[0]) });
    }
    const match = /^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/.exec(
      source.slice(position)
    );
    if (match) {
      position += match[0].length;
      return node({ kind: "number", value: Number(match[0]) });
    }
    if (take("π")) return node({ kind: "symbol", name: "pi" });
    const name = identifier();
    if (!take("(")) return node({ kind: "symbol", name });
    const args = [];
    if (!take(")")) {
      do {
        args.push(concat());
        if (args.length > 32) throw error();
      } while (take(","));
      if (!take(")")) throw error();
    }
    return node({ kind: "call", name, arguments: args });
  };
  const unary = () => {
    if (++depth > 64) throw Error("Calculation is nested too deeply.");
    try {
      if (take("+")) return unary();
      if (take("-") || take("−"))
        return node({ kind: "unary", negative: true, value: unary() });
      const left = primary();
      return take("^") ? node({ kind: "binary", operator: "^", left, right: unary() }) : left;
    } finally {
      depth--;
    }
  };
  const product = () => {
    let left = unary();
    for (; ; ) {
      if (take("*"))
        left = node({ kind: "binary", operator: "*", left, right: unary() });
      else if (take("/"))
        left = node({ kind: "binary", operator: "/", left, right: unary() });
      else {
        skip();
        const symbol = /^[A-Za-z_][A-Za-z0-9_]*/.exec(
          source.slice(position)
        )?.[0];
        if (symbol && Object.hasOwn(expressionUnits, symbol))
          left = node({ kind: "binary", operator: "*", left, right: unary() });
        else return left;
      }
    }
  };
  const sum = () => {
    let left = product();
    for (; ; ) {
      if (take("+"))
        left = node({ kind: "binary", operator: "+", left, right: product() });
      else if (take("-") || take("−"))
        left = node({ kind: "binary", operator: "-", left, right: product() });
      else return left;
    }
  };
  const concat = () => {
    let left = sum();
    while (take("~"))
      left = node({ kind: "binary", operator: "~", left, right: sum() });
    return left;
  };
  const result = concat();
  skip();
  if (position !== source.length) throw error();
  return result;
}
function textFrameHeight(item) {
  const ratio = item.fontAscenderRatio ?? 1;
  if (!Number.isFinite(ratio) || ratio <= 0 || !Number.isFinite(item.emSizeMillimeters) || item.emSizeMillimeters <= 0)
    throw Error("Text height and font ascender must be positive.");
  return item.emSizeMillimeters * ratio;
}
function textPlacementTransform(options, scale = 1) {
  const origin = options.originMillimeters ?? [0, 0], rotation = options.rotationDegrees ?? 0;
  if (!Array.isArray(origin) || origin.length !== 2 || !origin.every(Number.isFinite) || !Number.isFinite(rotation) || !Number.isFinite(scale) || scale <= 0)
    throw Error("Text placement must be finite with positive scale.");
  for (const flip of [
    options.flipHorizontal,
    options.flipVertical,
    options.flipAboutFrame,
    options.placementReflected
  ])
    if (flip !== void 0 && typeof flip !== "boolean")
      throw Error("Text flip settings must be boolean.");
  if (options.fontAscenderRatio !== void 0 && (!Number.isFinite(options.fontAscenderRatio) || options.fontAscenderRatio <= 0))
    throw Error("Font ascender ratio must be positive.");
  if (options.flipAboutFrame && ![options.frameWidthMillimeters, options.emSizeMillimeters].every(
    (v) => typeof v === "number" && Number.isFinite(v) && v > 0
  ))
    throw Error("Frame-centered text needs a positive frame width and height.");
  const angle2 = rotation * Math.PI / 180, cosine = Math.cos(angle2), sine = Math.sin(angle2), x = (options.flipHorizontal ? -1 : 1) * scale, handedness = options.placementReflected ? -1 : 1, y = (options.flipVertical ? -1 : 1) * scale * handedness, shiftX = options.flipAboutFrame && options.flipHorizontal ? options.frameWidthMillimeters : 0, shiftY = options.flipAboutFrame && options.flipVertical ? textFrameHeight({
    emSizeMillimeters: options.emSizeMillimeters,
    fontAscenderRatio: options.fontAscenderRatio
  }) : 0;
  return {
    a: cosine * x,
    b: -sine * y,
    c: sine * x,
    d: cosine * y,
    tx: origin[0] + cosine * shiftX - sine * shiftY * handedness,
    ty: origin[1] + sine * shiftX + cosine * shiftY * handedness
  };
}
function textFramePlacement(options) {
  return textPlacementTransform(
    options.flipAboutFrame ? {
      ...options,
      flipAboutFrame: false,
      flipHorizontal: false,
      flipVertical: false
    } : options
  );
}
function normalizeSketchText(value2) {
  if (typeof value2 !== "string" || !value2.trim() || value2.length > 1e3)
    throw Error("Enter nonempty sketch text, up to 1000 characters.");
  if (/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f]/.test(value2))
    throw Error("Sketch text cannot contain tabs or control characters.");
  return value2.replace(/\r\n?/g, "\n");
}
function validateTextItems(drawing) {
  if (drawing.textItems === void 0) return;
  if (!Array.isArray(drawing.textItems) || drawing.textItems.length > 100)
    throw Error("A sketch supports at most 100 retained text items.");
  const ids = /* @__PURE__ */ new Set(), contours = /* @__PURE__ */ new Set();
  let fontSize = 0;
  for (const item of drawing.textItems) {
    if (!item || typeof item.id !== "string" || !item.id.trim() || item.id.length > 128 || ids.has(item.id))
      throw Error("Text item identities must be unique nonempty strings.");
    ids.add(item.id);
    textPlacementTransform(item);
    normalizeSketchText(item.text);
    if (item.expression !== void 0) parseExpression(item.expression);
    if (typeof item.fontBase64 !== "string" || !item.fontBase64.length || item.fontBase64.length > 44739244 || item.fontBase64.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/.test(item.fontBase64))
      throw Error("Invalid retained font data.");
    fontSize += item.fontBase64.length;
    if (fontSize > 89478488)
      throw Error("Retained fonts exceed the sketch's 64 MB font budget.");
    if (!Number.isFinite(item.emSizeMillimeters) || item.emSizeMillimeters <= 0 || !Number.isFinite(item.rotationDegrees) || !Array.isArray(item.originMillimeters) || item.originMillimeters.length !== 2 || !item.originMillimeters.every(Number.isFinite))
      throw Error("Invalid retained text size or placement.");
    if (!Array.isArray(item.contourIds) || !item.contourIds.length || item.contourIds.length > 1e3)
      throw Error("Retained text needs generated contour identities.");
    if ((item.frameContourId !== void 0 || item.frameWidthMillimeters !== void 0) && (typeof item.frameContourId !== "string" || !item.contourIds.includes(item.frameContourId) || !Number.isFinite(item.frameWidthMillimeters) || item.frameWidthMillimeters <= 0))
      throw Error("Text frames require an owned contour and a positive width.");
    for (const id2 of item.contourIds) {
      if (typeof id2 !== "string" || !id2.trim() || id2.length > 128 || contours.has(id2))
        throw Error(
          "Text contour identities must be unique across text items."
        );
      contours.add(id2);
    }
    if (typeof item.outlineDigest !== "string" || !/^[a-f0-9]{64}$/.test(item.outlineDigest))
      throw Error("Invalid retained text outline digest.");
  }
}
function point(value2) {
  if (!Array.isArray(value2) || value2.length !== 2 || !value2.every((v) => typeof v === "number" && Number.isFinite(v)))
    throw Error("Conic points must contain two finite coordinates.");
}
function validateConic(start, segment) {
  point(start);
  if (!segment || segment.type !== "conic") throw Error("Expected a conic segment.");
  point(segment.end);
  point(segment.control);
  if (!Number.isFinite(segment.rho) || segment.rho <= 0 || segment.rho >= 1)
    throw Error("Conic rho must be greater than 0 and less than 1.");
  const a = [segment.control[0] - start[0], segment.control[1] - start[1]], b = [segment.end[0] - start[0], segment.end[1] - start[1]], la = Math.hypot(...a), lb = Math.hypot(...b);
  if (!Number.isFinite(la) || !Number.isFinite(lb) || la < 1e-9 || lb < 1e-9 || Math.abs(a[0] / la * (b[1] / lb) - a[1] / la * (b[0] / lb)) < 1e-12)
    throw Error("Conic endpoints and control must be distinct and noncollinear.");
}
function parameter(t) {
  if (!Number.isFinite(t) || t < 0 || t > 1)
    throw Error("Conic parameter must be between 0 and 1.");
}
function evaluate(start, s, t) {
  validateConic(start, s);
  parameter(t);
  const u = 1 - t, r = s.rho, v = 1 - r, d = v * (u * u + t * t) + 2 * r * u * t, dp = 2 * (2 * r - 1) * (1 - 2 * t), dd = 4 * (1 - 2 * r);
  const position = [0, 0], first = [0, 0], second = [0, 0];
  for (const i of [0, 1]) {
    const c = s.control[i] - start[i], e = s.end[i] - start[i], n = 2 * r * u * t * c + v * t * t * e, np = 2 * r * (1 - 2 * t) * c + 2 * v * t * e, npp = -4 * r * c + 2 * v * e, p = n / d;
    position[i] = start[i] + p;
    first[i] = (np - p * dp) / d;
    second[i] = (npp - p * dd - 2 * first[i] * dp) / d;
  }
  if (t === 0) position.splice(0, 2, ...start);
  if (t === 1) position.splice(0, 2, ...s.end);
  return { position, first, second };
}
const conicPoint = (start, segment, t) => evaluate(start, segment, t).position;
const conicDerivative = (start, segment, t) => evaluate(start, segment, t).first;
const conicSecondDerivative = (start, segment, t) => evaluate(start, segment, t).second;
function roots(a, b, c) {
  const scale = Math.max(Math.abs(a), Math.abs(b), Math.abs(c));
  if (!scale) return [];
  a /= scale;
  b /= scale;
  c /= scale;
  if (a === 0) return b === 0 ? [] : [-c / b];
  const disc = b * b - 4 * a * c;
  if (disc < 0) return [];
  if (disc === 0) return [-b / (2 * a)];
  const q = -0.5 * (b + (b < 0 ? -1 : 1) * Math.sqrt(disc));
  return [q / a, c / q];
}
function stationary(start, s) {
  const r = s.rho, d0 = 1 - r, d1 = 2 * (2 * r - 1), d2 = -d1;
  const candidates = [];
  for (const i of [0, 1]) {
    const n1 = 2 * r * (s.control[i] - start[i]), n2 = d0 * (s.end[i] - start[i]) - n1;
    for (const t of roots(n2 * d1 - n1 * d2, 2 * n2 * d0, n1 * d0))
      if (t > 0 && t < 1) candidates.push(t);
  }
  return candidates;
}
function projectConic(start, s, map, collapsed) {
  validateConic(start, s);
  const a = map(start), next = { ...s, control: map(s.control), end: map(s.end) };
  if (!collapsed) return [next];
  const ts = [0, ...stationary(a, next), 1].sort((x, y) => x - y), points = ts.map((t) => map(conicPoint(start, s, t)));
  return points.slice(1).flatMap((end, i) => Math.hypot(end[0] - points[i][0], end[1] - points[i][1]) < 1e-9 ? [] : [{ type: "line", end }]);
}
function blend(a, b, t) {
  return [a[0] * (1 - t) + b[0] * t, a[1] * (1 - t) + b[1] * t, a[2] * (1 - t) + b[2] * t];
}
function splitConic(start, s, t) {
  validateConic(start, s);
  if (!Number.isFinite(t) || t <= 0 || t >= 1) throw Error("Split inside the conic, away from its endpoints.");
  const v = 1 - s.rho, a = [0, 0, v], b = [(s.control[0] - start[0]) * s.rho, (s.control[1] - start[1]) * s.rho, s.rho], c = [(s.end[0] - start[0]) * v, (s.end[1] - start[1]) * v, v], ab = blend(a, b, t), bc = blend(b, c, t), middle = blend(ab, bc, t);
  const cartesian = (p) => [start[0] + p[0] / p[2], start[1] + p[1] / p[2]];
  const span = (p0, p1, p2) => {
    const weight = p1[2] / Math.sqrt(p0[2] * p2[2]);
    return { start: cartesian(p0), segment: { type: "conic", control: cartesian(p1), end: cartesian(p2), rho: s.rho === 0.5 ? 0.5 : weight / (1 + weight) } };
  };
  const left = span(a, ab, middle), right = span(middle, bc, c);
  left.start = [...start];
  right.segment.end = [...s.end];
  return [left, right];
}
function transformPoint(p, t) {
  return [t.a * p[0] + t.b * p[1] + t.tx, t.c * p[0] + t.d * p[1] + t.ty];
}
function transformContour(source, t) {
  const scale = Math.hypot(t.a, t.c), det = t.a * t.d - t.b * t.c;
  if (!Object.values(t).every(Number.isFinite) || scale < 1e-10 || Math.abs(Math.hypot(t.b, t.d) - scale) > 1e-8 || Math.abs(t.a * t.b + t.c * t.d) > 1e-8)
    throw new Error(
      "Sketch transforms require a finite, uniform, nonzero scale."
    );
  const contour = structuredClone(source);
  if (contour.type === "circle") {
    contour.center = transformPoint(contour.center, t);
    contour.radius *= scale;
  } else {
    contour.start = transformPoint(contour.start, t);
    for (const segment of contour.segments) {
      segment.end = transformPoint(segment.end, t);
      if (segment.type === "conic") segment.control = transformPoint(segment.control, t);
      if (segment.type === "arc")
        segment.middle = transformPoint(segment.middle, t);
      if (segment.type === "bezier")
        segment.controls = segment.controls.map(
          (p) => transformPoint(p, t)
        );
      if (segment.type === "ellipse") {
        const angle2 = segment.rotationDegrees * Math.PI / 180, x = Math.cos(angle2), y = Math.sin(angle2);
        segment.rotationDegrees = Math.atan2(t.c * x + t.d * y, t.a * x + t.b * y) * 180 / Math.PI;
        segment.radiusX *= scale;
        segment.radiusY *= scale;
        if (det < 0) segment.sweep = !segment.sweep;
      }
    }
  }
  return contour;
}
function similarityTransform(origin, translation, angleDegrees, scale = 1) {
  if (![...origin, ...translation, angleDegrees, scale].every(Number.isFinite) || scale <= 0)
    throw new Error("Enter finite coordinates and a positive scale.");
  const angle2 = angleDegrees * Math.PI / 180, a = scale * Math.cos(angle2), b = -scale * Math.sin(angle2), c = -b, d = a;
  return {
    a,
    b,
    c,
    d,
    tx: origin[0] + translation[0] - a * origin[0] - b * origin[1],
    ty: origin[1] + translation[1] - c * origin[0] - d * origin[1]
  };
}
function patternInstanceCount(group) {
  const count = (n) => {
    if (!Number.isInteger(n) || n < 1 || n > 100)
      throw Error("Pattern counts must be integers from 1 to 100.");
  };
  const point2 = (p) => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))
      throw Error("Pattern coordinates must be finite.");
  };
  if (group.kind === "linear") {
    count(group.countFirst);
    count(group.countSecond);
    point2(group.first);
    point2(group.second);
    if (group.countFirst * group.countSecond < 2 || group.countFirst > 1 && Math.hypot(...group.first) < 1e-8 || group.countSecond > 1 && Math.hypot(...group.second) < 1e-8)
      throw Error(
        "A pattern needs at least two instances with nonzero spacing."
      );
    return group.countFirst * group.countSecond;
  }
  if (group.kind !== "circular") throw Error("Invalid pattern group kind.");
  count(group.count);
  point2(group.center);
  if (group.count < 2 || !Number.isFinite(group.stepDegrees) || Math.abs(group.stepDegrees % 360) < 1e-8)
    throw Error("Use at least two instances and a nonzero angular step.");
  return group.count;
}
function patternInstanceTransform(group, instance) {
  const count = patternInstanceCount(group);
  if (!Number.isInteger(instance) || instance < 1 || instance >= count)
    throw Error("Pattern instance index is out of range.");
  if (group.kind === "circular")
    return similarityTransform(
      group.center,
      [0, 0],
      instance * group.stepDegrees
    );
  const i = instance % group.countFirst, j = Math.floor(instance / group.countFirst);
  return similarityTransform(
    [0, 0],
    [
      i * group.first[0] + j * group.second[0],
      i * group.first[1] + j * group.second[1]
    ],
    0
  );
}
function patternRelationTransform(d, c) {
  if (c.patternGroup !== void 0) {
    if (c.transform || c.axis)
      throw Error(
        "Grouped patterns cannot also contain a fixed transform or mirror axis."
      );
    const group = d.patternGroups?.[c.patternGroup];
    if (!group) throw Error("Missing pattern group.");
    return patternInstanceTransform(group, c.patternInstance);
  }
  return c.transform;
}
function validatePatternGroups(d) {
  if (d.patternGroups === void 0) return;
  if (!d.patternGroups || typeof d.patternGroups !== "object" || Array.isArray(d.patternGroups))
    throw Error("Invalid pattern groups.");
  for (const [id2, group] of Object.entries(d.patternGroups)) {
    if (!id2.trim() || id2.length > 128)
      throw Error("Invalid pattern group identity.");
    patternInstanceCount(group);
  }
}
function sketchArcGeometry(start, middle, end) {
  const u = [middle[0] - start[0], middle[1] - start[1]], v = [end[0] - start[0], end[1] - start[1]];
  const det = 2 * (u[0] * v[1] - u[1] * v[0]);
  if (Math.abs(det) < 1e-12)
    throw new Error("Arc points must not be collinear.");
  const a = u[0] ** 2 + u[1] ** 2, b = v[0] ** 2 + v[1] ** 2;
  const center = [
    start[0] + (a * v[1] - b * u[1]) / det,
    start[1] + (u[0] * b - v[0] * a) / det
  ];
  const radius = Math.hypot(start[0] - center[0], start[1] - center[1]);
  const angle2 = (p) => Math.atan2(p[1] - center[1], p[0] - center[0]), tau2 = 2 * Math.PI;
  const delta2 = (a2, b2) => (b2 - a2 + tau2) % tau2;
  const startAngle = angle2(start), endAngle = angle2(end), counterclockwise = delta2(startAngle, angle2(middle)) < delta2(startAngle, endAngle);
  const sweep = counterclockwise ? delta2(startAngle, endAngle) : -delta2(endAngle, startAngle);
  const midpoint = [
    center[0] + radius * Math.cos(startAngle + sweep / 2),
    center[1] + radius * Math.sin(startAngle + sweep / 2)
  ];
  return { center, radius, midpoint, startAngle, sweep };
}
const tau$1 = 2 * Math.PI;
const angleBetween = (u, v) => Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]);
function ellipseFrame(start, segment) {
  const rotation = segment.rotationDegrees * Math.PI / 180, cos = Math.cos(rotation), sin = Math.sin(rotation);
  let rx = Math.abs(segment.radiusX), ry = Math.abs(segment.radiusY);
  const dx = (start[0] - segment.end[0]) / 2, dy = (start[1] - segment.end[1]) / 2;
  const x = cos * dx + sin * dy, y = -sin * dx + cos * dy;
  if (rx <= 0 || ry <= 0 || Math.hypot(dx, dy) < 1e-12)
    throw new Error("Ellipse needs positive radii and distinct endpoints.");
  const correction = x * x / (rx * rx) + y * y / (ry * ry);
  if (correction > 1) {
    const scale = Math.sqrt(correction);
    rx *= scale;
    ry *= scale;
  }
  const denominator = rx * rx * y * y + ry * ry * x * x;
  const factor = (segment.largeArc === segment.sweep ? -1 : 1) * Math.sqrt(Math.max(0, (rx * rx * ry * ry - denominator) / denominator));
  const cx = factor * rx * y / ry, cy = -factor * ry * x / rx;
  const center = [
    cos * cx - sin * cy + (start[0] + segment.end[0]) / 2,
    sin * cx + cos * cy + (start[1] + segment.end[1]) / 2
  ];
  const u = [(x - cx) / rx, (y - cy) / ry], v = [(-x - cx) / rx, (-y - cy) / ry];
  let sweep = angleBetween(u, v);
  if (!segment.sweep && sweep > 0) sweep -= tau$1;
  if (segment.sweep && sweep < 0) sweep += tau$1;
  return {
    center,
    radiusX: rx,
    radiusY: ry,
    rotation,
    startAngle: Math.atan2(u[1], u[0]),
    sweep
  };
}
function ellipsePoint(frame, parameter2) {
  const angle2 = frame.startAngle + parameter2 * frame.sweep, x = frame.radiusX * Math.cos(angle2), y = frame.radiusY * Math.sin(angle2), cos = Math.cos(frame.rotation), sin = Math.sin(frame.rotation);
  return [
    frame.center[0] + cos * x - sin * y,
    frame.center[1] + sin * x + cos * y
  ];
}
function segmentPoint(start, segment, t) {
  if (!Number.isFinite(t)) throw new Error("Curve parameter must be finite.");
  if (segment.type === "conic") return conicPoint(start, segment, t);
  if (segment.type === "line")
    return [
      start[0] + t * (segment.end[0] - start[0]),
      start[1] + t * (segment.end[1] - start[1])
    ];
  if (segment.type === "ellipse")
    return ellipsePoint(ellipseFrame(start, segment), t);
  if (segment.type === "arc") {
    const arc = sketchArcGeometry(start, segment.middle, segment.end), a2 = arc.startAngle + t * arc.sweep;
    return [
      arc.center[0] + arc.radius * Math.cos(a2),
      arc.center[1] + arc.radius * Math.sin(a2)
    ];
  }
  const u = 1 - t, a = u * u * u, b = 3 * u * u * t, c = 3 * u * t * t, d = t * t * t;
  return [
    a * start[0] + b * segment.controls[0][0] + c * segment.controls[1][0] + d * segment.end[0],
    a * start[1] + b * segment.controls[0][1] + c * segment.controls[1][1] + d * segment.end[1]
  ];
}
function closestSegmentParameter(start, segment, point2) {
  const squared = (t) => {
    const p = segmentPoint(start, segment, t);
    return (p[0] - point2[0]) ** 2 + (p[1] - point2[1]) ** 2;
  };
  if (segment.type === "line") {
    const x = segment.end[0] - start[0], y = segment.end[1] - start[1], den = x * x + y * y;
    const parameter22 = den ? Math.max(
      0,
      Math.min(
        1,
        ((point2[0] - start[0]) * x + (point2[1] - start[1]) * y) / den
      )
    ) : 0;
    return { parameter: parameter22, distance: Math.sqrt(squared(parameter22)) };
  }
  const samples = 64, values = Array.from(
    { length: samples + 1 },
    (_, i) => squared(i / samples)
  );
  let best = values[0], parameter2 = 0;
  for (let i = 0; i <= samples; i++) {
    if (values[i] < best) {
      best = values[i];
      parameter2 = i / samples;
    }
    if (i === 0 || i === samples || values[i] > values[i - 1] || values[i] > values[i + 1])
      continue;
    let lo = (i - 1) / samples, hi = (i + 1) / samples;
    for (let step = 0; step < 45; step++) {
      const a = lo + (hi - lo) / 3, b = hi - (hi - lo) / 3;
      if (squared(a) < squared(b)) hi = b;
      else lo = a;
    }
    const t = (lo + hi) / 2, value2 = squared(t);
    if (value2 < best) {
      best = value2;
      parameter2 = t;
    }
  }
  return { parameter: parameter2, distance: Math.sqrt(best) };
}
function scaledControlPoint(path, ref) {
  const s = path.segments[ref.index];
  if (s?.type === "conic" && ref.control === 0) {
    if (ref.controlScale !== void 0 && ref.controlScale !== 1) throw Error("A conic control cannot use a cubic control scale.");
    return s.control;
  }
  if (s?.type !== "bezier" || ref.control !== 0 && ref.control !== 1) return;
  const scale = ref.controlScale ?? 1;
  if (!Number.isFinite(scale) || scale <= 0)
    throw Error("Control reference scale must be positive and finite.");
  const anchor = ref.control === 0 ? ref.index === 0 ? path.start : path.segments[ref.index - 1].end : s.end;
  const control = s.controls[ref.control];
  if (scale === 1) return control;
  return [
    anchor[0] + scale * (control[0] - anchor[0]),
    anchor[1] + scale * (control[1] - anchor[1])
  ];
}
function referencedContour(d, r) {
  if (r?.projectedContourId === void 0) return d.contours[r?.contour];
  if (typeof r.projectedContourId !== "string" || !r.projectedContourId.trim() || r.contour !== -1) throw Error("Invalid projected constraint reference.");
  const matches = d.projectionContext?.filter((c) => c.id === r.projectedContourId) ?? [];
  if (matches.length !== 1) throw Error(`Broken projected constraint reference: ${r.projectedContourId}.`);
  return matches[0];
}
function resolveVertexReference(contour, ref) {
  if (ref.vertexId === void 0) return ref;
  if (typeof ref.vertexId !== "string" || !ref.vertexId.trim() || contour?.type !== "path" || ref.kind !== "point" || ref.control !== void 0 || ref.segmentId !== void 0)
    throw Error("Invalid stable vertex reference.");
  const indices = [];
  if (contour.startVertexId === ref.vertexId) indices.push(0);
  contour.segments.forEach((s, index) => {
    if (s.endVertexId !== ref.vertexId) return;
    if (indices[0] === 0 && index === contour.segments.length - 1 && sameSketchPoint(s.end, contour.start))
      return;
    indices.push(index + 1);
  });
  if (indices.length !== 1)
    throw Error(`Broken vertex reference: ${ref.vertexId}.`);
  return { ...ref, index: indices[0] };
}
function resolveSegmentReference(contour, ref) {
  ref = resolveVertexReference(contour, ref);
  if (ref.segmentId === void 0) return ref;
  if (typeof ref.segmentId !== "string" || !ref.segmentId.trim() || contour?.type !== "path" || ref.kind === "point" && ref.control === void 0)
    throw Error("Invalid stable segment reference.");
  const matches = contour.segments.map((s, index) => ({ s, index })).filter(({ s }) => s.id === ref.segmentId);
  if (matches.length !== 1)
    throw Error(`Broken segment reference: ${ref.segmentId}.`);
  return { ...ref, index: matches[0].index };
}
function curveJet(curve) {
  const s = curve.segment;
  if (s.type === "conic") return (t) => ({ point: conicPoint(curve.start, s, t), first: conicDerivative(curve.start, s, t), second: conicSecondDerivative(curve.start, s, t) });
  if (s.type === "line")
    return (t) => ({
      point: segmentPoint(curve.start, s, t),
      first: [s.end[0] - curve.start[0], s.end[1] - curve.start[1]],
      second: [0, 0]
    });
  if (s.type === "bezier")
    return (t) => {
      const p = curve.start, [a, b] = s.controls, q = s.end;
      const first = [0, 1].map(
        (k) => 3 * ((1 - t) ** 2 * (a[k] - p[k]) + 2 * (1 - t) * t * (b[k] - a[k]) + t * t * (q[k] - b[k]))
      );
      const second = [0, 1].map(
        (k) => 6 * ((1 - t) * (b[k] - 2 * a[k] + p[k]) + t * (q[k] - 2 * b[k] + a[k]))
      );
      return { point: segmentPoint(p, s, t), first, second };
    };
  const frame = s.type === "ellipse" ? ellipseFrame(curve.start, s) : (() => {
    const arc = sketchArcGeometry(curve.start, s.middle, s.end);
    return {
      ...arc,
      radiusX: arc.radius,
      radiusY: arc.radius,
      rotation: 0
    };
  })();
  const c = Math.cos(frame.rotation), sn = Math.sin(frame.rotation), w = frame.sweep;
  const rotate = (x, y) => [
    c * x - sn * y,
    sn * x + c * y
  ];
  return (t) => {
    const angle2 = frame.startAngle + t * w;
    return {
      point: ellipsePoint(frame, t),
      first: rotate(
        -frame.radiusX * Math.sin(angle2) * w,
        frame.radiusY * Math.cos(angle2) * w
      ),
      second: rotate(
        -frame.radiusX * Math.cos(angle2) * w * w,
        -frame.radiusY * Math.sin(angle2) * w * w
      )
    };
  };
}
function sketchEntityPoint(d, r) {
  const c = referencedContour(d, r);
  r = resolveSegmentReference(c, r);
  if (c?.type === "circle") return c.center;
  if (c?.type !== "path" || r.kind !== "point") return;
  if (r.control !== void 0) {
    return scaledControlPoint(c, r);
  }
  return r.index === 0 ? c.start : c.segments[r.index - 1]?.end;
}
function resolve(d, r) {
  const c = referencedContour(d, r);
  r = resolveSegmentReference(c, r);
  if (!c) throw new Error("Constraint references missing geometry.");
  if (r.kind === "contour") return { contour: c };
  if (r.kind === "curve" && c.type === "path") {
    const segment = c.segments[r.index], parameter2 = r.parameter;
    if (!Number.isInteger(r.index) || !segment || parameter2 === void 0 || !Number.isFinite(parameter2) || parameter2 < 0 || parameter2 > 1)
      throw new Error(
        "Curve contact requires a valid segment and parameter between zero and one."
      );
    const curve = curveJet({
      start: r.index === 0 ? c.start : c.segments[r.index - 1].end,
      segment
    })(parameter2);
    return { curve };
  }
  if (r.kind === "ellipse" && c.type === "path") {
    const segment = c.segments[r.index];
    if (segment?.type === "ellipse" && d.constraints?.some(
      (q) => q.kind === "ellipse-shape" && q.a.contour === r.contour
    )) {
      const first = c.segments[0];
      if (first.type !== "ellipse") throw Error("Invalid full ellipse.");
      return {
        ellipse: {
          center: [
            (c.start[0] + first.end[0]) / 2,
            (c.start[1] + first.end[1]) / 2
          ],
          radiusX: first.radiusX,
          radiusY: first.radiusY,
          rotation: first.rotationDegrees * Math.PI / 180
        }
      };
    }
    if (segment?.type === "ellipse")
      return {
        ellipse: ellipseFrame(
          r.index === 0 ? c.start : c.segments[r.index - 1].end,
          segment
        )
      };
  }
  if (r.kind === "arc" && c.type === "path") {
    const segment = c.segments[r.index];
    if (segment?.type === "arc") {
      const arc = sketchArcGeometry(
        r.index === 0 ? c.start : c.segments[r.index - 1].end,
        segment.middle,
        segment.end
      );
      return { circle: arc, arc };
    }
  }
  if (r.kind === "circle" && c.type === "circle") return { circle: c };
  if (r.kind === "point") {
    if (r.control !== void 0) {
      const point2 = sketchEntityPoint(d, r);
      if (point2) return { point: point2 };
      throw new Error("Missing curve control point.");
    }
    if (c.type === "circle" && r.index === 0) return { point: c.center };
    if (c.type === "path" && Number.isInteger(r.index) && r.index >= 0 && r.index <= c.segments.length)
      return { point: r.index === 0 ? c.start : c.segments[r.index - 1].end };
  }
  if (r.kind === "line" && c.type === "path" && c.segments[r.index]?.type === "line")
    return {
      line: [
        r.index === 0 ? c.start : c.segments[r.index - 1].end,
        c.segments[r.index].end
      ]
    };
  throw new Error("Constraint requires a compatible point, line or circle.");
}
function ellipseLocusResiduals(a, b) {
  const scale = Math.max(a.radiusX, a.radiusY, b.radiusX, b.radiusY, 1e-8);
  const matrix = (e) => {
    const c = Math.cos(e.rotation), s = Math.sin(e.rotation), x2 = e.radiusX / scale, y2 = e.radiusY / scale;
    return [
      x2 * x2 * c * c + y2 * y2 * s * s,
      (x2 * x2 - y2 * y2) * c * s,
      x2 * x2 * s * s + y2 * y2 * c * c
    ];
  };
  const x = matrix(a), y = matrix(b);
  return [
    a.center[0] - b.center[0],
    a.center[1] - b.center[1],
    ...x.map((v, i) => (v - y[i]) * scale)
  ];
}
function pointLineMeasurement(point2, line) {
  const dx = line[1][0] - line[0][0], dy = line[1][1] - line[0][1], length = Math.hypot(dx, dy);
  if (length < 1e-10) throw Error("Select a nonzero-length line for distance.");
  const ux = dx / length, uy = dy / length, along = (point2[0] - line[0][0]) * ux + (point2[1] - line[0][1]) * uy;
  const foot = [line[0][0] + along * ux, line[0][1] + along * uy];
  return {
    foot,
    distance: Math.abs(
      (point2[0] - line[0][0]) * uy - (point2[1] - line[0][1]) * ux
    )
  };
}
function lineLineMeasurement(a, b) {
  const u = [a[1][0] - a[0][0], a[1][1] - a[0][1]];
  const v = [b[1][0] - b[0][0], b[1][1] - b[0][1]];
  const la = Math.hypot(...u), lb = Math.hypot(...v);
  if (la < 1e-10 || lb < 1e-10)
    throw Error("Select two nonzero-length lines for distance.");
  const p = [(a[0][0] + a[1][0]) / 2, (a[0][1] + a[1][1]) / 2];
  const measurement = pointLineMeasurement(p, b);
  return {
    ...measurement,
    point: p,
    parallelError: u[0] / la * (v[1] / lb) - u[1] / la * (v[0] / lb)
  };
}
function measuredDimensionValue(d, c) {
  if (c.value !== void 0 || c.valueFrom !== void 0 || c.valueSign !== void 0 || c.valueScale !== void 0 || c.valueOffset !== void 0)
    throw Error("Reference dimensions cannot contain driving values or links.");
  if (c.kind === "conic-rho") return referencedConic(d, c.a).rho;
  const a = resolve(d, c.a), b = c.b ? resolve(d, c.b) : void 0;
  if ((c.kind === "radius" || c.kind === "diameter") && a.circle)
    return a.circle.radius * (c.kind === "diameter" ? 2 : 1);
  if (c.kind === "length" && a.line)
    return Math.hypot(a.line[1][0] - a.line[0][0], a.line[1][1] - a.line[0][1]);
  if (a.point && b?.point) {
    const dx = b.point[0] - a.point[0], dy = b.point[1] - a.point[1];
    if (c.kind === "distance") return Math.hypot(dx, dy);
    if (c.kind === "horizontal-distance") return dx;
    if (c.kind === "vertical-distance") return dy;
  }
  if (c.kind === "distance") {
    if (a.line && b?.line) {
      const m = lineLineMeasurement(a.line, b.line);
      if (Math.abs(m.parallelError) > 1e-7)
        throw Error("Reference line distance requires parallel lines.");
      return m.distance;
    }
    if (a.point && b?.line)
      return pointLineMeasurement(a.point, b.line).distance;
    if (a.line && b?.point)
      return pointLineMeasurement(b.point, a.line).distance;
  }
  if (c.kind === "angle" && a.line && b?.line) {
    const u = [a.line[1][0] - a.line[0][0], a.line[1][1] - a.line[0][1]], v = [b.line[1][0] - b.line[0][0], b.line[1][1] - b.line[0][1]];
    if (Math.hypot(...u) < 1e-10 || Math.hypot(...v) < 1e-10)
      throw Error("Cannot measure a zero-length line angle.");
    return Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) * 180 / Math.PI;
  }
  throw Error("Select compatible geometry for a reference dimension.");
}
const dimensionUnit = (c) => c.kind === "conic-rho" ? "scalar" : c.kind === "angle" ? "angle" : [
  "distance",
  "horizontal-distance",
  "vertical-distance",
  "length",
  "radius",
  "diameter",
  "offset",
  "slot"
].includes(c.kind) ? "length" : void 0;
function resolveDimensionLink(drawing, constraint) {
  const expected = dimensionUnit(constraint);
  if (constraint.reference)
    throw Error("Reference dimensions cannot drive geometry.");
  if (!expected) throw new Error("Select a dimensional constraint.");
  let current2 = constraint, sign = 1, offset = 0;
  const seen = /* @__PURE__ */ new Set();
  while (current2.valueFrom !== void 0) {
    if (seen.has(current2.id)) throw new Error("Cyclic dimension link.");
    seen.add(current2.id);
    if (current2.value !== void 0)
      throw new Error("A linked dimension cannot also have a literal value.");
    const scale = current2.valueScale ?? 1, shift = current2.valueOffset ?? 0;
    if (!Number.isFinite(scale) || scale === 0 || !Number.isFinite(shift))
      throw Error(
        "Dimension links require a finite nonzero scale and finite offset."
      );
    offset += sign * shift;
    sign *= scale;
    if (!Number.isFinite(sign) || sign === 0 || !Number.isFinite(offset))
      throw Error("Dimension link calculation is outside the numeric range.");
    if (current2.valueSign !== void 0) {
      if (expected !== "angle" || current2.valueSign !== 1 && current2.valueSign !== -1)
        throw new Error("Only angular links support a sign of +1 or -1.");
      sign *= current2.valueSign;
    }
    const target = drawing.constraints?.find((c) => c.id === current2.valueFrom);
    if (!target) throw new Error("The linked dimension driver is missing.");
    if (target.reference)
      throw Error("Reference dimensions cannot drive geometry.");
    if (dimensionUnit(target) !== expected)
      throw new Error("Linked dimensions must use compatible units.");
    current2 = target;
  }
  if (!Number.isFinite(current2.value))
    throw new Error("Enter a finite constraint value.");
  if (current2.valueSign !== void 0 || current2.valueScale !== void 0 || current2.valueOffset !== void 0)
    throw new Error("A dimension sign requires a driver link.");
  return { driver: current2, sign, offset };
}
function dimensionValue(drawing, constraint) {
  if (constraint.reference) return measuredDimensionValue(drawing, constraint);
  const { driver, sign, offset } = resolveDimensionLink(drawing, constraint);
  const value2 = driver.value * sign + offset;
  if (!Number.isFinite(value2))
    throw Error("Dimension link calculation is outside the numeric range.");
  return value2;
}
function dimensionDriver(drawing, constraint) {
  return resolveDimensionLink(drawing, constraint).driver;
}
function referencedConic(drawing, ref) {
  const contour = referencedContour(drawing, ref), r = resolveSegmentReference(contour, ref);
  if (contour?.type !== "path" || r.kind !== "curve" || !Number.isInteger(r.index)) throw Error("Select a conic curve.");
  const segment = contour.segments[r.index];
  if (segment?.type !== "conic") throw Error("Select a conic curve.");
  validateConic(r.index === 0 ? contour.start : contour.segments[r.index - 1].end, segment);
  return segment;
}
function conicRhoResiduals(drawing, c) {
  if (c.b || c.axis || c.point || c.fixedGeometry) throw Error("Rho dimensions reference one conic curve.");
  const rho = dimensionValue(drawing, c);
  if (!Number.isFinite(rho) || rho <= 0 || rho >= 1) throw Error("Conic rho must be greater than 0 and less than 1.");
  return [referencedConic(drawing, c.a).rho - rho];
}
function conicCoordinates(s) {
  return [
    ...[0, 1].map((i) => ({ get: () => s.control[i], set: (value2) => {
      s.control[i] = value2;
    } })),
    { get: () => Math.log(s.rho / (1 - s.rho)), set: (value2) => {
      const e = Math.exp(-Math.abs(value2));
      s.rho = Math.max(Number.MIN_VALUE, Math.min(1 - Number.EPSILON, value2 >= 0 ? 1 / (1 + e) : e / (1 + e)));
    } }
  ];
}
function validateSplineFreeEnds(constraint) {
  const ends = constraint.splineFreeEnds;
  if (ends === void 0) return;
  if (constraint.kind !== "spline-shape" || constraint.a.kind !== "contour" || constraint.reference || constraint.b || constraint.axis || !Array.isArray(ends) || !ends.length || ends.length > 2 || ends.some((end) => end !== "start" && end !== "end") || new Set(ends).size !== ends.length)
    throw Error("Independent spline tangents require unique start/end selections on a fit spline.");
}
function splineEndTangentShape(path, spanIntervals, ends) {
  if (path.type !== "path" || !path.segments.length || path.segments.some((s) => s.type !== "bezier") || contourClosed(path))
    throw Error("Independent end tangents require an open fit spline.");
  if (!ends.length || new Set(ends).size !== ends.length || ends.some((end) => !["start", "end"].includes(end)))
    throw Error("Select valid independent spline ends.");
  const points = [path.start, ...path.segments.map((s) => s.end)];
  if (points.length > 1001 || points.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v))))
    throw Error("Spline needs 2–1001 finite fit points.");
  const h = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  if (h.some((v) => v < 1e-8)) throw Error("Consecutive spline fit points must be distinct.");
  if (spanIntervals !== void 0) {
    if (spanIntervals.length !== h.length || spanIntervals.some((v) => !Number.isFinite(v) || v <= 1e-10))
      throw Error("Spline span intervals must be positive and match its segments.");
    h.splice(0, h.length, ...spanIntervals);
  }
  const first = path.segments[0], last = path.segments.at(-1);
  if (first.type !== "bezier" || last.type !== "bezier") throw Error("Select a cubic fit spline.");
  const startFree = ends.includes("start"), endFree = ends.includes("end"), n = points.length;
  const second = points.map(() => [0, 0]);
  for (const axis of [0, 1]) {
    const diagonal = [], upper = [], rhs = [];
    for (let i = 0; i < n; i++) {
      let lower = 0, diag = 1, up = 0, force = 0;
      if (i === 0 && startFree) {
        diag = 2 * h[0];
        up = h[0];
        const derivative2 = 3 * (first.controls[0][axis] - points[0][axis]) / h[0];
        force = 6 * ((points[1][axis] - points[0][axis]) / h[0] - derivative2);
      } else if (i === n - 1 && endFree) {
        lower = h[i - 1];
        diag = 2 * lower;
        const derivative2 = 3 * (points[i][axis] - last.controls[1][axis]) / lower;
        force = 6 * (derivative2 - (points[i][axis] - points[i - 1][axis]) / lower);
      } else if (i > 0 && i < n - 1) {
        lower = h[i - 1];
        up = h[i];
        diag = 2 * (lower + up);
        force = 6 * ((points[i + 1][axis] - points[i][axis]) / up - (points[i][axis] - points[i - 1][axis]) / lower);
      }
      const factor = i ? lower / diagonal[i - 1] : 0;
      diagonal[i] = diag - factor * (upper[i - 1] ?? 0);
      upper[i] = up;
      rhs[i] = force - factor * (rhs[i - 1] ?? 0);
    }
    for (let i = n - 1; i >= 0; i--)
      second[i][axis] = (rhs[i] - upper[i] * (second[i + 1]?.[axis] ?? 0)) / diagonal[i];
  }
  const next = structuredClone(path);
  next.segments.forEach((s, i) => {
    if (s.type !== "bezier") throw Error("Select a cubic fit spline.");
    for (const axis of [0, 1]) {
      const delta2 = points[i + 1][axis] - points[i][axis], step = h[i] * h[i];
      s.controls[0][axis] = points[i][axis] + delta2 / 3 - step * (2 * second[i][axis] + second[i + 1][axis]) / 18;
      s.controls[1][axis] = points[i + 1][axis] - delta2 / 3 - step * (second[i][axis] + 2 * second[i + 1][axis]) / 18;
    }
  });
  return next;
}
function splineEndTangentResiduals(path, constraint) {
  validateSplineFreeEnds(constraint);
  const ends = constraint.splineFreeEnds;
  const expected = splineEndTangentShape(path, constraint.splineSpanIntervals, ends);
  if (path.type !== "path") throw Error("Select a fit spline.");
  return path.segments.flatMap((segment, i) => {
    const target = expected.segments[i];
    if (segment.type !== "bezier" || target.type !== "bezier") throw Error("Select a cubic fit spline.");
    return segment.controls.flatMap((p, j) => {
      if (i === 0 && j === 0 && ends.includes("start") || i === path.segments.length - 1 && j === 1 && ends.includes("end")) return [];
      return [p[0] - target.controls[j][0], p[1] - target.controls[j][1]];
    });
  });
}
function fixedEntityGeometry(drawing, ref) {
  if (ref.projectedContourId !== void 0) throw Error("Projected geometry is already read-only. Fix authored geometry instead.");
  resolve(drawing, ref);
  const contour = drawing.contours[ref.contour];
  ref = resolveSegmentReference(contour, ref);
  if (ref.kind === "point") throw Error("A point Fix uses its point target.");
  if (contour.type === "circle" || ref.kind === "contour") return structuredClone(contour);
  const segment = contour.segments[ref.index];
  if (!segment) throw Error("Fix references a missing curve.");
  return { type: "path", start: [...ref.index === 0 ? contour.start : contour.segments[ref.index - 1].end], segments: [structuredClone(segment)] };
}
function fixedGeometryResiduals(drawing, constraint) {
  if (constraint.kind !== "fix" || constraint.point !== void 0 || constraint.b || constraint.axis || constraint.reference || constraint.value !== void 0 || constraint.valueFrom !== void 0 || constraint.valueExpression !== void 0)
    throw Error("A whole-entity Fix cannot also contain point, pair or dimension fields.");
  const target = constraint.fixedGeometry;
  if (!target || !["circle", "path"].includes(target.type)) throw Error("Fix needs valid saved geometry.");
  validateSketchDrawing({ type: "drawing", contours: [target] });
  const current2 = fixedEntityGeometry(drawing, constraint.a);
  const mismatch = () => {
    throw Error("Fixed geometry changed type or topology. Unfix it before changing its topology.");
  };
  const point2 = (a, b) => [a[0] - b[0], a[1] - b[1]];
  if (current2.type === "circle" && target.type === "circle") return [...point2(current2.center, target.center), current2.radius - target.radius];
  if (current2.type !== "path" || target.type !== "path" || current2.segments.length !== target.segments.length) return mismatch();
  const residual = point2(current2.start, target.start);
  for (let i = 0; i < current2.segments.length; i++) {
    const a = current2.segments[i], b = target.segments[i];
    if (a.type !== b.type) return mismatch();
    residual.push(...point2(a.end, b.end));
    if (a.type === "arc" && b.type === "arc") residual.push(...point2(a.middle, b.middle));
    if (a.type === "bezier" && b.type === "bezier") for (const j of [0, 1]) residual.push(...point2(a.controls[j], b.controls[j]));
    if (a.type === "conic" && b.type === "conic") residual.push(...point2(a.control, b.control), a.rho - b.rho);
    if (a.type === "ellipse" && b.type === "ellipse") {
      if (a.largeArc !== b.largeArc || a.sweep !== b.sweep) return mismatch();
      const rotation = (a.rotationDegrees - b.rotationDegrees) * Math.PI / 180;
      residual.push(a.radiusX - b.radiusX, a.radiusY - b.radiusY, Math.atan2(Math.sin(rotation), Math.cos(rotation)) * Math.max(b.radiusX, b.radiusY));
    }
  }
  return residual;
}
function blockedSketchGeometry(drawing, contourIndex) {
  const contour = drawing.contours[contourIndex], indices = /* @__PURE__ */ new Set();
  for (const c of drawing.constraints ?? []) {
    if (c.kind !== "fix" || !c.fixedGeometry || c.a.contour !== contourIndex || c.a.projectedContourId !== void 0) continue;
    if (Math.max(...fixedGeometryResiduals(drawing, c).map(Math.abs)) > 1e-6) throw Error("Fixed geometry is not at its saved position. Solve the sketch before rebuilding.");
    if (contour.type === "circle") indices.add(0);
    else if (c.a.kind === "contour") contour.segments.forEach((_, index) => indices.add(index));
    else indices.add(resolveSegmentReference(contour, c.a).index);
  }
  return [...indices].sort((a, b) => a - b);
}
function angularSpanDistance(start, sweep, angle2) {
  const tau2 = 2 * Math.PI, wrap = (x) => (x % tau2 + tau2) % tau2;
  const travel = wrap(sweep >= 0 ? angle2 - start : start - angle2);
  if (Math.abs(sweep) >= tau2 - 1e-10 || travel <= Math.abs(sweep) + 1e-10 || tau2 - travel < 1e-10)
    return 0;
  const distance2 = (a, b) => Math.abs(Math.atan2(Math.sin(a - b), Math.cos(a - b)));
  return Math.min(distance2(angle2, start), distance2(angle2, start + sweep));
}
function circleContinuityResiduals(circle, curve, curvature = false) {
  const dx = circle.center[0] - curve.point[0], dy = circle.center[1] - curve.point[1], distance2 = Math.hypot(dx, dy), speed = Math.hypot(...curve.first), r = circle.radius;
  if (!Number.isFinite(r) || r <= 0 || distance2 < 1e-10 || speed < 1e-10)
    throw Error(
      "Circle continuity requires a positive radius and a nonstationary contact away from its center."
    );
  const residuals = [
    distance2 - r,
    (dx * curve.first[0] + dy * curve.first[1]) / (distance2 * speed)
  ];
  if (curvature) {
    const k = (curve.first[0] * curve.second[1] - curve.first[1] * curve.second[0]) / speed ** 3;
    const circleK = (curve.first[0] * dy - curve.first[1] * dx) / (speed * r * r);
    residuals.push((k - circleK) * r);
  }
  return residuals;
}
function patternSourceContour(d, ref) {
  const source = referencedContour(d, ref);
  ref = resolveSegmentReference(source, ref);
  if (ref.kind === "curve" && source?.type === "path" && Number.isInteger(ref.index) && ref.index >= 0 && source.segments[ref.index])
    return {
      type: "path",
      start: ref.index === 0 ? [...source.start] : [...source.segments[ref.index - 1].end],
      segments: [structuredClone(source.segments[ref.index])],
      ...source.sourceLayer !== void 0 ? { sourceLayer: source.sourceLayer } : {},
      construction: source.construction
    };
  const e = resolve(d, ref);
  if (ref.kind === "contour" && source) return source;
  if (ref.kind === "circle" && source?.type === "circle") return source;
  if (e.point)
    return {
      type: "path",
      start: [...e.point],
      segments: [],
      construction: true
    };
  if (source?.type !== "path" || ref.index === void 0 || !source.segments[ref.index])
    throw Error("Select a sketch contour, edge or point.");
  return {
    type: "path",
    start: ref.index === 0 ? [...source.start] : [...source.segments[ref.index - 1].end],
    segments: [structuredClone(source.segments[ref.index])],
    ...source.sourceLayer !== void 0 ? { sourceLayer: source.sourceLayer } : {},
    construction: source.construction
  };
}
function validatePatternSuppression(d, c) {
  const metadata = c.patternSuppression;
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata) || !c.patternGroup || c.b)
    throw Error("Invalid suppressed pattern instance.");
  if (metadata.id !== void 0 && (typeof metadata.id !== "string" || !metadata.id.trim() || metadata.id.length > 128))
    throw Error("Invalid suppressed instance identity.");
  for (const value2 of [metadata.construction, metadata.hole])
    if (value2 !== void 0 && typeof value2 !== "boolean")
      throw Error("Invalid suppressed instance flags.");
  patternRelationTransform(d, c);
}
function mirrorTransform(start, end) {
  const dx = end[0] - start[0], dy = end[1] - start[1], length = Math.hypot(dx, dy);
  if (![...start, ...end].every(Number.isFinite) || length < 1e-8)
    throw new Error("Mirror needs two distinct points on its axis.");
  const x = dx / length, y = dy / length, a = 2 * x * x - 1, b = 2 * x * y, c = b, d = 2 * y * y - 1;
  return {
    a,
    b,
    c,
    d,
    tx: start[0] - a * start[0] - b * start[1],
    ty: start[1] - c * start[0] - d * start[1]
  };
}
function diagnosticCoordinates(d, skipContours = /* @__PURE__ */ new Set()) {
  const coordinates = [], arcs = [];
  const rebuild = () => {
    for (const a of arcs) {
      const dx = a.end[0] - a.start[0], dy = a.end[1] - a.start[1];
      a.middle[0] = (a.start[0] + a.end[0]) / 2 + dy * a.bulge / 2;
      a.middle[1] = (a.start[1] + a.end[1]) / 2 - dx * a.bulge / 2;
    }
  };
  const point2 = (p, alias) => {
    for (let k = 0; k < 2; k++)
      coordinates.push({
        get: () => p[k],
        set: (v) => {
          p[k] = v;
          if (alias) alias[k] = v;
          rebuild();
        }
      });
  };
  for (const [index, c] of d.contours.entries()) {
    if (skipContours.has(index)) continue;
    if (c.type === "circle") {
      point2(c.center);
      coordinates.push({
        get: () => c.radius,
        set: (v) => {
          c.radius = v;
        }
      });
      continue;
    }
    const closed = contourClosed(c);
    point2(c.start, closed ? c.segments.at(-1)?.end : void 0);
    let start = c.start;
    for (const [i, s] of c.segments.entries()) {
      if (!(closed && i === c.segments.length - 1)) point2(s.end);
      if (s.type === "bezier") s.controls.forEach((p) => point2(p));
      if (s.type === "conic") coordinates.push(...conicCoordinates(s));
      if (s.type === "ellipse")
        for (const key of ["radiusX", "radiusY", "rotationDegrees"])
          coordinates.push({
            get: () => s[key],
            set: (v) => {
              s[key] = v;
            }
          });
      if (s.type === "arc") {
        const arc = {
          start,
          end: s.end,
          middle: s.middle,
          bulge: Math.tan(sketchArcGeometry(start, s.middle, s.end).sweep / 4)
        };
        arcs.push(arc);
        coordinates.push({
          get: () => arc.bulge,
          set: (v) => {
            arc.bulge = v;
            rebuild();
          }
        });
      }
      start = s.end;
    }
  }
  rebuild();
  return coordinates;
}
function patternResiduals(source, target, transform) {
  if (!source || !target || !transform)
    throw Error(
      "Pattern relation needs source and instance contours and a transform."
    );
  const expected = transformContour(source, transform);
  if (expected.type !== target.type || contourClosed(expected) !== contourClosed(target))
    throw Error(
      "Pattern topology changed; detach the instance before changing its topology."
    );
  if (expected.type === "path" && target.type === "path") {
    if (expected.segments.length !== target.segments.length || expected.segments.some((s, i) => s.type !== target.segments[i].type))
      throw Error(
        "Pattern topology changed; detach the instance before changing its topology."
      );
    expected.segments.forEach((s, i) => {
      const t = target.segments[i];
      if (s.type === "ellipse" && t.type === "ellipse") {
        if (s.sweep !== t.sweep || s.largeArc !== t.largeArc)
          throw Error("Pattern ellipse branch changed.");
        s.rotationDegrees = t.rotationDegrees + ((s.rotationDegrees - t.rotationDegrees + 180) % 360 + 360) % 360 - 180;
      }
    });
  }
  const coordinates = (c) => diagnosticCoordinates({
    contours: [structuredClone(c)]
  }).map((v) => v.get());
  const a = coordinates(expected), b = coordinates(target);
  return b.map((value2, i) => value2 - a[i]);
}
function periodicSplineSecond(points, h) {
  const n = points.length, diagonal = h.map((v, i) => 2 * (v + h[(i + n - 1) % n]));
  const corner = h[n - 1], gamma = -diagonal[0];
  diagonal[0] -= gamma;
  diagonal[n - 1] -= corner * corner / gamma;
  const solve = (rhs) => {
    const d = [...diagonal], x = [...rhs];
    for (let i = 1; i < n; i++) {
      const f = h[i - 1] / d[i - 1];
      d[i] -= f * h[i - 1];
      x[i] -= f * x[i - 1];
    }
    x[n - 1] /= d[n - 1];
    for (let i = n - 2; i >= 0; i--) x[i] = (x[i] - h[i] * x[i + 1]) / d[i];
    return x;
  };
  const u = Array(n).fill(0);
  u[0] = gamma;
  u[n - 1] = corner;
  const z = solve(u);
  const result = points.map(() => [0, 0]);
  for (const axis of [0, 1]) {
    const rhs = points.map((p, i) => {
      const previous = (i + n - 1) % n, next = (i + 1) % n;
      return 6 * ((points[next][axis] - p[axis]) / h[i] - (p[axis] - points[previous][axis]) / h[previous]);
    });
    const x = solve(rhs), factor = (x[0] + corner * x[n - 1] / gamma) / (1 + z[0] + corner * z[n - 1] / gamma);
    x.forEach((value2, i) => {
      result[i][axis] = value2 - factor * z[i];
    });
  }
  return result;
}
function fitSketchSpline(points, options = {}) {
  if (points.length < 2 || points.length > 1001 || points.some((p) => p.length !== 2 || p.some((v) => !Number.isFinite(v))))
    throw Error("Spline needs 2–1001 finite fit points.");
  const closed = options.closed === true;
  if (closed && (points.length < 3 || points.length > 1e3))
    throw Error("Closed spline needs 3–1000 fit points.");
  const n = points.length, h = points.slice(1).map((p, i) => Math.hypot(p[0] - points[i][0], p[1] - points[i][1]));
  if (closed)
    h.push(
      Math.hypot(
        points[0][0] - points[n - 1][0],
        points[0][1] - points[n - 1][1]
      )
    );
  if (h.some((v) => v < 1e-8))
    throw Error("Consecutive spline fit points must be distinct.");
  if (options.spanIntervals !== void 0) {
    if (options.spanIntervals.length !== h.length || options.spanIntervals.some((v) => !Number.isFinite(v) || v <= 1e-10))
      throw Error(
        "Spline span intervals must be positive and match its segments."
      );
    h.splice(0, h.length, ...options.spanIntervals);
  }
  const second = closed ? periodicSplineSecond(points, h) : points.map(() => [0, 0]);
  if (!closed)
    for (const axis of [0, 1]) {
      const diagonal = [], rhs = [];
      for (let i = 1; i < n - 1; i++) {
        const lower = h[i - 1], upper = h[i];
        const force = 6 * ((points[i + 1][axis] - points[i][axis]) / upper - (points[i][axis] - points[i - 1][axis]) / lower);
        const factor = i === 1 ? 0 : lower / diagonal[i - 1];
        diagonal[i] = 2 * (lower + upper) - factor * h[i - 1];
        rhs[i] = force - (i === 1 ? 0 : factor * rhs[i - 1]);
      }
      for (let i = n - 2; i >= 1; i--)
        second[i][axis] = (rhs[i] - h[i] * second[(i + 1) % n][axis]) / diagonal[i];
    }
  const segments = h.map((step, i) => {
    const a = points[i], b = points[(i + 1) % n], c1 = [0, 0], c2 = [0, 0];
    for (const axis of [0, 1]) {
      const delta2 = b[axis] - a[axis];
      c1[axis] = a[axis] + delta2 / 3 - step * step * (2 * second[i][axis] + second[(i + 1) % n][axis]) / 18;
      c2[axis] = b[axis] - delta2 / 3 - step * step * (second[i][axis] + 2 * second[(i + 1) % n][axis]) / 18;
    }
    return { type: "bezier", controls: [c1, c2], end: [...b] };
  });
  return { type: "path", start: [...points[0]], segments };
}
function splineShapeResiduals(path, spanIntervals) {
  if (path.type !== "path" || !path.segments.length || path.segments.some((s) => s.type !== "bezier"))
    throw Error("Fit spline shape requires a whole Bezier contour.");
  const closed = contourClosed(path), points = [path.start, ...path.segments.map((s) => s.end)];
  if (closed) points.pop();
  const expected = fitSketchSpline(points, { closed, spanIntervals });
  return path.segments.flatMap((segment, i) => {
    const target = expected.segments[i];
    if (segment.type !== "bezier" || target.type !== "bezier")
      throw Error("Invalid fit spline segment.");
    return segment.controls.flatMap((point2, j) => [
      point2[0] - target.controls[j][0],
      point2[1] - target.controls[j][1]
    ]);
  });
}
function ellipseQuadrant(e, index) {
  if (!Number.isInteger(index) || index < 0 || index > 3)
    throw Error("Choose one of the four ellipse quadrants.");
  const a = index * Math.PI / 2, x = e.radiusX * Math.cos(a), y = e.radiusY * Math.sin(a), c = Math.cos(e.rotation), s = Math.sin(e.rotation);
  return [e.center[0] + c * x - s * y, e.center[1] + s * x + c * y];
}
function pointOnEllipse(e, p) {
  const dx = p[0] - e.center[0], dy = p[1] - e.center[1], c = Math.cos(e.rotation), s = Math.sin(e.rotation);
  return (Math.hypot((c * dx + s * dy) / e.radiusX, (-s * dx + c * dy) / e.radiusY) - 1) * Math.min(e.radiusX, e.radiusY);
}
function quadrantFrame(entity) {
  if (entity.ellipse) return entity.ellipse;
  if (entity.circle)
    return {
      center: entity.circle.center,
      radiusX: entity.circle.radius,
      radiusY: entity.circle.radius,
      rotation: 0
    };
  return void 0;
}
function quadrantSpan(entity) {
  if (entity.arc) return entity.arc;
  const ellipse = entity.ellipse;
  if (ellipse && "startAngle" in ellipse && "sweep" in ellipse && typeof ellipse.startAngle === "number" && typeof ellipse.sweep === "number")
    return { startAngle: ellipse.startAngle, sweep: ellipse.sweep };
  return void 0;
}
function ellipseShapeResiduals(path) {
  if (path.type !== "path" || !contourClosed(path) || path.segments.length !== 2)
    throw Error("Ellipse shape requires a closed two-half ellipse.");
  const [a, b] = path.segments;
  if (a.type !== "ellipse" || b.type !== "ellipse" || a.sweep !== b.sweep)
    throw Error("Ellipse halves must have matching sweep.");
  const angle2 = a.rotationDegrees * Math.PI / 180, delta2 = (b.rotationDegrees - a.rotationDegrees) * Math.PI / 180;
  return [
    b.radiusX - a.radiusX,
    b.radiusY - a.radiusY,
    Math.atan2(Math.sin(delta2), Math.cos(delta2)),
    path.start[0] - a.end[0] - 2 * a.radiusX * Math.cos(angle2),
    path.start[1] - a.end[1] - 2 * a.radiusX * Math.sin(angle2)
  ];
}
function symmetricSplineResiduals(a, b, reflect, reversed = false) {
  if (a.type !== "path" || b.type !== "path" || !a.segments.length || a.segments.length !== b.segments.length || [...a.segments, ...b.segments].some((s) => s.type !== "bezier") || contourClosed(a) !== contourClosed(b))
    throw Error(
      "Spline symmetry requires two Bezier contours with matching segment counts and closure."
    );
  const points = (path) => [
    path.start,
    ...path.segments.flatMap(
      (s) => s.type === "bezier" ? [...s.controls, s.end] : []
    )
  ];
  const source = points(a), target = points(b);
  if (reversed) target.reverse();
  if (contourClosed(a)) {
    source.pop();
    target.pop();
  }
  return source.flatMap((point2, i) => {
    const expected = reflect(point2);
    return [target[i][0] - expected[0], target[i][1] - expected[1]];
  });
}
function symmetricResiduals(a, b, axis, splineReversed = false) {
  if (!axis?.line) throw Error("Select a line as the symmetry axis.");
  const [origin, end] = axis.line, dx = end[0] - origin[0], dy = end[1] - origin[1], length = Math.hypot(dx, dy);
  if (length < 1e-10) throw Error("Symmetry axis must have nonzero length.");
  const x = dx / length, y = dy / length;
  const reflect = (p) => {
    const normal = (p[1] - origin[1]) * x - (p[0] - origin[0]) * y;
    return [p[0] + 2 * normal * y, p[1] - 2 * normal * x];
  };
  const pair = (p, q) => {
    const r = reflect(p);
    return [q[0] - r[0], q[1] - r[1]];
  };
  if (a.contour && b?.contour) return symmetricSplineResiduals(a.contour, b.contour, reflect, splineReversed);
  if (a.point && b?.point) return pair(a.point, b.point);
  if (a.circle && b?.circle)
    return [
      ...pair(a.circle.center, b.circle.center),
      a.circle.radius - b.circle.radius
    ];
  if (a.ellipse && b?.ellipse) {
    const tensor = (rx, ry, angle2) => {
      const c = Math.cos(angle2), s = Math.sin(angle2), u = rx * rx, v = ry * ry;
      return [u * c * c + v * s * s, (u - v) * s * c, u * s * s + v * c * c];
    };
    const p = a.ellipse, q = b.ellipse;
    const expected = tensor(
      p.radiusX,
      p.radiusY,
      2 * Math.atan2(y, x) - p.rotation
    ), actual = tensor(q.radiusX, q.radiusY, q.rotation);
    const scale = Math.max(p.radiusX, p.radiusY, q.radiusX, q.radiusY);
    return [
      ...pair(p.center, q.center),
      ...actual.map((v, i) => (v - expected[i]) / scale)
    ];
  }
  if (a.line && b?.line) {
    const p = reflect(a.line[0]), q = reflect(a.line[1]), u = [q[0] - p[0], q[1] - p[1]], v = [b.line[1][0] - b.line[0][0], b.line[1][1] - b.line[0][1]], n = Math.hypot(...u), m = Math.hypot(...v);
    if (n < 1e-10 || m < 1e-10)
      throw Error("Symmetric lines must have nonzero length.");
    return [
      (u[0] * v[1] - u[1] * v[0]) / (n * m),
      ((b.line[0][1] - p[1]) * u[0] - (b.line[0][0] - p[0]) * u[1]) / n
    ];
  }
  throw Error(
    "Select two points, two lines, or two circles/circular arcs, or two ellipses."
  );
}
const sub$1 = (a, b) => [
  a[0] - b[0],
  a[1] - b[1]
];
const cross$7 = (a, b) => a[0] * b[1] - a[1] * b[0];
function offsetCarrier(start, segment, distance2) {
  if (segment.type === "line") {
    const v = sub$1(segment.end, start), length = Math.hypot(...v);
    if (length < 1e-8) throw Error("Cannot offset a zero-length edge.");
    const direction = [v[0] / length, v[1] / length];
    const shift2 = (p) => [
      p[0] - direction[1] * distance2,
      p[1] + direction[0] * distance2
    ];
    return {
      kind: "line",
      direction,
      start: shift2(start),
      end: shift2(segment.end)
    };
  }
  if (segment.type !== "arc")
    throw Error("Mixed offsets currently require lines and circular arcs.");
  const g = sketchArcGeometry(start, segment.middle, segment.end), radius = g.radius - Math.sign(g.sweep) * distance2;
  if (radius <= 1e-8) throw Error("Offset collapses an arc.");
  const shift = (p) => [
    g.center[0] + (p[0] - g.center[0]) * radius / g.radius,
    g.center[1] + (p[1] - g.center[1]) * radius / g.radius
  ];
  return {
    kind: "arc",
    center: g.center,
    radius,
    sweep: g.sweep,
    start: shift(start),
    end: shift(segment.end)
  };
}
function joinOffsetCarriers(a, b, corner) {
  if (Math.hypot(...sub$1(a.end, b.start)) < 1e-8) return a.end;
  let candidates = [];
  if (a.kind === "line" && b.kind === "line") {
    const det = cross$7(a.direction, b.direction);
    if (Math.abs(det) < 1e-10)
      throw Error("Offset corner is parallel or reversing.");
    const t = cross$7(sub$1(b.start, a.end), b.direction) / det;
    candidates = [
      [a.end[0] + t * a.direction[0], a.end[1] + t * a.direction[1]]
    ];
  } else if (a.kind === "arc" && b.kind === "arc") {
    const v = sub$1(b.center, a.center), length = Math.hypot(...v);
    if (length < 1e-10) throw Error("Offset arcs have no unique corner.");
    const along = (a.radius * a.radius - b.radius * b.radius + length * length) / (2 * length), height2 = a.radius * a.radius - along * along;
    if (height2 >= -1e-9) {
      const h = Math.sqrt(Math.max(0, height2)), x = a.center[0] + along * v[0] / length, y = a.center[1] + along * v[1] / length;
      candidates = [
        [x - h * v[1] / length, y + h * v[0] / length],
        [x + h * v[1] / length, y - h * v[0] / length]
      ];
    }
  } else {
    const line = a.kind === "line" ? a : b, arc = a.kind === "arc" ? a : b;
    if (line.kind !== "line" || arc.kind !== "arc") throw Error();
    const v = sub$1(line.start, arc.center), projection = v[0] * line.direction[0] + v[1] * line.direction[1], discriminant = projection * projection - (v[0] * v[0] + v[1] * v[1] - arc.radius * arc.radius);
    if (discriminant >= -1e-9)
      for (const t of [
        -projection - Math.sqrt(Math.max(0, discriminant)),
        -projection + Math.sqrt(Math.max(0, discriminant))
      ])
        candidates.push([
          line.start[0] + t * line.direction[0],
          line.start[1] + t * line.direction[1]
        ]);
  }
  if (!candidates.length)
    throw Error(
      "Offset curves do not meet; this corner requires a topology change."
    );
  return candidates.sort(
    (p, q) => Math.hypot(...sub$1(p, corner)) - Math.hypot(...sub$1(q, corner))
  )[0];
}
function offsetCarrierSegment(c, start, end) {
  if (c.kind === "line") {
    const v = sub$1(end, start);
    if (v[0] * c.direction[0] + v[1] * c.direction[1] <= 1e-8)
      throw Error("Offset reverses or collapses an edge.");
    return { type: "line", end };
  }
  const a = Math.atan2(start[1] - c.center[1], start[0] - c.center[0]), b = Math.atan2(end[1] - c.center[1], end[0] - c.center[0]);
  const tau2 = 2 * Math.PI, sign = Math.sign(c.sweep), sweep = sign * ((sign * (b - a) + tau2) % tau2);
  if (Math.abs(sweep) < 1e-8 || Math.abs(sweep - c.sweep) > Math.PI)
    throw Error("Offset arc requires a topology change.");
  return {
    type: "arc",
    end,
    middle: [
      c.center[0] + c.radius * Math.cos(a + sweep / 2),
      c.center[1] + c.radius * Math.sin(a + sweep / 2)
    ]
  };
}
function cubicOverlap(first, second) {
  if (first.segment.type !== "bezier" || second.segment.type !== "bezier")
    return;
  const candidates = [];
  for (const t of [0, 1]) {
    const point2 = segmentPoint(first.start, first.segment, t), closest = closestSegmentParameter(second.start, second.segment, point2);
    if (closest.distance < 1e-8)
      candidates.push({ first: t, second: closest.parameter, point: point2 });
  }
  for (const u of [0, 1]) {
    const point2 = segmentPoint(second.start, second.segment, u), closest = closestSegmentParameter(first.start, first.segment, point2);
    if (closest.distance < 1e-8)
      candidates.push({ first: closest.parameter, second: u, point: point2 });
  }
  candidates.sort((a2, b2) => a2.first - b2.first);
  const a = candidates[0], b = candidates.at(-1);
  if (!a || !b || b.first - a.first < 1e-8 || Math.abs(b.second - a.second) < 1e-8)
    return;
  const derivative2 = (curve, t) => {
    if (curve.segment.type !== "bezier") throw new Error("Expected cubic.");
    const [p2, q2] = curve.segment.controls, start = curve.start, end = curve.segment.end;
    return [0, 1].map(
      (k) => 3 * ((1 - t) ** 2 * (p2[k] - start[k]) + 2 * (1 - t) * t * (q2[k] - p2[k]) + t * t * (end[k] - q2[k]))
    );
  };
  const polygon = (curve, lo, hi) => {
    const start = segmentPoint(curve.start, curve.segment, lo), end = segmentPoint(curve.start, curve.segment, hi), d0 = derivative2(curve, lo), d1 = derivative2(curve, hi), span = (hi - lo) / 3;
    return [
      start,
      [start[0] + d0[0] * span, start[1] + d0[1] * span],
      [end[0] - d1[0] * span, end[1] - d1[1] * span],
      end
    ];
  };
  const p = polygon(first, a.first, b.first), q = polygon(second, a.second, b.second);
  if (p.every(
    (point2, i) => Math.hypot(point2[0] - q[i][0], point2[1] - q[i][1]) < 1e-7
  ))
    return [a, b];
}
const cross$6 = (a, b) => a[0] * b[1] - a[1] * b[0];
const subtract = (a, b) => [
  a[0] - b[0],
  a[1] - b[1]
];
const unique$1 = (values) => values.sort((a, b) => a - b).filter((t, i, list) => !i || Math.abs(t - list[i - 1]) > 1e-8);
function polynomialRoots(coefficients, lo = 0, hi = 1) {
  const scale = Math.max(...coefficients.map(Math.abs), 1), c = coefficients.map((v) => v / scale);
  while (c.length > 1 && Math.abs(c.at(-1)) < 1e-13) c.pop();
  const value2 = (x) => c.reduceRight((sum, n) => sum * x + n, 0);
  if (c.length === 1) return [];
  if (c.length === 2) {
    const t = -c[0] / c[1];
    return t >= lo - 1e-10 && t <= hi + 1e-10 ? [Math.max(lo, Math.min(hi, t))] : [];
  }
  const critical = polynomialRoots(
    c.slice(1).map((v, i) => v * (i + 1)),
    lo,
    hi
  ), bounds = unique$1([lo, ...critical, hi]), roots2 = [];
  for (const t of bounds) if (Math.abs(value2(t)) < 1e-10) roots2.push(t);
  for (let i = 1; i < bounds.length; i++) {
    let a = bounds[i - 1], b = bounds[i], fa = value2(a);
    if (fa * value2(b) >= 0) continue;
    for (let n = 0; n < 60; n++) {
      const middle = (a + b) / 2, fm = value2(middle);
      if (fa * fm <= 0) b = middle;
      else {
        a = middle;
        fa = fm;
      }
    }
    roots2.push((a + b) / 2);
  }
  return unique$1(roots2);
}
function quadratic(a, b, c) {
  const discriminant = b * b - 4 * a * c;
  if (discriminant < -1e-10 || a < 1e-20) return [];
  const root = Math.sqrt(Math.max(0, discriminant));
  return unique$1([(-b - root) / (2 * a), (-b + root) / (2 * a)]);
}
function lineSegmentIntersections(lineStart, lineEnd, start, segment) {
  const direction = subtract(lineEnd, lineStart), lengthSquared = direction[0] ** 2 + direction[1] ** 2;
  if (lengthSquared < 1e-20)
    throw new Error("Intersection line has zero length.");
  if (segment.type === "conic") return lineConicIntersections(lineStart, lineEnd, start, segment);
  const parameter2 = (p) => ((p[0] - lineStart[0]) * direction[0] + (p[1] - lineStart[1]) * direction[1]) / lengthSquared;
  if (segment.type === "line") {
    const other = subtract(segment.end, start), den = cross$6(direction, other);
    if (Math.abs(den) < 1e-12) return [];
    const delta2 = subtract(start, lineStart), u = cross$6(delta2, direction) / den;
    return u >= -1e-9 && u <= 1 + 1e-9 ? [cross$6(delta2, other) / den] : [];
  }
  if (segment.type === "bezier") {
    const points = [start, ...segment.controls, segment.end], f = points.map((p) => cross$6(subtract(p, lineStart), direction));
    const roots22 = polynomialRoots([
      f[0],
      3 * (f[1] - f[0]),
      3 * (f[2] - 2 * f[1] + f[0]),
      f[3] - 3 * f[2] + 3 * f[1] - f[0]
    ]);
    return roots22.map((t) => {
      const u = 1 - t;
      return parameter2([
        u * u * u * points[0][0] + 3 * u * u * t * points[1][0] + 3 * u * t * t * points[2][0] + t * t * t * points[3][0],
        u * u * u * points[0][1] + 3 * u * u * t * points[1][1] + 3 * u * t * t * points[2][1] + t * t * t * points[3][1]
      ]);
    });
  }
  const frame = segment.type === "ellipse" ? ellipseFrame(start, segment) : (() => {
    const arc = sketchArcGeometry(start, segment.middle, segment.end);
    return {
      ...arc,
      radiusX: arc.radius,
      radiusY: arc.radius,
      rotation: 0
    };
  })();
  const cos = Math.cos(frame.rotation), sin = Math.sin(frame.rotation), q = subtract(lineStart, frame.center);
  const px = (cos * q[0] + sin * q[1]) / frame.radiusX, py = (-sin * q[0] + cos * q[1]) / frame.radiusY;
  const dx = (cos * direction[0] + sin * direction[1]) / frame.radiusX, dy = (-sin * direction[0] + cos * direction[1]) / frame.radiusY;
  const roots2 = quadratic(
    dx * dx + dy * dy,
    2 * (px * dx + py * dy),
    px * px + py * py - 1
  ), tau2 = 2 * Math.PI;
  return roots2.filter((t) => {
    const angle2 = Math.atan2(py + t * dy, px + t * dx), extent = frame.sweep >= 0 ? (angle2 - frame.startAngle + tau2) % tau2 : (frame.startAngle - angle2 + tau2) % tau2;
    return extent <= Math.abs(frame.sweep) + 1e-8 || Math.abs(extent - tau2) < 1e-8;
  });
}
const add$1 = (a, b, scale = 1) => Array.from({ length: Math.max(a.length, b.length) }, (_, i) => (a[i] ?? 0) + scale * (b[i] ?? 0));
const mul = (a, b) => {
  const out = Array(a.length + b.length - 1).fill(0);
  a.forEach((x, i) => b.forEach((y, j) => out[i + j] += x * y));
  return out;
};
const scaled = (p, k) => p.map((v) => v * k);
function rational(curve, origin) {
  const s = curve.segment, p = [curve.start[0] - origin[0], curve.start[1] - origin[1]], q = [s.end[0] - origin[0], s.end[1] - origin[1]];
  if (s.type === "line") return { x: [p[0], q[0] - p[0]], y: [p[1], q[1] - p[1]], d: [1] };
  if (s.type === "bezier") {
    const f2 = (i) => {
      const a = s.controls[0][i] - origin[i], b = s.controls[1][i] - origin[i];
      return [p[i], 3 * (a - p[i]), 3 * (b - 2 * a + p[i]), q[i] - 3 * b + 3 * a - p[i]];
    };
    return { x: f2(0), y: f2(1), d: [1] };
  }
  if (s.type !== "conic") throw Error("Expected a polynomial or rational quadratic curve.");
  const r = s.rho, v = 1 - r, f = (i) => {
    const a = s.control[i] - origin[i];
    return [v * p[i], 2 * (r * a - v * p[i]), v * (p[i] + q[i]) - 2 * r * a];
  };
  return { x: f(0), y: f(1), d: [v, 2 * (2 * r - 1), 2 * (1 - 2 * r)] };
}
function conicParameterAtPoint(start, s, p) {
  validateConic(start, s);
  const a = [s.control[0] - start[0], s.control[1] - start[1]], b = [s.end[0] - start[0], s.end[1] - start[1]], q = [p[0] - start[0], p[1] - start[1]], det = a[0] * b[1] - a[1] * b[0], l1 = (q[0] * b[1] - q[1] * b[0]) / det, l2 = (a[0] * q[1] - a[1] * q[0]) / det, l0 = 1 - l1 - l2;
  if (Math.min(l0, l1, l2) < -1e-8) return;
  const a0 = Math.sqrt(Math.max(0, l0)), a2 = Math.sqrt(Math.max(0, l2));
  if (a0 + a2 < 1e-14) return;
  const t = a2 / (a0 + a2), actual = conicPoint(start, s, t), scale = Math.max(1, Math.hypot(...a), Math.hypot(...b));
  if (Math.hypot(actual[0] - p[0], actual[1] - p[1]) > 1e-7 * scale) return;
  return t;
}
function polynomialPair(first, second) {
  const s = first.segment, origin = first.start, ax = s.control[0] - origin[0], ay = s.control[1] - origin[1], bx = s.end[0] - origin[0], by = s.end[1] - origin[1], det = ax * by - ay * bx, r = rational(second, origin), l1 = scaled(add$1(scaled(r.x, by), scaled(r.y, -bx)), 1 / det), l2 = scaled(add$1(scaled(r.y, ax), scaled(r.x, -ay)), 1 / det), l0 = add$1(add$1(r.d, l1, -1), l2, -1), aa = scaled(mul(l1, l1), (1 - s.rho) ** 2), bb = scaled(mul(l0, l2), 4 * s.rho * s.rho), p = add$1(aa, bb, -1), scale = Math.max(...aa.map(Math.abs), ...bb.map(Math.abs), 1e-30);
  const coincident = p.every((v) => Math.abs(v) < scale * 1e-11), ts = coincident ? [0, 1, ...polynomialRoots(l0), ...polynomialRoots(l2)] : polynomialRoots(p.map((v) => v / scale));
  return ts.flatMap((t) => {
    const point2 = segmentPoint(second.start, second.segment, t), u = conicParameterAtPoint(origin, s, point2);
    return u === void 0 ? [] : [{ first: u, second: t, point: point2 }];
  });
}
function conicCurveIntersections(first, second) {
  if (first.segment.type !== "conic") {
    if (second.segment.type !== "conic") throw Error("Conic intersection needs a conic.");
    return conicCurveIntersections(second, first).map((h) => ({ first: h.second, second: h.first, point: h.point }));
  }
  validateConic(first.start, first.segment);
  const a = { ...first, segment: first.segment }, s = second.segment;
  let hits;
  if (s.type === "line" || s.type === "bezier" || s.type === "conic") hits = polynomialPair(a, second);
  else {
    const f = s.type === "ellipse" ? ellipseFrame(second.start, s) : (() => {
      const c2 = sketchArcGeometry(second.start, s.middle, s.end);
      return { ...c2, radiusX: c2.radius, radiusY: c2.radius, rotation: 0 };
    })(), count = Math.ceil(Math.abs(f.sweep) / (Math.PI / 2)), c = Math.cos(f.rotation), n = Math.sin(f.rotation), at = (angle2, scale = 1) => {
      const x = f.radiusX * Math.cos(angle2) * scale, y = f.radiusY * Math.sin(angle2) * scale;
      return [f.center[0] + c * x - n * y, f.center[1] + n * x + c * y];
    };
    hits = [];
    for (let i = 0; i < count; i++) {
      const begin = f.startAngle + f.sweep * i / count, delta2 = f.sweep / count, w = Math.cos(delta2 / 2), part = { start: at(begin), segment: { type: "conic", end: at(begin + delta2), control: at(begin + delta2 / 2, 1 / w), rho: w / (1 + w) } };
      for (const h of polynomialPair(a, part)) {
        const x = h.point[0] - f.center[0], y = h.point[1] - f.center[1], angle2 = Math.atan2((-n * x + c * y) / f.radiusY, (c * x + n * y) / f.radiusX), shift = Math.atan2(Math.sin(angle2 - begin), Math.cos(angle2 - begin));
        hits.push({ ...h, second: Math.max(0, Math.min(1, (i + shift / delta2) / count)) });
      }
    }
  }
  return hits.sort((a2, b) => a2.first - b.first).filter((h, i, all) => !all.slice(0, i).some((p) => Math.abs(p.first - h.first) < 1e-7 && Math.abs(p.second - h.second) < 1e-7));
}
function lineConicIntersections(a, b, start, s) {
  validateConic(start, s);
  const dx = b[0] - a[0], dy = b[1] - a[1], length = dx * dx + dy * dy;
  if (length < 1e-20) throw Error("Intersection line has zero length.");
  const values = [start, s.control, s.end].map((p) => (p[0] - a[0]) * dy - (p[1] - a[1]) * dx), v = 1 - s.rho, r = s.rho;
  return polynomialRoots([v * values[0], 2 * (r * values[1] - v * values[0]), v * (values[0] + values[2]) - 2 * r * values[1]]).map((t) => {
    const p = conicPoint(start, s, t);
    return ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / length;
  });
}
const lerp = (a, b, t) => [
  a[0] + t * (b[0] - a[0]),
  a[1] + t * (b[1] - a[1])
];
function subdivideSegment(start, segment, t) {
  if (!Number.isFinite(t) || t <= 1e-9 || t >= 1 - 1e-9)
    throw new Error(
      "Choose a split point inside the curve, away from its endpoints."
    );
  if (segment.type === "conic") {
    const [a, b] = splitConic(start, segment, t);
    return [a.segment, b.segment];
  }
  if (segment.type === "bezier") {
    const a = lerp(start, segment.controls[0], t), b = lerp(segment.controls[0], segment.controls[1], t), c = lerp(segment.controls[1], segment.end, t);
    const d = lerp(a, b, t), e = lerp(b, c, t), mid2 = lerp(d, e, t);
    return [
      { type: "bezier", controls: [a, d], end: mid2 },
      { type: "bezier", controls: [e, c], end: [...segment.end] }
    ];
  }
  const mid = segmentPoint(start, segment, t);
  if (segment.type === "line")
    return [
      { type: "line", end: mid },
      { type: "line", end: [...segment.end] }
    ];
  if (segment.type === "arc")
    return [
      { type: "arc", middle: segmentPoint(start, segment, t / 2), end: mid },
      {
        type: "arc",
        middle: segmentPoint(start, segment, (1 + t) / 2),
        end: [...segment.end]
      }
    ];
  const frame = ellipseFrame(start, segment);
  const {
    id: discardedEdge,
    endVertexId: discardedVertex,
    ...geometry
  } = segment;
  const base = { ...geometry, radiusX: frame.radiusX, radiusY: frame.radiusY };
  return [
    { ...base, end: mid, largeArc: Math.abs(frame.sweep * t) > Math.PI },
    {
      ...base,
      end: [...segment.end],
      largeArc: Math.abs(frame.sweep * (1 - t)) > Math.PI
    }
  ];
}
const tau = 2 * Math.PI;
const squaredPolynomial = (p) => {
  const out = Array(p.length * 2 - 1).fill(0);
  p.forEach((a, i) => p.forEach((b, j) => out[i + j] += a * b));
  return out;
};
const add = (a, b) => Array.from(
  { length: Math.max(a.length, b.length) },
  (_, i) => (a[i] ?? 0) + (b[i] ?? 0)
);
function conic(curve) {
  const s = curve.segment;
  if (s.type === "ellipse") return ellipseFrame(curve.start, s);
  if (s.type === "arc") {
    const arc = sketchArcGeometry(curve.start, s.middle, s.end);
    return { ...arc, radiusX: arc.radius, radiusY: arc.radius, rotation: 0 };
  }
  return null;
}
function onConic(frame, p) {
  const x = p[0] - frame.center[0], y = p[1] - frame.center[1], cos = Math.cos(frame.rotation), sin = Math.sin(frame.rotation);
  const angle2 = Math.atan2(
    (-sin * x + cos * y) / frame.radiusY,
    (cos * x + sin * y) / frame.radiusX
  );
  let extent = frame.sweep >= 0 ? (angle2 - frame.startAngle + tau) % tau : (frame.startAngle - angle2 + tau) % tau;
  if (Math.abs(extent - tau) < 1e-7) extent = 0;
  const t = extent / Math.abs(frame.sweep);
  return t >= -1e-8 && t <= 1 + 1e-8 ? Math.max(0, Math.min(1, t)) : null;
}
function local(frame, p) {
  const x = p[0] - frame.center[0], y = p[1] - frame.center[1], c = Math.cos(frame.rotation), s = Math.sin(frame.rotation);
  return [(c * x + s * y) / frame.radiusX, (-s * x + c * y) / frame.radiusY];
}
function bezierConic(curve, frame) {
  if (curve.segment.type !== "bezier")
    throw new Error("Expected a cubic curve.");
  const p = [curve.start, ...curve.segment.controls, curve.segment.end].map(
    (p2) => local(frame, p2)
  );
  const coefficients = (axis) => [
    p[0][axis],
    3 * (p[1][axis] - p[0][axis]),
    3 * (p[2][axis] - 2 * p[1][axis] + p[0][axis]),
    p[3][axis] - 3 * p[2][axis] + 3 * p[1][axis] - p[0][axis]
  ];
  const polynomial = add(
    squaredPolynomial(coefficients(0)),
    squaredPolynomial(coefficients(1))
  );
  polynomial[0] -= 1;
  return polynomialRoots(polynomial);
}
function conicConic(first, second) {
  const c = Math.cos(first.rotation), s = Math.sin(first.rotation);
  const center = local(second, first.center), x = local(second, [
    first.center[0] + c * first.radiusX,
    first.center[1] + s * first.radiusX
  ]), y = local(second, [
    first.center[0] - s * first.radiusY,
    first.center[1] + c * first.radiusY
  ]);
  const u = [x[0] - center[0], x[1] - center[1]], v = [y[0] - center[0], y[1] - center[1]];
  const px = [center[0] + u[0], 2 * v[0], center[0] - u[0]], py = [center[1] + u[1], 2 * v[1], center[1] - u[1]];
  const polynomial = add(squaredPolynomial(px), squaredPolynomial(py));
  polynomial[0] -= 1;
  polynomial[2] -= 2;
  polynomial[4] -= 1;
  while (polynomial.length > 1 && Math.abs(polynomial.at(-1)) < 1e-12)
    polynomial.pop();
  if (polynomial.every((v2) => Math.abs(v2) < 1e-10)) {
    const firstPoints = [0, 1].map((t) => ellipsePoint(first, t)), secondPoints = [0, 1].map((t) => ellipsePoint(second, t));
    return [...firstPoints, ...secondPoints].filter(
      (p) => onConic(first, p) !== null && onConic(second, p) !== null
    );
  }
  if (polynomial.length === 1) return [];
  const leading = Math.abs(polynomial.at(-1)), bound = 1 + Math.max(...polynomial.slice(0, -1).map((v2) => Math.abs(v2) / leading));
  const angles = polynomialRoots(polynomial, -bound, bound).map(
    (t) => 2 * Math.atan(t)
  );
  const piPoint = [
    first.center[0] - c * first.radiusX,
    first.center[1] - s * first.radiusX
  ], piLocal = local(second, piPoint);
  if (Math.abs(piLocal[0] ** 2 + piLocal[1] ** 2 - 1) < 1e-8)
    angles.push(Math.PI);
  return angles.map((angle2) => [
    first.center[0] + c * first.radiusX * Math.cos(angle2) - s * first.radiusY * Math.sin(angle2),
    first.center[1] + s * first.radiusX * Math.cos(angle2) + c * first.radiusY * Math.sin(angle2)
  ]);
}
function derivative(curve, t) {
  const h = 1e-6, a = segmentPoint(curve.start, curve.segment, t - h), b = segmentPoint(curve.start, curve.segment, t + h);
  return [(b[0] - a[0]) / (2 * h), (b[1] - a[1]) / (2 * h)];
}
function bezierPairs(first, second) {
  const box = (curve) => {
    const s = curve.segment;
    if (s.type !== "bezier") throw new Error("Expected cubic.");
    const p = [curve.start, ...s.controls, s.end];
    return {
      x0: Math.min(...p.map((p2) => p2[0])),
      x1: Math.max(...p.map((p2) => p2[0])),
      y0: Math.min(...p.map((p2) => p2[1])),
      y1: Math.max(...p.map((p2) => p2[1]))
    };
  };
  const halves = (piece) => {
    const [a, b] = subdivideSegment(
      piece.curve.start,
      piece.curve.segment,
      0.5
    ), mid = (piece.lo + piece.hi) / 2;
    return [
      {
        curve: { start: piece.curve.start, segment: a },
        lo: piece.lo,
        hi: mid
      },
      { curve: { start: a.end, segment: b }, lo: mid, hi: piece.hi }
    ];
  };
  const overlap = cubicOverlap(first, second);
  if (overlap) return overlap;
  const queue = [
    [
      { curve: first, lo: 0, hi: 1 },
      { curve: second, lo: 0, hi: 1 }
    ]
  ], hits = [];
  let iterations = 0;
  while (queue.length) {
    if (++iterations > 5e4)
      throw new Error(
        "Overlapping or unresolved cubic intersections; no geometry was changed."
      );
    const [a, b] = queue.pop(), ab = box(a.curve), bb = box(b.curve);
    if (ab.x1 < bb.x0 - 1e-9 || bb.x1 < ab.x0 - 1e-9 || ab.y1 < bb.y0 - 1e-9 || bb.y1 < ab.y0 - 1e-9)
      continue;
    const as = Math.max(ab.x1 - ab.x0, ab.y1 - ab.y0), bs = Math.max(bb.x1 - bb.x0, bb.y1 - bb.y0);
    if (Math.max(as, bs) < 1e-5) {
      let t = (a.lo + a.hi) / 2, u = (b.lo + b.hi) / 2;
      for (let i = 0; i < 20; i++) {
        const p2 = segmentPoint(first.start, first.segment, t), q2 = segmentPoint(second.start, second.segment, u), d = derivative(first, t), e = derivative(second, u), dx = p2[0] - q2[0], dy = p2[1] - q2[1], det = e[0] * d[1] - d[0] * e[1];
        if (Math.abs(det) < 1e-12) break;
        const dt = (dx * e[1] - e[0] * dy) / det, du = (dx * d[1] - d[0] * dy) / det;
        t = Math.max(0, Math.min(1, t + dt));
        u = Math.max(0, Math.min(1, u + du));
      }
      const p = segmentPoint(first.start, first.segment, t), q = segmentPoint(second.start, second.segment, u);
      if (Math.hypot(p[0] - q[0], p[1] - q[1]) < 1e-7)
        hits.push({ first: t, second: u, point: p });
      continue;
    }
    if (as >= bs) {
      const [left, right] = halves(a);
      queue.push([left, b], [right, b]);
    } else {
      const [left, right] = halves(b);
      queue.push([a, left], [a, right]);
    }
  }
  return hits;
}
function curveIntersections(first, second) {
  if (first.segment.type === "conic" || second.segment.type === "conic") return conicCurveIntersections(first, second);
  let hits = [];
  if (first.segment.type === "line") {
    if (second.segment.type === "line" || second.segment.type === "bezier") {
      const dx = first.segment.end[0] - first.start[0], dy = first.segment.end[1] - first.start[1], length = dx * dx + dy * dy;
      const points = [
        second.start,
        ...second.segment.type === "bezier" ? second.segment.controls : [],
        second.segment.end
      ];
      if (length > 1e-20 && points.every(
        (p) => Math.abs(
          dx * (p[1] - first.start[1]) - dy * (p[0] - first.start[0])
        ) / Math.sqrt(length) < 1e-8
      )) {
        const t = points.map(
          (p) => ((p[0] - first.start[0]) * dx + (p[1] - first.start[1]) * dy) / length
        );
        if (second.segment.type === "line") {
          const lo = Math.max(0, Math.min(...t)), hi = Math.min(1, Math.max(...t));
          if (hi < lo - 1e-8) return [];
          return (Math.abs(hi - lo) < 1e-8 ? [lo] : [lo, hi]).map(
            (parameter2) => ({
              first: parameter2,
              second: (parameter2 - t[0]) / (t[1] - t[0]),
              point: segmentPoint(first.start, first.segment, parameter2)
            })
          );
        }
        if (Math.min(1, Math.max(...t)) - Math.max(0, Math.min(...t)) > 1e-8)
          throw new Error(
            "Coincident curves need overlap handling before trimming."
          );
      }
    }
    for (const t of lineSegmentIntersections(
      first.start,
      first.segment.end,
      second.start,
      second.segment
    ))
      if (t >= -1e-8 && t <= 1 + 1e-8) {
        const point2 = segmentPoint(first.start, first.segment, t);
        hits.push({
          first: Math.max(0, Math.min(1, t)),
          second: closestSegmentParameter(second.start, second.segment, point2).parameter,
          point: point2
        });
      }
  } else if (second.segment.type === "line")
    return curveIntersections(second, first).map((h) => ({
      first: h.second,
      second: h.first,
      point: h.point
    }));
  else {
    const a = conic(first), b = conic(second);
    if (a && b) {
      for (const point2 of conicConic(a, b)) {
        const t = onConic(a, point2), u = onConic(b, point2);
        if (t !== null && u !== null) hits.push({ first: t, second: u, point: point2 });
      }
    } else if (b) {
      for (const t of bezierConic(first, b)) {
        const point2 = segmentPoint(first.start, first.segment, t), u = onConic(b, point2);
        if (u !== null) hits.push({ first: t, second: u, point: point2 });
      }
    } else if (a)
      return curveIntersections(second, first).map((h) => ({
        first: h.second,
        second: h.first,
        point: h.point
      }));
    else hits = bezierPairs(first, second);
  }
  return hits.sort((a, b) => a.first - b.first).filter(
    (h, i, list) => !list.slice(0, i).some(
      (p) => Math.abs(p.first - h.first) < 1e-5 && Math.abs(p.second - h.second) < 1e-5
    )
  );
}
function offsetMixedPath(source, distance2) {
  const closed = contourClosed(source), points = [source.start, ...source.segments.map((s) => s.end)];
  const carriers = source.segments.map(
    (s, i) => offsetCarrier(points[i], s, distance2)
  );
  const joins = [
    closed ? joinOffsetCarriers(carriers.at(-1), carriers[0], source.start) : carriers[0].start
  ];
  for (let i = 1; i < carriers.length; i++)
    joins.push(joinOffsetCarriers(carriers[i - 1], carriers[i], points[i]));
  joins.push(closed ? [...joins[0]] : carriers.at(-1).end);
  const segments = carriers.map(
    (c, i) => offsetCarrierSegment(c, joins[i], joins[i + 1])
  );
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const adjacent = j === i + 1 || closed && i === 0 && j === segments.length - 1;
      const hits = curveIntersections(
        { start: joins[i], segment: segments[i] },
        { start: joins[j], segment: segments[j] }
      );
      const shared = j === i + 1 ? joins[i + 1] : joins[0];
      if (hits.some(
        (h) => !adjacent || Math.hypot(h.point[0] - shared[0], h.point[1] - shared[1]) > 1e-6 && !(closed && segments.length === 2 && Math.hypot(h.point[0] - joins[0][0], h.point[1] - joins[0][1]) <= 1e-6)
      ))
        throw Error("Offset would self-intersect.");
    }
  return { ...structuredClone(source), start: joins[0], segments };
}
function collinearLineContact(a, b, c, d, tolerance2 = 1e-8) {
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const length = Math.hypot(dx, dy);
  if (length <= tolerance2) return false;
  const ux = dx / length, uy = dy / length;
  const perpendicular = (p) => Math.abs((p[0] - a[0]) * uy - (p[1] - a[1]) * ux);
  if (perpendicular(c) > tolerance2 || perpendicular(d) > tolerance2)
    return false;
  const project = (p) => (p[0] - a[0]) * ux + (p[1] - a[1]) * uy;
  const t = project(c), u = project(d);
  return Math.max(0, Math.min(t, u)) <= Math.min(length, Math.max(t, u)) + tolerance2;
}
const cross$5 = (a, b) => a[0] * b[1] - a[1] * b[0];
const sub = (a, b) => [
  a[0] - b[0],
  a[1] - b[1]
];
function offsetSketchContour(source, distance2) {
  if (!Number.isFinite(distance2) || Math.abs(distance2) < 1e-8)
    throw Error("Enter a nonzero finite offset distance.");
  const out = structuredClone(source);
  delete out.id;
  if (out.type === "circle") {
    out.radius += distance2;
    if (out.radius <= 1e-8) throw Error("Offset collapses the circle.");
    return out;
  }
  if (out.segments.length === 1 && out.segments[0].type === "arc") {
    const s = out.segments[0], g = sketchArcGeometry(out.start, s.middle, s.end);
    const radius = g.radius - Math.sign(g.sweep) * distance2;
    if (radius <= 1e-8) throw Error("Offset collapses the arc.");
    const radial = (p) => [
      g.center[0] + (p[0] - g.center[0]) * radius / g.radius,
      g.center[1] + (p[1] - g.center[1]) * radius / g.radius
    ];
    out.start = radial(out.start);
    s.middle = radial(s.middle);
    s.end = radial(s.end);
    return out;
  }
  if (out.segments.length > 1 && out.segments.some((s) => s.type === "arc"))
    return offsetMixedPath(out, distance2);
  if (!out.segments.length || out.segments.some((s) => s.type !== "line"))
    throw Error(
      "Offset currently requires a line chain, circle or individual circular arc."
    );
  const closed = contourClosed(out), points = [out.start, ...out.segments.map((s) => s.end)];
  const edges = out.segments.map((_, i) => {
    const delta2 = sub(points[i + 1], points[i]), length = Math.hypot(...delta2);
    if (length < 1e-8) throw Error("Cannot offset a zero-length edge.");
    const direction = [delta2[0] / length, delta2[1] / length];
    const shift = (p) => [
      p[0] - direction[1] * distance2,
      p[1] + direction[0] * distance2
    ];
    return { direction, start: shift(points[i]), end: shift(points[i + 1]) };
  });
  const join = (before, after) => {
    const det = cross$5(before.direction, after.direction);
    if (Math.abs(det) < 1e-10) {
      if (before.direction[0] * after.direction[0] + before.direction[1] * after.direction[1] < 0)
        throw Error("Cannot offset a reversing corner.");
      return before.end;
    }
    const t = cross$5(sub(after.start, before.end), after.direction) / det;
    return [
      before.end[0] + t * before.direction[0],
      before.end[1] + t * before.direction[1]
    ];
  };
  const result = [
    closed ? join(edges.at(-1), edges[0]) : edges[0].start
  ];
  for (let i = 1; i < edges.length; i++)
    result.push(join(edges[i - 1], edges[i]));
  result.push(closed ? [...result[0]] : edges.at(-1).end);
  for (let i = 0; i < edges.length; i++) {
    const delta2 = sub(result[i + 1], result[i]);
    if (delta2[0] * edges[i].direction[0] + delta2[1] * edges[i].direction[1] <= 1e-8)
      throw Error("Offset collapses or reverses an edge.");
    for (let j = i + 2; j < edges.length; j++) {
      if (closed && i === 0 && j === edges.length - 1) continue;
      const v = sub(result[j + 1], result[j]), det = cross$5(delta2, v);
      if (Math.abs(det) < 1e-10) {
        if (collinearLineContact(
          result[i],
          result[i + 1],
          result[j],
          result[j + 1]
        ))
          throw Error("Offset would self-intersect.");
        continue;
      }
      const between = sub(result[j], result[i]), t = cross$5(between, v) / det, u = cross$5(between, delta2) / det;
      if (t >= 0 && t <= 1 && u >= 0 && u <= 1)
        throw Error("Offset would self-intersect.");
    }
  }
  out.start = result[0];
  out.segments = result.slice(1).map((end) => ({ type: "line", end }));
  return out;
}
function closedSlotOffset(source, side, width) {
  if (!Number.isFinite(width) || width <= 1e-8)
    throw Error("Slot width must be positive and finite.");
  if (source.type === "circle") {
    if (width >= 2 * source.radius - 1e-8)
      throw Error(
        "Circular slot width must be smaller than its centerline diameter."
      );
    return (side === "inner" ? -1 : 1) * width / 2;
  }
  if (!contourClosed(source) || !source.segments.length || source.segments.some((s) => s.type !== "line" && s.type !== "arc"))
    throw Error("Select a closed line/arc chain.");
  let area = 0, start = source.start;
  for (const s of source.segments) {
    area += start[0] * s.end[1] - start[1] * s.end[0];
    if (s.type === "arc") {
      const arc = sketchArcGeometry(start, s.middle, s.end);
      area += arc.radius ** 2 * (arc.sweep - Math.sin(arc.sweep));
    }
    start = s.end;
  }
  if (Math.abs(area) < 1e-8)
    throw Error("Closed slot centerline has no enclosed area.");
  return Math.sign(area) * (side === "inner" ? 1 : -1) * width / 2;
}
const delta = (a, b) => [
  b[0] - a[0],
  b[1] - a[1]
];
const angle = (x) => Math.atan2(Math.sin(x), Math.cos(x));
function mixedOffsetResiduals(source, target, distance2) {
  if (source.segments.length !== target.segments.length || contourClosed(source) !== contourClosed(target))
    throw Error("Offset chain topology changed.");
  const result = [];
  let p = source.start, q = target.start;
  source.segments.forEach((s, i) => {
    const t = target.segments[i];
    if (t.type !== s.type) throw Error("Offset chain edge type changed.");
    const first = !contourClosed(source) && i === 0, last = !contourClosed(source) && i === source.segments.length - 1;
    if (s.type === "line" && t.type === "line") {
      const u = delta(p, s.end), v = delta(q, t.end), length = Math.hypot(...u), otherLength = Math.hypot(...v);
      if (length < 1e-10 || otherLength < 1e-10)
        throw Error("Offset line has zero length.");
      const x = u[0] / length, y = u[1] / length;
      result.push(
        Math.atan2(x * v[1] - y * v[0], x * v[0] + y * v[1]),
        (q[1] - p[1]) * x - (q[0] - p[0]) * y - distance2
      );
      if (first) result.push((q[0] - p[0]) * x + (q[1] - p[1]) * y);
      if (last)
        result.push((t.end[0] - s.end[0]) * x + (t.end[1] - s.end[1]) * y);
    } else if (s.type === "arc" && t.type === "arc") {
      const a = sketchArcGeometry(p, s.middle, s.end), b = sketchArcGeometry(q, t.middle, t.end), sign = Math.sign(a.sweep);
      if (a.radius - sign * distance2 <= 1e-8)
        throw Error("Offset collapses an arc.");
      result.push(
        b.center[0] - a.center[0],
        b.center[1] - a.center[1],
        Math.sign(b.sweep) * b.radius - sign * a.radius + distance2
      );
      if (first) result.push(angle(b.startAngle - a.startAngle));
      if (last)
        result.push(angle(b.startAngle + b.sweep - a.startAngle - a.sweep));
    } else
      throw Error(
        "Mixed offset relationships require lines and circular arcs."
      );
    p = s.end;
    q = t.end;
  });
  return result;
}
function offsetResiduals(a, b, distance2) {
  if (!Number.isFinite(distance2))
    throw Error("Offset distance must be finite.");
  if (a.contour && b?.contour) {
    if (a.contour.type === "path" && b.contour.type === "path" && a.contour.segments.some((s) => s.type === "arc"))
      return mixedOffsetResiduals(a.contour, b.contour, distance2);
    const expected = offsetSketchContour(a.contour, distance2), target = b.contour;
    if (expected.type !== "path" || target.type !== "path" || expected.segments.length !== target.segments.length || contourClosed(expected) !== contourClosed(target) || target.segments.some((s) => s.type !== "line"))
      throw Error(
        "Offset chain topology changed; remove the offset relation before changing its edges."
      );
    const p = [expected.start, ...expected.segments.map((s) => s.end)];
    const q = [target.start, ...target.segments.map((s) => s.end)];
    if (contourClosed(expected)) {
      p.pop();
      q.pop();
    }
    return p.flatMap((point2, i) => [q[i][0] - point2[0], q[i][1] - point2[1]]);
  }
  if (a.circle && b?.circle && !a.arc && !b.arc)
    return [
      b.circle.center[0] - a.circle.center[0],
      b.circle.center[1] - a.circle.center[1],
      b.circle.radius - a.circle.radius - distance2
    ];
  if (a.arc && b?.arc) {
    const angle2 = b.arc.startAngle - a.arc.startAngle;
    return [
      b.arc.center[0] - a.arc.center[0],
      b.arc.center[1] - a.arc.center[1],
      b.arc.radius - a.arc.radius + Math.sign(a.arc.sweep) * distance2,
      Math.atan2(Math.sin(angle2), Math.cos(angle2)),
      b.arc.sweep - a.arc.sweep
    ];
  }
  if (a.line && b?.line) {
    const dx = a.line[1][0] - a.line[0][0], dy = a.line[1][1] - a.line[0][1], length = Math.hypot(dx, dy);
    if (length < 1e-10) throw Error("Cannot offset a zero-length line.");
    return a.line.flatMap((p, i) => [
      b.line[i][0] - p[0] + dy / length * distance2,
      b.line[i][1] - p[1] - dx / length * distance2
    ]);
  }
  throw Error(
    "Offset relation requires two circles, two circular arcs or two lines."
  );
}
function closedSlotResiduals(d, c) {
  const source = d.contours[c.a.contour];
  if (c.a.kind !== "contour" || c.b?.kind !== "contour" || source?.type !== "path" || c.slotBoundary !== "inner" && c.slotBoundary !== "outer")
    throw Error("Closed slot boundary references are invalid.");
  return offsetResiduals(
    resolve(d, c.a),
    resolve(d, c.b),
    closedSlotOffset(source, c.slotBoundary, dimensionValue(d, c))
  );
}
function circularSlotResiduals(d, c) {
  const a = d.contours[c.a.contour], b = c.b ? d.contours[c.b.contour] : void 0, width = dimensionValue(d, c);
  if (a?.type !== "circle" || c.a.kind !== "circle" || b?.type !== "circle" || c.b?.kind !== "circle" || !["inner", "outer"].includes(c.slotBoundary ?? ""))
    throw Error("Circular slot references or boundary side are invalid.");
  if (!Number.isFinite(width) || width <= 1e-8 || width >= 2 * a.radius - 1e-8)
    throw Error(
      "Circular slot width must be smaller than its centerline diameter."
    );
  return [
    b.center[0] - a.center[0],
    b.center[1] - a.center[1],
    b.radius - a.radius - (c.slotBoundary === "outer" ? 1 : -1) * width / 2
  ];
}
function smoothSlotResiduals(source, target, width) {
  const n = source.segments.length, p = [target.start, ...target.segments.map((s) => s.end)];
  if (target.segments.length !== 2 * n + 2)
    throw Error("Slot topology changed.");
  const left = {
    type: "path",
    start: target.start,
    segments: target.segments.slice(0, n)
  };
  const right = { type: "path", start: p[2 * n + 1], segments: [] };
  for (let i = 2 * n; i >= n + 1; i--)
    right.segments.push({ ...target.segments[i], end: p[i] });
  const result = [
    ...mixedOffsetResiduals(source, left, width / 2),
    ...mixedOffsetResiduals(source, right, -width / 2)
  ];
  const sp = [source.start, ...source.segments.map((s) => s.end)];
  for (let i = 0; i < n - 1; i++) {
    const a = curveJet({ start: sp[i], segment: source.segments[i] })(1).first;
    const b = curveJet({ start: sp[i + 1], segment: source.segments[i + 1] })(
      0
    ).first;
    result.push(
      Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1])
    );
  }
  for (const [index, center] of [
    [n, source.segments.at(-1).end],
    [2 * n + 1, source.start]
  ]) {
    const s = target.segments[index];
    if (s.type !== "arc") throw Error("Slot cap must remain an arc.");
    const arc = sketchArcGeometry(p[index], s.middle, s.end);
    result.push(
      arc.center[0] - center[0],
      arc.center[1] - center[1],
      arc.radius - width / 2,
      arc.sweep + Math.PI
    );
  }
  return result;
}
function slotChainContour(source, width) {
  if (!Number.isFinite(width) || width <= 1e-8)
    throw Error("Slot width must be positive and finite.");
  if (contourClosed(source) || !source.segments.length)
    throw Error("Select a nonempty open slot chain.");
  const radius = width / 2, points = [source.start, ...source.segments.map((s) => s.end)];
  const jets = source.segments.map(
    (segment, i) => curveJet({ start: points[i], segment })
  );
  function boundary(distance2) {
    const carriers = source.segments.map(
      (s, i) => offsetCarrier(points[i], s, distance2)
    );
    const starts = carriers.map((c) => c.start), ends = carriers.map((c) => c.end), joins = /* @__PURE__ */ new Map();
    for (let i = 0; i < carriers.length - 1; i++) {
      const a = jets[i](1).first, b = jets[i + 1](0).first, turn = Math.atan2(a[0] * b[1] - a[1] * b[0], a[0] * b[0] + a[1] * b[1]);
      if (Math.abs(turn) > Math.PI - 1e-8)
        throw Error("Slot chain reverses direction.");
      if (turn * distance2 < -1e-8) {
        const center = points[i + 1], angle2 = Math.atan2(ends[i][1] - center[1], ends[i][0] - center[0]);
        joins.set(i, {
          type: "arc",
          middle: [
            center[0] + radius * Math.cos(angle2 + turn / 2),
            center[1] + radius * Math.sin(angle2 + turn / 2)
          ],
          end: starts[i + 1]
        });
      } else {
        const join = joinOffsetCarriers(
          carriers[i],
          carriers[i + 1],
          points[i + 1]
        );
        ends[i] = join;
        starts[i + 1] = join;
      }
    }
    const segments2 = [];
    carriers.forEach((c, i) => {
      segments2.push(offsetCarrierSegment(c, starts[i], ends[i]));
      const join = joins.get(i);
      if (join) segments2.push(join);
    });
    return { type: "path", start: starts[0], segments: segments2 };
  }
  const left = boundary(radius), right = boundary(-radius), rp = [right.start, ...right.segments.map((s) => s.end)];
  const cap = (p2, v, sign) => {
    const n = Math.hypot(...v);
    return [
      p2[0] + sign * radius * v[0] / n,
      p2[1] + sign * radius * v[1] / n
    ];
  };
  const segments = [
    ...left.segments,
    {
      type: "arc",
      middle: cap(points.at(-1), jets.at(-1)(1).first, 1),
      end: rp.at(-1)
    }
  ];
  for (let i = right.segments.length - 1; i >= 0; i--)
    segments.push({ ...right.segments[i], end: rp[i] });
  segments.push({
    type: "arc",
    middle: cap(points[0], jets[0](0).first, -1),
    end: left.start
  });
  const p = [left.start, ...segments.map((s) => s.end)];
  for (let i = 0; i < segments.length; i++)
    for (let j = i + 1; j < segments.length; j++) {
      const adjacent = j === i + 1 || i === 0 && j === segments.length - 1, shared = j === i + 1 ? p[i + 1] : p[0];
      if (curveIntersections(
        { start: p[i], segment: segments[i] },
        { start: p[j], segment: segments[j] }
      ).some(
        (hit) => !adjacent || Math.hypot(hit.point[0] - shared[0], hit.point[1] - shared[1]) > 1e-6
      ))
        throw Error(
          "Slot chain overlaps itself; reduce width or change its shape."
        );
    }
  return { type: "path", start: left.start, segments };
}
function slotCenterline(d, ref) {
  const p = d.contours[ref.contour];
  ref = resolveSegmentReference(p, ref);
  if (p?.type !== "path" || !Number.isInteger(ref.index) || ref.index < 0 || !["line", "arc"].includes(ref.kind) || p.segments[ref.index]?.type !== ref.kind)
    throw Error("Select a line or circular arc as the slot centerline.");
  return {
    start: ref.index === 0 ? p.start : p.segments[ref.index - 1].end,
    segment: p.segments[ref.index]
  };
}
function slotContour(start, segment, width) {
  if (!Number.isFinite(width) || width <= 1e-8)
    throw Error("Slot width must be positive and finite.");
  if (segment.type === "arc") {
    const arc = sketchArcGeometry(start, segment.middle, segment.end);
    if (Math.abs(arc.sweep) > Math.PI && width >= Math.hypot(segment.end[0] - start[0], segment.end[1] - start[1]) - 1e-8)
      throw Error(
        "Slot end caps overlap; this width requires topology repair."
      );
  }
  const { id: sourceId, endVertexId: sourceVertexId, ...geometry } = segment;
  const radius = width / 2, centerline = { type: "path", start, segments: [geometry] };
  const left = offsetSketchContour(centerline, radius), right = offsetSketchContour(centerline, -radius);
  if (left.type !== "path" || right.type !== "path") throw Error();
  const jet = curveJet({ start, segment }), first = jet(0).first, last = jet(1).first;
  const cap = (p, v, sign) => {
    const n = Math.hypot(...v);
    if (n < 1e-10) throw Error("Slot centerline has no tangent.");
    return [
      p[0] + sign * radius * v[0] / n,
      p[1] + sign * radius * v[1] / n
    ];
  };
  const end = segment.end;
  return {
    type: "path",
    start: left.start,
    segments: [
      left.segments[0],
      { type: "arc", middle: cap(end, last, 1), end: right.segments[0].end },
      { ...right.segments[0], end: right.start },
      { type: "arc", middle: cap(start, first, -1), end: left.start }
    ]
  };
}
function slotCenterlinePath(d, ref) {
  if (ref.kind === "contour") {
    const p = d.contours[ref.contour];
    if (p?.type !== "path" || contourClosed(p) || !p.segments.length || p.segments.some((s) => s.type !== "line" && s.type !== "arc"))
      throw Error("Select an open line/arc chain.");
    return p;
  }
  const { start, segment } = slotCenterline(d, ref);
  return { type: "path", start, segments: [segment] };
}
function slotProfile(d, ref, width) {
  const path = slotCenterlinePath(d, ref);
  return path.segments.length === 1 ? slotContour(path.start, path.segments[0], width) : slotChainContour(path, width);
}
function slotResiduals(d, c) {
  if (c.a.kind === "circle") return circularSlotResiduals(d, c);
  if (c.slotBoundary !== void 0) return closedSlotResiduals(d, c);
  const target = c.b?.kind === "contour" ? d.contours[c.b.contour] : void 0;
  const source = slotCenterlinePath(d, c.a), width = dimensionValue(d, c);
  if (source.segments.length > 1 && target?.type === "path" && target.segments.length === 2 * source.segments.length + 2)
    return smoothSlotResiduals(source, target, width);
  const expected = slotProfile(d, c.a, width);
  if (target?.type !== "path" || !contourClosed(target) || target.segments.length !== expected.segments.length || target.segments.some((s, i) => s.type !== expected.segments[i].type))
    throw Error("Slot topology changed.");
  const p = [
    expected.start,
    ...expected.segments.slice(0, -1).map((s) => s.end)
  ], q = [target.start, ...target.segments.slice(0, -1).map((s) => s.end)];
  const residuals = p.flatMap((a, i) => [q[i][0] - a[0], q[i][1] - a[1]]);
  expected.segments.forEach((s, i) => {
    const t = target.segments[i];
    if (s.type === "arc" && t.type === "arc")
      residuals.push(
        Math.tan(sketchArcGeometry(q[i], t.middle, t.end).sweep / 4) - Math.tan(sketchArcGeometry(p[i], s.middle, s.end).sweep / 4)
      );
  });
  return residuals;
}
function normalResiduals(a, b) {
  const line = a.line ?? b?.line;
  const curve = a.line ? b : a;
  if (!line || !curve?.circle && !curve?.curve)
    throw new Error(
      "Normal requires a line and a circle/arc or finite curve contact."
    );
  const dx = line[1][0] - line[0][0], dy = line[1][1] - line[0][1];
  const length = Math.hypot(dx, dy);
  if (length < 1e-10)
    throw new Error("A zero-length line has no normal direction.");
  const x = dx / length, y = dy / length;
  const point2 = curve.circle?.center ?? curve.curve.point;
  const incidence = (point2[0] - line[0][0]) * y - (point2[1] - line[0][1]) * x;
  if (curve.circle) return [incidence];
  const jet = curve.curve, speed = Math.hypot(...jet.first);
  if (speed < 1e-10)
    throw new Error("A stationary curve point has no normal direction.");
  return [incidence, (x * jet.first[0] + y * jet.first[1]) / speed];
}
function curveContinuityResiduals(p, q, curvature = false) {
  const lp = Math.hypot(...p.first), lq = Math.hypot(...q.first);
  if (lp < 1e-10 || lq < 1e-10)
    throw new Error("A stationary curve point has no continuity direction.");
  const cross2 = (a, b) => a[0] * b[1] - a[1] * b[0];
  const residuals = [
    p.point[0] - q.point[0],
    p.point[1] - q.point[1],
    cross2(p.first, q.first) / (lp * lq)
  ];
  if (curvature) {
    const orientation = (p.first[0] * q.first[0] + p.first[1] * q.first[1]) / (lp * lq);
    const kp = cross2(p.first, p.second) / lp ** 3;
    const kq = cross2(q.first, q.second) / lq ** 3;
    residuals.push((kp - orientation * kq) * Math.sqrt(lp * lq));
  }
  return residuals;
}
function expressionFunction(name, args) {
  const arity = (n) => {
    if (args.length !== n) throw Error(`${name} requires ${n} arguments.`);
  };
  if (name === "min" || name === "max") {
    if (!args.length) throw Error(`${name} needs arguments.`);
    const values = args.map(numeric), first = values[0];
    if (!values.every((v) => sameUnits(v, first)))
      throw Error("Function arguments have incompatible units.");
    return quantity(
      Math[name](...values.map((v) => v.magnitudeSI)),
      first.lengthPower,
      first.anglePower
    );
  }
  if (name === "roundToPrecision") {
    arity(2);
    const precision = scalar(args[1]);
    if (!Number.isInteger(precision) || precision < 0 || precision > 15)
      throw Error("Precision must be an integer from 0 to 15.");
    return quantity(Number(scalar(args[0]).toFixed(precision)));
  }
  if (name === "atan2") {
    arity(2);
    const y = numeric(args[0]), x = numeric(args[1]);
    if (!sameUnits(x, y)) throw Error("atan2 arguments need matching units.");
    return quantity(Math.atan2(y.magnitudeSI, x.magnitudeSI), 0, 1);
  }
  arity(1);
  const q = numeric(args[0]);
  if (name === "abs")
    return quantity(Math.abs(q.magnitudeSI), q.lengthPower, q.anglePower);
  if (name === "sqrt")
    return quantity(
      Math.sqrt(q.magnitudeSI),
      q.lengthPower / 2,
      q.anglePower / 2
    );
  if (["sin", "cos", "tan"].includes(name)) {
    if (!sameUnits(q, quantity(0)) && !sameUnits(q, quantity(0, 0, 1)))
      throw Error("Trigonometry requires an angle or radians as a number.");
    return quantity(
      { sin: Math.sin, cos: Math.cos, tan: Math.tan }[name](q.magnitudeSI)
    );
  }
  if (["asin", "acos", "atan"].includes(name))
    return quantity(
      { asin: Math.asin, acos: Math.acos, atan: Math.atan }[name](scalar(q)),
      0,
      1
    );
  const functions = {
    round: Math.round,
    floor: Math.floor,
    ceil: Math.ceil,
    exp: Math.exp,
    log: Math.log
  };
  if (Object.hasOwn(functions, name))
    return quantity(functions[name](scalar(q)));
  throw Error(`Unknown expression function ${name}.`);
}
function evaluateExpression(source, context = {}) {
  const visit = (node) => {
    switch (node.kind) {
      case "number":
        return quantity(node.value);
      case "text":
        if (context.allowText === false)
          throw Error("Text is not allowed in a numeric field.");
        return node.value;
      case "symbol":
        if (node.name === "pi") return quantity(Math.PI);
        if (context.allowUnits !== false && Object.hasOwn(expressionUnits, node.name))
          return { ...expressionUnits[node.name] };
        throw Error(`Unknown or unavailable symbol ${node.name}.`);
      case "variable":
        if (!context.resolveVariable)
          throw Error(`Unknown variable #${node.name}.`);
        return context.resolveVariable(node.name);
      case "unary": {
        const value2 = numeric(visit(node.value));
        return quantity(
          -value2.magnitudeSI,
          value2.lengthPower,
          value2.anglePower
        );
      }
      case "call":
        return expressionFunction(node.name, node.arguments.map(visit));
      case "binary": {
        const a = visit(node.left), b = visit(node.right);
        if (node.operator === "~") {
          if (context.allowText === false)
            throw Error("Text is not allowed in a numeric field.");
          const result = expressionText(a) + expressionText(b);
          if (result.length > 1e4)
            throw Error("Expression text is too long.");
          return result;
        }
        const x = numeric(a), y = numeric(b);
        if (node.operator === "+" || node.operator === "-") {
          if (!sameUnits(x, y))
            throw Error("Cannot add quantities with different units.");
          return quantity(
            x.magnitudeSI + (node.operator === "+" ? y.magnitudeSI : -y.magnitudeSI),
            x.lengthPower,
            x.anglePower
          );
        }
        if (node.operator === "^") {
          const power = scalar(y);
          return quantity(
            x.magnitudeSI ** power,
            x.lengthPower * power,
            x.anglePower * power
          );
        }
        const divide = node.operator === "/", sign = divide ? -1 : 1;
        return quantity(
          divide ? x.magnitudeSI / y.magnitudeSI : x.magnitudeSI * y.magnitudeSI,
          x.lengthPower + sign * y.lengthPower,
          x.anglePower + sign * y.anglePower
        );
      }
    }
  };
  return visit(parseExpression(source));
}
function validateDimensionExpression(constraint) {
  if (constraint.valueExpression === void 0) return;
  if (!dimensionUnit(constraint) || constraint.reference || constraint.valueFrom !== void 0)
    throw Error("Only independent driving dimensions support formulas.");
  parseExpression(constraint.valueExpression);
  if (!Number.isFinite(constraint.value))
    throw Error("Dimension formulas require a finite resolved value.");
}
function resolveDimensionExpression(constraint, expression, variables) {
  const family = dimensionUnit(constraint);
  if (!family) throw Error("Select a dimensional constraint.");
  const value2 = numeric(
    evaluateExpression(expression, {
      allowText: false,
      resolveVariable(name) {
        const result = variables.get(name);
        if (result === void 0) throw Error(`Unknown variable #${name}.`);
        return result;
      }
    })
  );
  if (value2.lengthPower !== (family === "length" ? 1 : 0) || value2.anglePower !== (family === "angle" ? 1 : 0))
    throw Error(
      `Dimension formula must resolve to ${family}; include explicit units.`
    );
  const canonical = value2.magnitudeSI / (family === "length" ? 1e-3 : family === "angle" ? Math.PI / 180 : 1);
  if (!Number.isFinite(canonical))
    throw Error("Dimension formula is outside the numeric range.");
  return canonical;
}
const fromNumH = (n) => n / 2 ** 32 | 0;
const fromNumL = (n) => n >>> 0;
function setU64FromNum(view, byteOffset, n, isLE) {
  const h = fromNumH(n);
  const l = fromNumL(n);
  view.setUint32(byteOffset, isLE ? l : h, isLE);
  view.setUint32(byteOffset + 4, isLE ? h : l, isLE);
}
function isBytes(a) {
  return a instanceof Uint8Array || ArrayBuffer.isView(a) && a.constructor.name === "Uint8Array" && "BYTES_PER_ELEMENT" in a && a.BYTES_PER_ELEMENT === 1;
}
const atitle = (title) => title ? `"${title}" ` : "";
function abytes(value2, length, title = "") {
  if (isBytes(value2) && length === void 0)
    return value2;
  const bytes = isBytes(value2);
  const ofLen = "";
  const got = bytes ? `length=${value2.length}` : `type=${typeof value2}`;
  const message = atitle(title) + "expected Uint8Array" + ofLen + ", got " + got;
  if (!bytes)
    throw new TypeError(message);
  throw new RangeError(message);
}
const aobject = (value2, label) => {
  if (value2 === null || typeof value2 !== "object" || Array.isArray(value2))
    throw new TypeError((label === "object" ? "" : `"${label}" `) + "expected object, got type=" + typeof value2);
};
const aopts = (value2, label) => {
  aobject(value2, label);
  const proto = Object.getPrototypeOf(value2);
  if (proto !== Object.prototype && proto !== null)
    throw new TypeError(`"${label}" expected plain object`);
  if (Object.hasOwn(value2, "__proto__"))
    throw new TypeError(`"${label}.__proto__" is not allowed`);
};
function aexists(instance, checkFinished = true) {
  if (instance.destroyed)
    throw new Error("hash was destroyed");
  if (checkFinished && instance.finished)
    throw new Error("digest() was already called");
}
function aoutput(out, instance) {
  abytes(out, void 0, "output");
  const min = instance.outputLen;
  if (!(out.length >= min)) {
    throw new RangeError('"output" expected length >= ' + min);
  }
}
function clean(...arrays) {
  for (let i = 0; i < arrays.length; i++) {
    arrays[i].fill(0);
  }
}
function createView(arr) {
  return new DataView(arr.buffer, arr.byteOffset, arr.byteLength);
}
function rotr(word, shift) {
  return word << 32 - shift | word >>> shift;
}
function checkOpts(defaults, opts, title = "opts") {
  aopts(defaults, "defaults");
  if (opts !== void 0)
    aopts(opts, title);
  const merged = Object.assign(/* @__PURE__ */ Object.create(null), defaults, opts);
  return merged;
}
function createHasher(hashCons, info = {}) {
  if (typeof hashCons !== "function")
    throw new TypeError('"hashCons" expected function, got type=' + typeof hashCons);
  info = checkOpts({}, info, "info");
  const hashC = (msg, opts) => hashCons(opts).update(msg).digest();
  const tmp = hashCons(void 0);
  hashC.outputLen = tmp.outputLen;
  hashC.blockLen = tmp.blockLen;
  hashC.canXOF = tmp.canXOF;
  hashC.create = (opts) => hashCons(opts);
  Object.assign(hashC, info);
  return Object.freeze(hashC);
}
const oidNist = (suffix) => ({
  // Current NIST hashAlgs suffixes used here fit in one DER subidentifier octet.
  // Larger suffix values would need base-128 OID encoding and a different length byte.
  oid: Uint8Array.from([6, 9, 96, 134, 72, 1, 101, 3, 4, 2, suffix])
});
function Chi(a, b, c) {
  return a & b ^ ~a & c;
}
function Maj(a, b, c) {
  return a & b ^ a & c ^ b & c;
}
class HashMD {
  blockLen;
  outputLen;
  canXOF = false;
  padOffset;
  isLE;
  // For partial updates less than block size
  buffer;
  view;
  finished = false;
  length = 0;
  pos = 0;
  destroyed = false;
  constructor(blockLen, outputLen, padOffset, isLE) {
    this.blockLen = blockLen;
    this.outputLen = outputLen;
    this.padOffset = padOffset;
    this.isLE = isLE;
    this.buffer = new Uint8Array(blockLen);
    this.view = createView(this.buffer);
  }
  update(data) {
    aexists(this);
    abytes(data);
    const { view, buffer, blockLen } = this;
    const len = data.length;
    let processed = false;
    for (let pos = 0; pos < len; ) {
      const take = Math.min(blockLen - this.pos, len - pos);
      if (take === blockLen) {
        const dataView = createView(data);
        for (; blockLen <= len - pos; pos += blockLen)
          this.process(dataView, pos);
        processed = true;
        continue;
      }
      buffer.set(pos === 0 && take === len ? data : data.subarray(pos, pos + take), this.pos);
      this.pos += take;
      pos += take;
      if (this.pos === blockLen) {
        this.process(view, 0);
        this.pos = 0;
        processed = true;
      }
    }
    this.length += data.length;
    if (processed)
      this.roundClean();
    return this;
  }
  digestInto(out) {
    aexists(this);
    aoutput(out, this);
    this.finished = true;
    const { buffer, view, blockLen, isLE } = this;
    let { pos } = this;
    buffer[pos++] = 128;
    buffer.fill(0, pos);
    if (this.padOffset > blockLen - pos) {
      this.process(view, 0);
      buffer.fill(0);
    }
    setU64FromNum(view, blockLen - 8, this.length * 8, isLE);
    this.process(view, 0);
    this.roundClean();
    const oview = out === buffer ? view : createView(out);
    const len = this.outputLen;
    const outLen = len / 4;
    const state = this.get();
    if (len % 4 || outLen > state.length)
      throw new Error("invalid outputLen");
    for (let i = 0; i < outLen; i++)
      oview.setUint32(4 * i, state[i], isLE);
  }
  digest() {
    const { buffer, outputLen } = this;
    this.digestInto(buffer);
    const res = buffer.slice(0, outputLen);
    this.destroy();
    return res;
  }
  _cloneIntoMeta(to) {
    const { buffer, length, finished, destroyed, pos } = this;
    to.destroyed = destroyed;
    to.finished = finished;
    to.length = length;
    to.pos = pos;
    if (pos)
      to.buffer.set(buffer);
    return to;
  }
  clone() {
    return this._cloneInto();
  }
}
const SHA256_IV = /* @__PURE__ */ Uint32Array.from([
  1779033703,
  3144134277,
  1013904242,
  2773480762,
  1359893119,
  2600822924,
  528734635,
  1541459225
]);
const SHA256_K = /* @__PURE__ */ Uint32Array.from([
  1116352408,
  1899447441,
  3049323471,
  3921009573,
  961987163,
  1508970993,
  2453635748,
  2870763221,
  3624381080,
  310598401,
  607225278,
  1426881987,
  1925078388,
  2162078206,
  2614888103,
  3248222580,
  3835390401,
  4022224774,
  264347078,
  604807628,
  770255983,
  1249150122,
  1555081692,
  1996064986,
  2554220882,
  2821834349,
  2952996808,
  3210313671,
  3336571891,
  3584528711,
  113926993,
  338241895,
  666307205,
  773529912,
  1294757372,
  1396182291,
  1695183700,
  1986661051,
  2177026350,
  2456956037,
  2730485921,
  2820302411,
  3259730800,
  3345764771,
  3516065817,
  3600352804,
  4094571909,
  275423344,
  430227734,
  506948616,
  659060556,
  883997877,
  958139571,
  1322822218,
  1537002063,
  1747873779,
  1955562222,
  2024104815,
  2227730452,
  2361852424,
  2428436474,
  2756734187,
  3204031479,
  3329325298
]);
const SHA256_W = /* @__PURE__ */ new Uint32Array(64);
class SHA2_32B extends HashMD {
  // We cannot use array here since array allows indexing by variable
  // which means optimizer/compiler cannot use registers.
  // Numeric initializers matter: starting the fields as `undefined` changes
  // V8's field representation and makes sha256 3x slower (measured).
  A = 0;
  B = 0;
  C = 0;
  D = 0;
  E = 0;
  F = 0;
  G = 0;
  H = 0;
  constructor(outputLen, IV) {
    super(64, outputLen, 8, false);
    this.A = IV[0] | 0;
    this.B = IV[1] | 0;
    this.C = IV[2] | 0;
    this.D = IV[3] | 0;
    this.E = IV[4] | 0;
    this.F = IV[5] | 0;
    this.G = IV[6] | 0;
    this.H = IV[7] | 0;
  }
  get() {
    const { A, B, C, D, E, F, G, H } = this;
    return [A, B, C, D, E, F, G, H];
  }
  // prettier-ignore
  set(A, B, C, D, E, F, G, H) {
    this.A = A | 0;
    this.B = B | 0;
    this.C = C | 0;
    this.D = D | 0;
    this.E = E | 0;
    this.F = F | 0;
    this.G = G | 0;
    this.H = H | 0;
  }
  _cloneInto(to) {
    (to ||= new this.constructor()).set(...this.get());
    return this._cloneIntoMeta(to);
  }
  process(view, offset) {
    for (let i = 0; i < 16; i++, offset += 4)
      SHA256_W[i] = view.getUint32(offset, false);
    for (let i = 16; i < 64; i++) {
      const W15 = SHA256_W[i - 15];
      const W2 = SHA256_W[i - 2];
      const s0 = rotr(W15, 7) ^ rotr(W15, 18) ^ W15 >>> 3;
      const s1 = rotr(W2, 17) ^ rotr(W2, 19) ^ W2 >>> 10;
      SHA256_W[i] = s1 + SHA256_W[i - 7] + s0 + SHA256_W[i - 16] | 0;
    }
    let { A, B, C, D, E, F, G, H } = this;
    for (let i = 0; i < 64; i++) {
      const sigma1 = rotr(E, 6) ^ rotr(E, 11) ^ rotr(E, 25);
      const T1 = H + sigma1 + Chi(E, F, G) + SHA256_K[i] + SHA256_W[i] | 0;
      const sigma0 = rotr(A, 2) ^ rotr(A, 13) ^ rotr(A, 22);
      const T2 = sigma0 + Maj(A, B, C) | 0;
      H = G;
      G = F;
      F = E;
      E = D + T1 | 0;
      D = C;
      C = B;
      B = A;
      A = T1 + T2 | 0;
    }
    A = A + this.A | 0;
    B = B + this.B | 0;
    C = C + this.C | 0;
    D = D + this.D | 0;
    E = E + this.E | 0;
    F = F + this.F | 0;
    G = G + this.G | 0;
    H = H + this.H | 0;
    this.set(A, B, C, D, E, F, G, H);
  }
  roundClean() {
    clean(SHA256_W);
  }
  destroy() {
    this.destroyed = true;
    this.set(0, 0, 0, 0, 0, 0, 0, 0);
    clean(this.buffer);
  }
}
class _SHA256 extends SHA2_32B {
  constructor() {
    super(32, SHA256_IV);
  }
}
const sha256 = /* @__PURE__ */ createHasher(
  () => new _SHA256(),
  /* @__PURE__ */ oidNist(1)
);
function textOutlineDigest(contours) {
  const json = JSON.stringify(
    contours,
    (key, value2) => ["id", "startVertexId", "endVertexId", "sourceLayer"].includes(key) ? void 0 : value2
  );
  return Array.from(
    sha256(new TextEncoder().encode(json)),
    (byte) => byte.toString(16).padStart(2, "0")
  ).join("");
}
function textFrameContour(item) {
  const width = item.frameWidthMillimeters, height = textFrameHeight(item);
  return transformContour(
    {
      type: "path",
      id: item.frameContourId,
      construction: true,
      start: [0, 0],
      segments: [
        { type: "line", end: [width, 0] },
        { type: "line", end: [width, height] },
        { type: "line", end: [0, height] },
        { type: "line", end: [0, 0] }
      ]
    },
    textFramePlacement(item)
  );
}
function adjustTextForFrameWidth(drawing, item, previousScaledWidth) {
  if (!item.flipAboutFrame || !item.flipHorizontal) return;
  const delta2 = item.frameWidthMillimeters - previousScaledWidth;
  const axes = textFramePlacement(item), transform = similarityTransform(
    [0, 0],
    [axes.a * delta2, axes.c * delta2],
    0
  );
  for (const id2 of item.contourIds) {
    if (id2 === item.frameContourId) continue;
    const index = drawing.contours.findIndex((c) => c.id === id2);
    if (index >= 0)
      drawing.contours[index] = transformContour(
        drawing.contours[index],
        transform
      );
  }
}
function textSimilarityCoordinates(drawing, options = {}) {
  const covered = /* @__PURE__ */ new Set(), coordinates = [], finish = [];
  for (const item of drawing.textItems ?? []) {
    const indices = item.contourIds.map(
      (id2) => drawing.contours.findIndex((c) => c.id === id2)
    );
    if (indices.some((i) => i < 0) || textOutlineDigest(indices.map((i) => drawing.contours[i])) !== item.outlineDigest)
      continue;
    indices.forEach((i) => covered.add(i));
    if (indices.some((i) => options.fixed?.has(i)) || options.used && !indices.some((i) => options.used.has(i)))
      continue;
    const original = indices.map((i) => structuredClone(drawing.contours[i])), origin = [...item.originMillimeters], em = item.emSizeMillimeters, rotation = item.rotationDegrees, frameWidth = item.frameWidthMillimeters, frameIndex = drawing.contours.findIndex(
      (c) => c.id === item.frameContourId
    );
    const state = item.frameContourId ? [0, 0, 0, 0, 0] : [0, 0, 0, 0];
    const render = () => {
      const scale = Math.exp(state[3]), degrees = state[2] * 180 / Math.PI, transform = similarityTransform(
        origin,
        [state[0], state[1]],
        degrees,
        scale
      );
      indices.forEach((index, i) => {
        drawing.contours[index] = transformContour(original[i], transform);
      });
      item.originMillimeters = [origin[0] + state[0], origin[1] + state[1]];
      item.emSizeMillimeters = em * scale;
      item.rotationDegrees = rotation + degrees;
      if (frameWidth !== void 0 && frameIndex >= 0) {
        item.frameWidthMillimeters = frameWidth * scale * Math.exp(state[4]);
        adjustTextForFrameWidth(drawing, item, frameWidth * scale);
        const frame = textFrameContour(item), existing = drawing.contours[frameIndex];
        if (frame.type === "path" && existing.type === "path") {
          frame.startVertexId = existing.startVertexId;
          frame.segments.forEach((segment, i) => {
            segment.id = existing.segments[i].id;
            segment.endVertexId = existing.segments[i].endVertexId;
          });
        }
        drawing.contours[frameIndex] = frame;
      }
    };
    state.forEach(
      (_, i) => coordinates.push({
        get: () => state[i],
        set: (value2) => {
          state[i] = value2;
          render();
        }
      })
    );
    finish.push(() => {
      item.outlineDigest = textOutlineDigest(
        indices.map((i) => drawing.contours[i])
      );
    });
  }
  return {
    covered,
    coordinates,
    finish() {
      finish.forEach((commit) => commit());
      return drawing;
    }
  };
}
function ellipseLocusCoordinates(drawing, fixed) {
  const covered = /* @__PURE__ */ new Set();
  const coordinates = [];
  drawing.contours.forEach((path, contour) => {
    if (fixed?.has(contour) || path.type !== "path" || path.segments.length < 2 || path.segments.some((s) => s.type !== "ellipse"))
      return;
    const linked = /* @__PURE__ */ new Set([0]);
    const pairs = [];
    for (const c of drawing.constraints ?? []) {
      if (c.kind !== "ellipse-locus" || c.reference || c.a.contour !== contour || c.b?.contour !== contour)
        continue;
      pairs.push([
        resolveSegmentReference(path, c.a).index,
        resolveSegmentReference(path, c.b).index
      ]);
    }
    for (let changed = true; changed; ) {
      changed = false;
      for (const [a, b] of pairs) {
        if (linked.has(a) === linked.has(b)) continue;
        linked.add(linked.has(a) ? b : a);
        changed = true;
      }
    }
    if (linked.size !== path.segments.length) return;
    const frames = path.segments.map((s, i) => {
      if (s.type !== "ellipse") throw Error("Expected ellipse.");
      return ellipseFrame(i ? path.segments[i - 1].end : path.start, s);
    });
    const base = frames[0];
    if (frames.some(
      (f) => ellipseLocusResiduals(base, f).some((r) => Math.abs(r) > 1e-7) || Math.abs(f.radiusX - base.radiusX) > 1e-7 || Math.abs(f.radiusY - base.radiusY) > 1e-7 || Math.abs(
        Math.atan2(
          Math.sin(f.rotation - base.rotation),
          Math.cos(f.rotation - base.rotation)
        )
      ) > 1e-7
    ))
      return;
    const points = [path.start, ...path.segments.map((s) => s.end)];
    const closed = Math.hypot(
      points[0][0] - points.at(-1)[0],
      points[0][1] - points.at(-1)[1]
    ) < 1e-7;
    const cos = Math.cos(base.rotation), sin = Math.sin(base.rotation);
    const angles = points.slice(0, closed ? -1 : void 0).map((p) => {
      const x = p[0] - base.center[0], y = p[1] - base.center[1];
      return Math.atan2(
        (-sin * x + cos * y) / base.radiusY,
        (cos * x + sin * y) / base.radiusX
      );
    });
    const state = [
      base.center[0],
      base.center[1],
      Math.log(base.radiusX),
      Math.log(base.radiusY),
      base.rotation,
      ...angles
    ];
    const render = () => {
      const rx = Math.exp(state[2]), ry = Math.exp(state[3]), c = Math.cos(state[4]), s = Math.sin(state[4]);
      const at = (a) => [
        state[0] + c * rx * Math.cos(a) - s * ry * Math.sin(a),
        state[1] + s * rx * Math.cos(a) + c * ry * Math.sin(a)
      ];
      for (let i = 0; i < points.length; i++) {
        const p = at(state[5 + i % angles.length]);
        points[i][0] = p[0];
        points[i][1] = p[1];
      }
      path.segments.forEach((segment, i) => {
        if (segment.type !== "ellipse") return;
        segment.radiusX = rx;
        segment.radiusY = ry;
        segment.rotationDegrees = state[4] * 180 / Math.PI;
        const a = state[5 + i], b = state[5 + (i + 1) % angles.length];
        const tau2 = 2 * Math.PI;
        const travel = ((segment.sweep ? b - a : a - b) % tau2 + tau2) % tau2;
        segment.largeArc = travel > Math.PI;
      });
    };
    covered.add(contour);
    state.forEach(
      (_, i) => coordinates.push({
        get: () => state[i],
        set: (value2) => {
          state[i] = value2;
          render();
        }
      })
    );
  });
  return { covered, coordinates };
}
function contactParameterCoordinates(d) {
  const coordinates = [];
  for (const c of d.constraints ?? [])
    for (const ref of [c.a, c.b]) {
      if (ref?.sliding === void 0) continue;
      if (typeof ref.sliding !== "boolean" || ref.kind !== "curve" || !["coincident", "pierce", "tangent", "curvature", "normal"].includes(c.kind))
        throw Error("Sliding parameters require a curve contact constraint.");
      if (!ref.sliding) continue;
      if (ref.parameter === void 0 || !Number.isFinite(ref.parameter) || ref.parameter < 0 || ref.parameter > 1)
        throw Error("Curve contact parameter must be between zero and one.");
      coordinates.push({
        get: () => ref.parameter,
        set: (v) => {
          ref.parameter = Math.max(0, Math.min(1, v));
        },
        differenceStep: () => ref.parameter > 0.5 ? -1e-5 : 1e-5
      });
    }
  return coordinates;
}
function solveDrawingConstraints(source, options = {}) {
  if (source.constraints?.some((c) => c.kind === "pierce")) return solveSavedPierceConstraints(source, options);
  const compare = globalThis.__aetherSolverComparison;
  if (!compare) return solveDrawingConstraintsCore(source, options);
  const given = structuredClone(source);
  try {
    const solved = solveDrawingConstraintsCore(source, options);
    compare(given, options, solved);
    return solved;
  } catch (error) {
    compare(given, options, error);
    throw error;
  }
}
function solveDrawingConstraintsCore(source, options = {}) {
  const d = structuredClone(source), constraints = d.constraints ?? [];
  const parameters = contactParameterCoordinates(d);
  if (!constraints.length) return d;
  if (constraints.length > 512)
    throw new Error("This sketch supports up to 512 constraints.");
  if (new Set(constraints.map((c) => c.id)).size !== constraints.length)
    throw new Error("Duplicate constraint IDs.");
  for (const c of constraints) validateDimensionExpression(c);
  for (const c of constraints)
    if (c.valueFrom !== void 0 || c.valueSign !== void 0 || c.valueScale !== void 0 || c.valueOffset !== void 0)
      dimensionDriver(d, c);
  const initial = constraints.flatMap((c) => constraintResiduals(d, c));
  if (!initial.every(Number.isFinite)) throw new Error("Invalid constraint geometry.");
  if (Math.max(...initial.map(Math.abs)) < 1e-7) return d;
  const vars = [];
  const addPoint = (p, alias) => {
    for (let k = 0; k < 2; k++)
      vars.push({
        get: () => p[k],
        set: (v) => {
          p[k] = v;
          if (alias) alias[k] = v;
        }
      });
  };
  const used = new Set(
    constraints.filter((c) => !c.reference).flatMap((c) => [c.a.contour, ...c.b ? [c.b.contour] : [], ...c.axis ? [c.axis.contour] : []])
  );
  const textGroups = textSimilarityCoordinates(d, { fixed: options.fixedContours, used });
  vars.push(...textGroups.coordinates);
  const linkedEllipses = ellipseLocusCoordinates(d, options.fixedContours);
  vars.push(...linkedEllipses.coordinates);
  d.contours.forEach((c, i) => {
    if (!used.has(i) || options.fixedContours?.has(i) || linkedEllipses.covered.has(i) || textGroups.covered.has(i)) return;
    if (c.type === "circle") {
      addPoint(c.center);
      vars.push({ get: () => c.radius, set: (v) => c.radius = v });
    } else {
      const last = c.segments.at(-1);
      const closed = last && Math.hypot(last.end[0] - c.start[0], last.end[1] - c.start[1]) < 1e-6;
      addPoint(c.start, closed ? last.end : void 0);
      c.segments.forEach((s, j) => {
        if (!(closed && j === c.segments.length - 1)) addPoint(s.end);
        if (s.type === "ellipse") {
          for (const key of ["radiusX", "radiusY"]) vars.push({ get: () => Math.log(s[key]), set: (v) => {
            s[key] = Math.exp(v);
          } });
          vars.push({ get: () => s.rotationDegrees * Math.PI / 180, set: (v) => {
            s.rotationDegrees = v * 180 / Math.PI;
          } });
        }
        if (s.type === "arc") addPoint(s.middle);
        if (s.type === "bezier") s.controls.forEach((p) => addPoint(p));
        if (s.type === "conic") vars.push(...conicCoordinates(s));
      });
    }
  });
  vars.push(...parameters);
  if (vars.length > 512)
    throw new Error("Too many constrained sketch coordinates (maximum 512).");
  const residual = () => constraints.flatMap((c) => constraintResiduals(d, c));
  const norm = (r) => r.reduce((n, v) => n + v * v, 0);
  const linearSolve = (a, b) => {
    const n = b.length;
    for (let i = 0; i < n; i++) {
      let pivot = i;
      for (let j = i + 1; j < n; j++)
        if (Math.abs(a[j][i]) > Math.abs(a[pivot][i])) pivot = j;
      [a[i], a[pivot]] = [a[pivot], a[i]];
      [b[i], b[pivot]] = [b[pivot], b[i]];
      const q = a[i][i];
      if (Math.abs(q) < 1e-18)
        throw new Error("Constraint system is singular.");
      for (let k = i; k < n; k++) a[i][k] /= q;
      b[i] /= q;
      for (let j = 0; j < n; j++)
        if (j !== i) {
          const f = a[j][i];
          for (let k = i; k < n; k++) a[j][k] -= f * a[i][k];
          b[j] -= f * b[i];
        }
    }
    return b;
  };
  let damping = 1e-5;
  for (let iteration = 0; iteration < 100; iteration++) {
    const r = residual();
    if (!r.every(Number.isFinite))
      throw new Error("Invalid constraint geometry.");
    if (Math.max(...r.map(Math.abs)) < 1e-7) return textGroups.finish();
    const before = vars.map((v) => v.get());
    const columns = vars.map((v, j) => {
      const h = v.differenceStep?.() ?? 1e-5 * Math.max(1, Math.abs(before[j]));
      v.set(before[j] + h);
      const plus = residual();
      v.set(before[j]);
      return plus.map((p, i) => (p - r[i]) / h);
    });
    const matrix = r.map(
      (_, i) => r.map(
        (_2, j) => columns.reduce((sum, c) => sum + c[i] * c[j], 0) + (i === j ? damping : 0)
      )
    );
    const step = linearSolve(
      matrix,
      r.map((v) => -v)
    );
    vars.forEach(
      (v, j) => v.set(before[j] + columns[j].reduce((sum, c, i) => sum + c * step[i], 0))
    );
    if (norm(residual()) < norm(r)) {
      damping = Math.max(1e-10, damping * 0.3);
    } else {
      vars.forEach((v, j) => v.set(before[j]));
      damping *= 10;
    }
  }
  throw new Error(
    "Constraints conflict or cannot converge. No geometry was changed."
  );
}
function pierceTargetReference(drawing, target, point2) {
  if (!target || target.projectedContourId !== void 0 || !Number.isInteger(target.contour) || target.contour < 0)
    throw Error("Pierce needs an editable point or curve in the current sketch.");
  const contour = drawing.contours[target.contour];
  const ref = resolveSegmentReference(contour, structuredClone(target));
  if (ref.kind === "point") {
    if (ref.parameter !== void 0 || ref.sliding !== void 0 || !resolve(drawing, ref).point)
      throw Error("Invalid Pierce point target.");
    return ref;
  }
  if (ref.kind === "circle" && contour?.type === "circle") {
    if (ref.parameter !== void 0 || ref.sliding !== void 0 || ref.control !== void 0)
      throw Error("Invalid Pierce circle target.");
    resolve(drawing, ref);
    return ref;
  }
  if (contour?.type !== "path" || !["line", "arc", "ellipse", "curve"].includes(ref.kind) || ref.control !== void 0)
    throw Error("Select one Pierce target point or finite curve segment.");
  const index = ref.index, segment = contour.segments[index];
  if (!Number.isInteger(index) || !segment || ref.kind !== "curve" && ref.kind !== segment.type)
    throw Error("The Pierce target segment is missing or changed type.");
  const parameter2 = ref.parameter ?? closestSegmentParameter(index ? contour.segments[index - 1].end : contour.start, segment, point2).parameter;
  if (!Number.isFinite(parameter2) || parameter2 < 0 || parameter2 > 1)
    throw Error("Pierce curve contact parameter must be between zero and one.");
  return { ...ref, kind: "curve", parameter: parameter2, sliding: true };
}
function targetPoint(drawing, a, point2) {
  const entity = resolve(drawing, a);
  if (entity.circle) {
    const { center, radius } = entity.circle;
    const dx = point2[0] - center[0], dy = point2[1] - center[1], length = Math.hypot(dx, dy);
    return length > 1e-12 ? [center[0] + radius * dx / length, center[1] + radius * dy / length] : [center[0] + radius, center[1]];
  }
  const at = entity.point ?? entity.curve?.point;
  if (!at) throw Error("Invalid Pierce contact target.");
  return at;
}
function translatedSeed(drawing, contacts) {
  const next = structuredClone(drawing), moves = /* @__PURE__ */ new Map();
  for (const { a, point: point2 } of contacts) {
    const at = targetPoint(drawing, a, point2);
    const list = moves.get(a.contour) ?? [];
    list.push([point2[0] - at[0], point2[1] - at[1]]);
    moves.set(a.contour, list);
  }
  for (const [index, deltas] of moves) {
    const dx = deltas.reduce((s, d) => s + d[0], 0) / deltas.length;
    const dy = deltas.reduce((s, d) => s + d[1], 0) / deltas.length;
    const c = next.contours[index], seen = /* @__PURE__ */ new Set();
    const move = (p) => {
      if (!seen.has(p)) {
        p[0] += dx;
        p[1] += dy;
        seen.add(p);
      }
    };
    if (c.type === "circle") move(c.center);
    else {
      move(c.start);
      for (const s of c.segments) {
        move(s.end);
        if (s.type === "arc") move(s.middle);
        if (s.type === "bezier") s.controls.forEach(move);
        if (s.type === "conic") move(s.control);
      }
    }
  }
  return next;
}
function solveRelations(drawing, constraints, pointFor, options = {}) {
  const next = structuredClone(drawing), count = next.contours.length;
  const existing = next.constraints ?? [];
  const ids = new Set(existing.map((c) => c.id)), fixed = new Set(options.fixedContours);
  const prepared = constraints.map((c) => {
    if (!c || c.kind !== "pierce" || typeof c.id !== "string" || !c.id.trim() || ids.has(c.id))
      throw Error("Pierce constraints need unique nonempty identities.");
    ids.add(c.id);
    validatePierceConstraint(c);
    const point2 = pointFor(c);
    const a = pierceTargetReference(drawing, c.a, point2);
    const contour = next.contours.length;
    next.contours.push({ type: "path", construction: true, start: [...point2], segments: [] });
    fixed.add(contour);
    return { point: point2, draft: { ...structuredClone(c), a }, equation: {
      id: c.id,
      kind: "coincident",
      a,
      b: { contour, kind: "point", index: 0 }
    } };
  });
  next.constraints = [...existing, ...prepared.map((p) => p.equation)];
  const solve = (input) => {
    const result = solveDrawingConstraints(input, { fixedContours: fixed });
    for (const [index, p] of prepared.entries()) {
      const at = targetPoint(result, result.constraints[existing.length + index].a, p.point);
      if (Math.hypot(at[0] - p.point[0], at[1] - p.point[1]) >= 1e-7)
        throw Error("The Pierce contact cannot converge accurately. No geometry was changed.");
    }
    return result;
  };
  let solved;
  try {
    solved = solve(next);
  } catch (error) {
    if (!(error instanceof Error) || !/conflict|converge|singular/i.test(error.message)) throw error;
    solved = solve(translatedSeed(next, prepared.map((p) => ({ a: p.draft.a, point: p.point }))));
  }
  const returned = { ...solved, contours: solved.contours.slice(0, count) };
  if (drawing.constraints === void 0) delete returned.constraints;
  else returned.constraints = solved.constraints.slice(0, existing.length);
  return { drawing: returned, constraints: prepared.map((p, index) => ({
    ...p.draft,
    a: structuredClone(solved.constraints[existing.length + index].a)
  })) };
}
function solveSavedPierceConstraints(source, options = {}) {
  const relations = source.constraints.filter((c) => c.kind === "pierce");
  const ordinary = { ...source, constraints: source.constraints.filter((c) => c.kind !== "pierce") };
  const solved = solveRelations(ordinary, relations, (c) => pierceContextPoint(source, c), options);
  const byId = new Map([...solved.drawing.constraints ?? [], ...solved.constraints].map((c) => [c.id, c]));
  return { ...solved.drawing, constraints: source.constraints.map((c) => byId.get(c.id)) };
}
function pierceResiduals(drawing, c) {
  const point2 = pierceContextPoint(drawing, c), at = targetPoint(drawing, c.a, point2);
  return [at[0] - point2[0], at[1] - point2[1]];
}
function constraintResiduals(d, c) {
  validatePierceConstraint(c);
  if (c.kind === "pierce") return pierceResiduals(d, c);
  validateSplineFreeEnds(c);
  if (c.fixedGeometry !== void 0) return fixedGeometryResiduals(d, c);
  if (c.reference !== void 0 && typeof c.reference !== "boolean")
    throw Error("Invalid reference dimension flag.");
  if (c.reference) {
    if (!Number.isFinite(measuredDimensionValue(d, c)))
      throw Error("Invalid reference measurement.");
    return [];
  }
  if (c.kind === "conic-rho") return conicRhoResiduals(d, c);
  if (c.kind === "pattern") {
    const source = patternSourceContour(d, c.a);
    if (c.patternSuppression !== void 0) {
      validatePatternSuppression(d, c);
      return [];
    }
    const target = c.b ? resolve(d, c.b).contour : void 0;
    if (c.axis) {
      if (c.transform)
        throw Error("A live mirror axis cannot also have a fixed transform.");
      const axis = resolve(d, c.axis).line;
      if (!axis) throw Error("Select a line.");
      return patternResiduals(
        source,
        target,
        mirrorTransform(axis[0], axis[1])
      );
    }
    return patternResiduals(source, target, patternRelationTransform(d, c));
  }
  const a = resolve(d, c.a), b = c.b ? resolve(d, c.b) : void 0;
  const point2 = (e) => {
    if (!e?.point) throw new Error("Select a point.");
    return e.point;
  };
  const line = (e) => {
    if (!e?.line) throw new Error("Select a line.");
    return e.line;
  };
  const circle = (e) => {
    if (!e?.circle) throw new Error("Select a circle.");
    return e.circle;
  };
  const delta2 = (l) => [
    l[1][0] - l[0][0],
    l[1][1] - l[0][1]
  ];
  const length = (l) => Math.hypot(...delta2(l));
  const value2 = () => dimensionValue(d, c);
  const positive = () => {
    const n = value2();
    if (n <= 0) throw new Error("Dimension must be positive.");
    return n;
  };
  switch (c.kind) {
    case "horizontal":
      return a.point && b?.point ? [a.point[1] - b.point[1]] : [delta2(line(a))[1]];
    case "vertical":
      return a.point && b?.point ? [a.point[0] - b.point[0]] : [delta2(line(a))[0]];
    case "coincident": {
      if (a.point && b?.point)
        return [a.point[0] - b.point[0], a.point[1] - b.point[1]];
      const p = a.point ?? b?.point, other = a.point ? b : a;
      if (!p || !other)
        throw new Error("Select a point and a point, line, circle or arc.");
      if (other.curve)
        return [p[0] - other.curve.point[0], p[1] - other.curve.point[1]];
      if (other.ellipse) return [pointOnEllipse(other.ellipse, p)];
      if (other.circle)
        return [
          Math.hypot(
            p[0] - other.circle.center[0],
            p[1] - other.circle.center[1]
          ) - other.circle.radius
        ];
      const l = line(other), u = delta2(l);
      return [
        (u[0] * (p[1] - l[0][1]) - u[1] * (p[0] - l[0][0])) / Math.max(length(l), 1e-10)
      ];
    }
    case "fix": {
      const p = point2(a);
      if (!c.point || c.point.length !== 2 || !c.point.every(Number.isFinite))
        throw new Error("Fix needs a finite point.");
      return [p[0] - c.point[0], p[1] - c.point[1]];
    }
    case "concentric": {
      const p = a.point ?? a.ellipse?.center ?? circle(a).center, q = b?.point ?? b?.ellipse?.center ?? circle(b).center;
      return [p[0] - q[0], p[1] - q[1]];
    }
    case "length":
      return [length(line(a)) - positive()];
    case "radius":
      return [circle(a).radius - positive()];
    case "diameter":
      return [2 * circle(a).radius - positive()];
    case "distance": {
      if (a.line && b?.line) {
        const m = lineLineMeasurement(a.line, b.line);
        return [m.parallelError, m.distance - positive()];
      }
      if (a.point && b?.line)
        return [pointLineMeasurement(a.point, b.line).distance - positive()];
      if (a.line && b?.point)
        return [pointLineMeasurement(b.point, a.line).distance - positive()];
      const p = point2(a), q = point2(b);
      return [Math.hypot(p[0] - q[0], p[1] - q[1]) - positive()];
    }
    case "horizontal-distance":
    case "vertical-distance": {
      const axis = c.kind === "horizontal-distance" ? 0 : 1;
      return [point2(b)[axis] - point2(a)[axis] - value2()];
    }
    case "equal":
      return a.circle && b?.circle ? [a.circle.radius - b.circle.radius] : [length(line(a)) - length(line(b))];
    case "midpoint": {
      const p = point2(b);
      if (a.arc) return [p[0] - a.arc.midpoint[0], p[1] - a.arc.midpoint[1]];
      const l = line(a);
      return [p[0] - (l[0][0] + l[1][0]) / 2, p[1] - (l[0][1] + l[1][1]) / 2];
    }
    case "parallel":
    case "perpendicular":
    case "angle": {
      const u = delta2(line(a)), v = delta2(line(b)), scale = Math.max(Math.hypot(...u) * Math.hypot(...v), 1e-10);
      if (c.kind === "parallel") return [(u[0] * v[1] - u[1] * v[0]) / scale];
      if (c.kind === "perpendicular")
        return [(u[0] * v[0] + u[1] * v[1]) / scale];
      const angle2 = Math.atan2(u[0] * v[1] - u[1] * v[0], u[0] * v[0] + u[1] * v[1]) - value2() * Math.PI / 180;
      return [Math.atan2(Math.sin(angle2), Math.cos(angle2))];
    }
    case "quadrant": {
      const p = a.point ?? b?.point, e = quadrantFrame(a) ?? (b ? quadrantFrame(b) : void 0);
      if (!p || !e) throw Error("Select a point and a circle, arc or ellipse.");
      const q = ellipseQuadrant(e, c.quadrant), span = quadrantSpan(a) ?? (b ? quadrantSpan(b) : void 0);
      return [
        p[0] - q[0],
        p[1] - q[1],
        ...span ? [
          Math.min(e.radiusX, e.radiusY) * angularSpanDistance(
            span.startAngle,
            span.sweep,
            c.quadrant * Math.PI / 2
          )
        ] : []
      ];
    }
    case "spline-shape":
      if (!a.contour) throw Error("Select the whole fit spline contour.");
      return c.splineFreeEnds ? splineEndTangentResiduals(a.contour, c) : splineShapeResiduals(a.contour, c.splineSpanIntervals);
    case "ellipse-locus":
      if (!a.ellipse || !b?.ellipse) throw Error("Select two elliptical arcs.");
      return ellipseLocusResiduals(a.ellipse, b.ellipse);
    case "ellipse-shape":
      if (!a.contour) throw Error("Select the whole ellipse contour.");
      return ellipseShapeResiduals(a.contour);
    case "symmetric":
      if (c.splineReversed !== void 0 && (typeof c.splineReversed !== "boolean" || !a.contour || !b?.contour))
        throw Error("Spline direction applies only to whole spline symmetry.");
      return symmetricResiduals(
        a,
        b,
        c.axis ? resolve(d, c.axis) : void 0,
        c.splineReversed
      );
    case "slot":
      return slotResiduals(d, c);
    case "offset":
      return offsetResiduals(a, b, value2());
    case "normal":
      return normalResiduals(a, b);
    case "curvature": {
      if (a.circle && b?.curve)
        return circleContinuityResiduals(a.circle, b.curve, true);
      if (a.curve && b?.circle)
        return circleContinuityResiduals(b.circle, a.curve, true);
      if (!a.curve || !b?.curve)
        throw new Error(
          "Select two finite curve contacts for curvature continuity."
        );
      return curveContinuityResiduals(a.curve, b.curve, true);
    }
    case "tangent": {
      if (a.circle && b?.curve)
        return circleContinuityResiduals(a.circle, b.curve);
      if (a.curve && b?.circle)
        return circleContinuityResiduals(b.circle, a.curve);
      if (a.curve && b?.curve) {
        return curveContinuityResiduals(a.curve, b.curve);
      }
      if (a.circle && b?.circle) {
        const distance2 = Math.hypot(
          a.circle.center[0] - b.circle.center[0],
          a.circle.center[1] - b.circle.center[1]
        );
        return [
          distance2 - (c.tangentMode === "internal" ? Math.abs(a.circle.radius - b.circle.radius) : a.circle.radius + b.circle.radius)
        ];
      }
      const p = circle(a.circle ? a : b), l = line(a.line ? a : b), u = delta2(l), len = Math.max(length(l), 1e-10);
      return [
        Math.abs(
          u[0] * (p.center[1] - l[0][1]) - u[1] * (p.center[0] - l[0][0])
        ) / len - p.radius
      ];
    }
    default:
      throw new Error("Unsupported sketch constraint.");
  }
}
const sameSketchPoint = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]) < 1e-6;
function contourClosed(c) {
  return c.type === "circle" || c.segments.length > 0 && sameSketchPoint(c.start, c.segments.at(-1).end);
}
function validateSketchDrawing(input) {
  validatePatternGroups(input);
  validateTextItems(input);
  const d = solveDrawingConstraints(input);
  if (!Array.isArray(d.contours) || d.contours.length > 1e3)
    throw new Error("Invalid sketch contours.");
  const point2 = (p) => {
    if (!Array.isArray(p) || p.length !== 2 || !p.every(Number.isFinite))
      throw new Error("Sketch coordinates must be finite.");
  };
  const ids = /* @__PURE__ */ new Set();
  for (const c of d.contours) {
    if (c.sourceLayer !== void 0 && (typeof c.sourceLayer !== "string" || !c.sourceLayer.length || c.sourceLayer.length > 255))
      throw Error(
        "Source layer must be a nonempty name of at most 255 characters."
      );
    if (c.id !== void 0) {
      if (typeof c.id !== "string" || !c.id.trim() || c.id.length > 128 || ids.has(c.id))
        throw Error(
          "Sketch contour identities must be unique nonempty strings."
        );
      ids.add(c.id);
    }
    if (c.construction !== void 0 && typeof c.construction !== "boolean")
      throw new Error("Construction flag must be boolean.");
    if (c.type === "circle") {
      point2(c.center);
      if (!Number.isFinite(c.radius) || c.radius <= 0)
        throw new Error("Circle radius must be positive.");
    } else if (c.type === "path") {
      point2(c.start);
      if (!Array.isArray(c.segments) || c.segments.length > 1e3)
        throw new Error("Invalid sketch path.");
      const vertexIds = /* @__PURE__ */ new Set();
      const vertex = (id2) => {
        if (id2 === void 0) return;
        if (typeof id2 !== "string" || !id2.trim() || id2.length > 128 || vertexIds.has(id2))
          throw Error(
            "Sketch vertex identities must be unique nonempty strings within a path."
          );
        vertexIds.add(id2);
      };
      vertex(c.startVertexId);
      c.segments.forEach((s, index) => {
        const closing = index === c.segments.length - 1 && sameSketchPoint(s.end, c.start) && s.endVertexId === c.startVertexId;
        if (!closing) vertex(s.endVertexId);
      });
      const segmentIds = /* @__PURE__ */ new Set();
      let previous = c.start;
      for (const s of c.segments) {
        if (s.id !== void 0) {
          if (typeof s.id !== "string" || !s.id.trim() || s.id.length > 128 || segmentIds.has(s.id))
            throw Error(
              "Sketch segment identities must be unique nonempty strings within a path."
            );
          segmentIds.add(s.id);
        }
        point2(s.end);
        if (sameSketchPoint(previous, s.end))
          throw new Error("Sketch segment has zero length.");
        if (s.type === "arc") {
          point2(s.middle);
          const area = (s.middle[0] - previous[0]) * (s.end[1] - previous[1]) - (s.middle[1] - previous[1]) * (s.end[0] - previous[0]);
          if (Math.abs(area) < 1e-8)
            throw new Error("Arc points must not be collinear.");
        } else if (s.type === "conic") {
          validateConic(previous, s);
        } else if (s.type === "bezier") {
          s.controls.forEach(point2);
          if (s.controls.length !== 2)
            throw new Error("Cubic Bezier needs two controls.");
        } else if (s.type === "ellipse") {
          if (![s.radiusX, s.radiusY, s.rotationDegrees].every(Number.isFinite) || s.radiusX <= 0 || s.radiusY <= 0)
            throw new Error("Ellipse radii must be positive.");
        } else if (s.type !== "line")
          throw new Error("Unsupported sketch segment.");
        previous = s.end;
      }
    } else throw new Error("Unsupported sketch contour.");
  }
}
function solveProjectedConstraints(authored, projected) {
  const next = structuredClone(authored), count = next.contours.length;
  const fixed = /* @__PURE__ */ new Set(), mapped = /* @__PURE__ */ new Map();
  const map = (ref) => {
    const id2 = ref.projectedContourId;
    if (id2 === void 0) return ref;
    if (typeof id2 !== "string" || !id2.trim() || ref.contour !== -1)
      throw Error("Invalid projected constraint reference.");
    let index = mapped.get(id2);
    if (index === void 0) {
      const matches = projected.contours.filter((c) => c.id === id2);
      if (matches.length !== 1)
        throw Error(`Broken projected constraint reference: ${id2}.`);
      index = next.contours.length;
      next.contours.push(structuredClone(matches[0]));
      fixed.add(index);
      mapped.set(id2, index);
    }
    const { projectedContourId: _, ...local2 } = ref;
    return { ...local2, contour: index };
  };
  next.constraints = next.constraints?.map((c) => ({
    ...c,
    a: map(c.a),
    ...c.b ? { b: map(c.b) } : {},
    ...c.axis ? { axis: map(c.axis) } : {}
  }));
  const solved = solveDrawingConstraints(next, { fixedContours: fixed });
  const restore = (original, updated) => ({
    ...structuredClone(original),
    ...original.kind === "curve" && original.sliding ? { parameter: updated.parameter } : {}
  });
  const constraints = authored.constraints?.map((c, i) => ({
    ...structuredClone(c),
    a: restore(c.a, solved.constraints[i].a),
    ...c.b ? { b: restore(c.b, solved.constraints[i].b) } : {},
    ...c.axis ? { axis: restore(c.axis, solved.constraints[i].axis) } : {}
  }));
  return {
    ...structuredClone(authored),
    contours: solved.contours.slice(0, count),
    constraints
  };
}
function composeProjectedDrawing(projected, authored) {
  if (!authored) return projected;
  const local2 = solveProjectedConstraints(authored, projected);
  const contours = [
    ...structuredClone(projected.contours),
    ...structuredClone(local2.contours)
  ];
  const ids = /* @__PURE__ */ new Set();
  for (const contour of contours) {
    if (contour.id === void 0) continue;
    if (ids.has(contour.id))
      throw Error(
        `Mixed projection has duplicate contour identity: ${contour.id}.`
      );
    ids.add(contour.id);
  }
  return { type: "drawing", contours };
}
function collapsedConicPoints(map, frame) {
  const c = Math.cos(frame.rotation), s = Math.sin(frame.rotation);
  const u = map.vector([frame.radiusX * c, frame.radiusX * s]);
  const v = map.vector([-frame.radiusY * s, frame.radiusY * c]);
  const axis = Math.hypot(u[0], v[0]) >= Math.hypot(u[1], v[1]) ? 0 : 1;
  const phase = Math.atan2(v[axis], u[axis]);
  const parameters = [0, 1];
  for (let k = -6; k <= 6; k++) {
    const t = (phase + k * Math.PI - frame.startAngle) / frame.sweep;
    if (t > 1e-12 && t < 1 - 1e-12) parameters.push(t);
  }
  return parameters.sort((a, b) => a - b).map((t) => map.point(ellipsePoint(frame, t)));
}
function collapsedInterval(points) {
  const axis = Math.max(...points.map((p) => p[0])) - Math.min(...points.map((p) => p[0])) >= Math.max(...points.map((p) => p[1])) - Math.min(...points.map((p) => p[1])) ? 0 : 1;
  const sorted = [...points].sort((a, b) => a[axis] - b[axis]);
  return [sorted[0], sorted[sorted.length - 1]];
}
const dot$1 = (a, b) => a.reduce((s, v, i) => s + v * b[i], 0);
const cross$4 = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
function basis(frame) {
  const { originMillimeters: o, xDirection: x, normal: n } = frame;
  if (![o, x, n].every(
    (v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)
  ) || Math.abs(Math.hypot(...x) - 1) > 1e-6 || Math.abs(Math.hypot(...n) - 1) > 1e-6 || Math.abs(dot$1(x, n)) > 1e-6)
    throw Error("Projection needs valid orthonormal sketch frames.");
  return { o, x, y: cross$4(n, x) };
}
function sketchFrameMap(source, target) {
  const a = basis(source), b = basis(target), delta2 = a.o.map((v, i) => v - b.o[i]);
  const m = [
    dot$1(a.x, b.x),
    dot$1(a.y, b.x),
    dot$1(a.x, b.y),
    dot$1(a.y, b.y)
  ];
  const offset = [dot$1(delta2, b.x), dot$1(delta2, b.y)];
  const vector2 = (p) => [
    m[0] * p[0] + m[1] * p[1],
    m[2] * p[0] + m[3] * p[1]
  ];
  return {
    determinant: m[0] * m[3] - m[1] * m[2],
    vector: vector2,
    point(p) {
      const v = vector2(p);
      return [v[0] + offset[0], v[1] + offset[1]];
    }
  };
}
function projectedEllipse(map, rx, ry, rotation) {
  const c = Math.cos(rotation), s = Math.sin(rotation), u = map.vector([rx * c, rx * s]), v = map.vector([-ry * s, ry * c]);
  const scale = Math.max(...u.map(Math.abs), ...v.map(Math.abs));
  if (!Number.isFinite(scale) || scale === 0)
    throw Error("Conic mapping has no finite nonzero extent.");
  const ux = u[0] / scale, uy = u[1] / scale, vx = v[0] / scale, vy = v[1] / scale;
  const xx = ux * ux + vx * vx, xy = ux * uy + vx * vy, yy = uy * uy + vy * vy;
  const major = Math.sqrt((xx + yy + Math.hypot(xx - yy, 2 * xy)) / 2);
  const radiusX = major * scale;
  const radiusY = Math.abs(map.determinant * (rx / scale) * (ry / scale)) / major * scale;
  if (!Number.isFinite(radiusX) || !Number.isFinite(radiusY) || radiusY < 1e-8)
    throw Error("Mapped conic is below the supported geometric resolution.");
  const rotationDegrees = Math.atan2(2 * xy, xx - yy) * 90 / Math.PI;
  return { radiusX, radiusY, rotationDegrees };
}
function projectedConicSegment(map, axes, end, sweep) {
  return {
    type: "ellipse",
    ...axes,
    end: map.point(end),
    largeArc: Math.abs(sweep) > Math.PI,
    sweep: sweep * map.determinant > 0
  };
}
function projectSketchDrawing(source, sourceFrame, targetFrame) {
  return mapSketchDrawing(
    source,
    sketchFrameMap(sourceFrame, targetFrame),
    1e-14
  );
}
function mapSketchDrawing(source, map, collapseTolerance = 0) {
  const drawing = solveDrawingConstraints(source);
  if (!Number.isFinite(map.determinant) || !Number.isFinite(collapseTolerance) || collapseTolerance < 0)
    throw Error("Invalid affine mapping tolerance or determinant.");
  const collapsed = map.determinant === 0 || Math.abs(map.determinant) < collapseTolerance;
  const contours = drawing.contours.map((c) => {
    const flags = {
      ...c.sourceLayer !== void 0 ? { sourceLayer: c.sourceLayer } : {},
      ...c.id !== void 0 ? { id: c.id } : {},
      ...c.hole !== void 0 ? { hole: c.hole } : {},
      ...c.construction !== void 0 ? { construction: c.construction } : {}
    };
    if (c.type === "circle") {
      if (collapsed) {
        const [start3, end] = collapsedInterval(
          collapsedConicPoints(map, {
            center: c.center,
            radiusX: c.radius,
            radiusY: c.radius,
            rotation: 0,
            startAngle: 0,
            sweep: 2 * Math.PI
          })
        );
        return {
          type: "path",
          start: start3,
          segments: sameSketchPoint(start3, end) ? [] : [{ type: "line", end }],
          ...flags,
          hole: false
        };
      }
      const axes = projectedEllipse(map, c.radius, c.radius, 0);
      if (Math.abs(axes.radiusX - axes.radiusY) < 1e-10 * Math.max(1, axes.radiusX))
        return {
          type: "circle",
          center: map.point(c.center),
          radius: axes.radiusX,
          ...flags
        };
      const start2 = [c.center[0] + c.radius, c.center[1]], opposite = [c.center[0] - c.radius, c.center[1]];
      return {
        type: "path",
        start: map.point(start2),
        segments: [
          projectedConicSegment(map, axes, opposite, Math.PI),
          projectedConicSegment(map, axes, start2, Math.PI)
        ],
        ...flags
      };
    }
    let previous = c.start;
    let segments = c.segments.flatMap((segment) => {
      const start2 = previous;
      previous = segment.end;
      if (segment.type === "conic") return projectConic(start2, segment, map.point, collapsed);
      if (segment.type === "line")
        return collapsed && sameSketchPoint(map.point(start2), map.point(segment.end)) ? [] : [{ type: "line", end: map.point(segment.end) }];
      if (segment.type === "bezier")
        return [
          {
            type: "bezier",
            end: map.point(segment.end),
            controls: [
              map.point(segment.controls[0]),
              map.point(segment.controls[1])
            ]
          }
        ];
      if (collapsed) {
        const frame = segment.type === "arc" ? (() => {
          const a = sketchArcGeometry(start2, segment.middle, segment.end);
          return {
            ...a,
            radiusX: a.radius,
            radiusY: a.radius,
            rotation: 0
          };
        })() : ellipseFrame(start2, segment);
        const points = collapsedConicPoints(map, frame);
        return points.slice(1).flatMap(
          (end, i) => sameSketchPoint(points[i], end) ? [] : [{ type: "line", end }]
        );
      }
      if (segment.type === "arc") {
        const arc = sketchArcGeometry(start2, segment.middle, segment.end);
        return [
          projectedConicSegment(
            map,
            projectedEllipse(map, arc.radius, arc.radius, 0),
            segment.end,
            arc.sweep
          )
        ];
      }
      const ellipse = ellipseFrame(start2, segment);
      return [
        projectedConicSegment(
          map,
          projectedEllipse(
            map,
            ellipse.radiusX,
            ellipse.radiusY,
            ellipse.rotation
          ),
          segment.end,
          ellipse.sweep
        )
      ];
    });
    if (!collapsed)
      segments.forEach((segment, index) => {
        if (c.segments[index].id !== void 0)
          segment.id = c.segments[index].id;
        if (c.segments[index].endVertexId !== void 0)
          segment.endVertexId = c.segments[index].endVertexId;
      });
    let start = map.point(c.start);
    if (collapsed && contourClosed(c) && c.segments.every((s) => s.type !== "bezier")) {
      const interval = collapsedInterval([
        start,
        ...segments.map((s) => s.end)
      ]);
      start = interval[0];
      segments = sameSketchPoint(...interval) ? [] : [{ type: "line", end: interval[1] }];
    }
    return {
      type: "path",
      start,
      segments,
      ...!collapsed && c.startVertexId !== void 0 ? { startVertexId: c.startVertexId } : {},
      ...flags,
      ...collapsed ? { hole: false } : {}
    };
  });
  const result = { type: "drawing", contours };
  validateSketchDrawing(result);
  return result;
}
function profileSketchFrame(feature) {
  if (feature.frame) return structuredClone(feature.frame);
  const normal = feature.plane === "XY" ? [0, 0, 1] : feature.plane === "XZ" ? [0, -1, 0] : [1, 0, 0];
  return {
    originMillimeters: normal.map(
      (v) => v * feature.offsetMillimeters
    ),
    normal,
    xDirection: feature.plane === "YZ" ? [0, 1, 0] : [1, 0, 0]
  };
}
function resolveProfileDrawing(features, featureId) {
  const cache = /* @__PURE__ */ new Map();
  const resolve2 = (id2, before, depth) => {
    if (depth > 256)
      throw Error("Projection dependency chain exceeds 256 profiles.");
    const index = features.findIndex((f) => f.id === id2), feature = features[index];
    if (index < 0 || index >= before || feature.type !== "profile")
      throw Error(
        `Broken projection reference: ${id2} must be an earlier profile.`
      );
    if (feature.suppressed)
      throw Error(`Projection source is suppressed: ${feature.name} (${id2}).`);
    const hit = cache.get(id2);
    if (hit) return hit;
    const p = feature.profile;
    let drawing;
    if (p.type === "projection") {
      const input = resolve2(p.sourceFeatureId, index, depth + 1), source = features.find(
        (f) => f.id === p.sourceFeatureId
      );
      const selected = p.sourceContourId === void 0 ? input.contours : input.contours.filter((c) => c.id === p.sourceContourId);
      if (p.sourceContourId !== void 0 && selected.length !== 1) throw Error(`Broken projection contour reference: ${p.sourceContourId} in ${source.name}.`);
      drawing = projectSketchDrawing(
        { type: "drawing", contours: selected },
        profileSketchFrame(source),
        profileSketchFrame(feature)
      );
      drawing = composeProjectedDrawing(drawing, p.authored && withPierceContext(features, id2, p.authored, (sourceId) => resolve2(sourceId, index, depth + 1)));
    } else if (p.type === "drawing") drawing = solveDrawingConstraints(withPierceContext(features, id2, p, (sourceId) => resolve2(sourceId, index, depth + 1)));
    else if (p.type === "circle")
      drawing = {
        type: "drawing",
        contours: [
          {
            type: "circle",
            center: [...p.centerMillimeters],
            radius: p.radiusMillimeters
          }
        ]
      };
    else
      drawing = {
        type: "drawing",
        contours: [
          {
            type: "path",
            start: [...p.pointsMillimeters[0]],
            segments: [
              ...p.pointsMillimeters.slice(1),
              p.pointsMillimeters[0]
            ].map((end) => ({ type: "line", end: [...end] }))
          }
        ]
      };
    cache.set(id2, drawing);
    return drawing;
  };
  return resolve2(featureId, features.length, 0);
}
class PierceReferenceError extends Error {
  constructor(message) {
    super(message);
    this.name = "PierceReferenceError";
  }
}
const dot = (a, b) => a.reduce((sum, value2, i) => sum + value2 * b[i], 0);
const cross$3 = (a, b) => [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
const value = (coefficients, t) => coefficients.reduceRight((sum, n) => sum * t + n, 0);
const unique = (values) => values.sort((a, b) => a - b).filter((t, i, list) => i === 0 || Math.abs(t - list[i - 1]) > 8 * Number.EPSILON);
function distanceRoots(coefficients) {
  const scale = Math.max(...coefficients.map(Math.abs)), c = coefficients.map((v) => v / scale);
  while (c.length > 1 && c.at(-1) === 0) c.pop();
  if (c.length === 1) return [];
  if (c.length === 2) {
    const t = -c[0] / c[1];
    return t >= -1e-12 && t <= 1 + 1e-12 ? [Math.max(0, Math.min(1, t))] : [];
  }
  const critical = distanceRoots(c.slice(1).map((v, i) => v * (i + 1))), bounds = unique([0, ...critical, 1]);
  const zero = (t) => Math.abs(value(c, t)) <= Number.EPSILON * 16 * c.reduce((sum, v, i) => sum + Math.abs(v * t ** i), 0);
  const roots2 = bounds.filter(zero);
  for (let i = 1; i < bounds.length; i++) {
    let a = bounds[i - 1], b = bounds[i], fa = value(c, a);
    if (zero(a) || zero(b) || fa * value(c, b) >= 0) continue;
    for (let iteration = 0; iteration < 60; iteration++) {
      const middle = (a + b) / 2, fm = value(c, middle);
      if (fa * fm <= 0) b = middle;
      else {
        a = middle;
        fa = fm;
      }
    }
    roots2.push((a + b) / 2);
  }
  return unique(roots2);
}
function polynomialDirection(coefficients, t) {
  let derivative2 = coefficients;
  for (let order = 1; order < coefficients.length; order++) {
    derivative2 = derivative2.slice(1).map((v, i) => v * (i + 1));
    const slope = value(derivative2, t);
    if (Math.abs(slope) > Number.EPSILON * 128 * derivative2.reduce((sum, v, i) => sum + Math.abs(v * t ** i), 0)) return order % 2 ? slope > 0 ? 1 : -1 : 0;
  }
  return 0;
}
function pierceCurvePlane(curve, source, target) {
  const map = sketchFrameMap(source, target);
  validateSketchDrawing({ type: "drawing", contours: [curve.type === "circle" ? curve : { type: "path", start: curve.start, segments: [curve.segment] }] });
  const y = cross$3(source.normal, source.xDirection), delta2 = source.originMillimeters.map((v, i) => v - target.originMillimeters[i]);
  const a = dot(source.xDirection, target.normal), b = dot(y, target.normal), c = dot(delta2, target.normal);
  const depth = (p) => a * p[0] + b * p[1] + c;
  const world = (p) => source.originMillimeters.map((v, i) => v + source.xDirection[i] * p[0] + y[i] * p[1]);
  let coefficients, frame, poleDepths = [];
  if (curve.type === "circle") frame = { center: curve.center, radiusX: curve.radius, radiusY: curve.radius, rotation: 0, startAngle: 0, sweep: 2 * Math.PI };
  else {
    const s = curve.segment, d0 = depth(curve.start), d1 = depth(s.end);
    if (s.type === "line") {
      coefficients = [d0, d1 - d0];
      poleDepths = [d0, d1];
    } else if (s.type === "bezier") {
      const u = depth(s.controls[0]), v = depth(s.controls[1]);
      coefficients = [d0, 3 * (u - d0), 3 * (v - 2 * u + d0), d1 - 3 * v + 3 * u - d0];
      poleDepths = [d0, u, v, d1];
    } else if (s.type === "conic") {
      const r = s.rho, w = 1 - r, u = depth(s.control);
      coefficients = [w * d0, 2 * (r * u - w * d0), w * (d0 + d1) - 2 * r * u];
      poleDepths = [d0, u, d1];
    } else if (s.type === "ellipse") frame = ellipseFrame(curve.start, s);
    else {
      const arc = sketchArcGeometry(curve.start, s.middle, s.end);
      frame = { ...arc, radiusX: arc.radius, radiusY: arc.radius, rotation: 0 };
    }
  }
  const at = (t) => curve.type === "circle" ? ellipsePoint(frame, t) : segmentPoint(curve.start, curve.segment, t);
  let parameters, direction;
  if (coefficients) {
    if (poleDepths.every((depth2) => Math.abs(depth2) < 1e-10)) throw new PierceReferenceError("The selected curve lies in the sketch plane; Pierce needs an isolated intersection.");
    parameters = distanceRoots(coefficients);
    direction = (t) => polynomialDirection(coefficients, t);
  } else {
    const f = frame, cos = Math.cos(f.rotation), sin = Math.sin(f.rotation);
    const x = f.radiusX * (a * cos + b * sin), y2 = f.radiusY * (-a * sin + b * cos), offset = depth(f.center), radius = Math.hypot(x, y2);
    if (radius < 1e-12) {
      if (Math.abs(offset) < 1e-10) throw new PierceReferenceError("The selected curve lies in the sketch plane; Pierce needs an isolated intersection.");
      return [];
    }
    const ratio = -offset / radius;
    if (ratio < -1 - 1e-12 || ratio > 1 + 1e-12) return [];
    const phase = Math.atan2(y2, x), angle2 = Math.acos(Math.max(-1, Math.min(1, ratio)));
    const low = Math.min(f.startAngle, f.startAngle + f.sweep), high = Math.max(f.startAngle, f.startAngle + f.sweep);
    parameters = [];
    for (const base of [phase - angle2, phase + angle2]) for (let turn = Math.ceil((low - base - 1e-10) / (2 * Math.PI)); turn <= Math.floor((high - base + 1e-10) / (2 * Math.PI)); turn++) {
      const t = (base + turn * 2 * Math.PI - f.startAngle) / f.sweep;
      if (t >= -1e-9 && t <= 1 + 1e-9) parameters.push(Math.max(0, Math.min(1, t)));
    }
    direction = (t) => {
      const angle22 = f.startAngle + t * f.sweep, slope = (-x * Math.sin(angle22) + y2 * Math.cos(angle22)) * f.sweep;
      return Math.abs(slope) < radius * Math.abs(f.sweep) * 1e-9 ? 0 : slope > 0 ? 1 : -1;
    };
  }
  parameters = unique(parameters);
  if (curve.type === "circle" && parameters.length > 1 && parameters[0] < 1e-13 && parameters.at(-1) > 1 - 1e-13 && Math.hypot(...at(parameters[0]).map((v, i) => v - at(parameters.at(-1))[i])) < 1e-7) parameters.pop();
  return parameters.map((parameter2) => {
    const p = at(parameter2);
    if (Math.abs(depth(p)) > 1e-7) throw Error("The curve-plane contact could not be resolved accurately.");
    return { parameter: parameter2, point: map.point(p), worldPoint: world(p), direction: direction(parameter2) };
  });
}
function branchCounts(hits) {
  return [-1, 0, 1].map((direction) => hits.filter((hit) => hit.direction === direction).length);
}
function resolvePierceBranch(hits, branch) {
  if (!branch || ![-1, 0, 1].includes(branch.direction) || !Number.isInteger(branch.ordinal) || branch.ordinal < 0 || !Array.isArray(branch.counts) || branch.counts.length !== 3 || branch.counts.some((n) => !Number.isInteger(n) || n < 0) || branch.ordinal >= branch.counts[branch.direction + 1]) throw Error("Invalid Pierce intersection reference. Reselect the source curve.");
  if (branchCounts(hits).some((n, i) => n !== branch.counts[i])) throw new PierceReferenceError("The Pierce intersection disappeared or changed branches. Reselect its source intersection.");
  const hit = hits.filter((h) => h.direction === branch.direction)[branch.ordinal];
  if (!hit) throw new PierceReferenceError("The Pierce intersection is unavailable.");
  return hit;
}
function sketchPierceContacts(features, targetFeatureId, source, resolveDrawing = (id2) => resolveProfileDrawing(features, id2)) {
  if (!source || source.kind !== "sketch-curve" || typeof source.sourceFeatureId !== "string" || typeof source.sourceContourId !== "string" || !source.sourceContourId.trim()) throw Error("Invalid Pierce source reference.");
  const targetIndex = features.findIndex((f) => f.id === targetFeatureId), sourceIndex = features.findIndex((f) => f.id === source.sourceFeatureId);
  const target = features[targetIndex], feature = features[sourceIndex];
  if (target?.type !== "profile" || sourceIndex < 0 || sourceIndex >= targetIndex || feature.type !== "profile") throw Error("Pierce must reference an earlier source sketch.");
  if (features.filter((f) => f.id === source.sourceFeatureId).length !== 1 || features.filter((f) => f.id === targetFeatureId).length !== 1) throw Error("Invalid Pierce source reference.");
  if (feature.suppressed) throw Error(`Pierce source is suppressed: ${feature.name}.`);
  const contours = resolveDrawing(feature.id).contours.filter((c) => c.id === source.sourceContourId);
  if (contours.length !== 1) throw new PierceReferenceError("The Pierce source contour is missing or ambiguous. Reselect it.");
  const contour = contours[0];
  let curve;
  if (contour.type === "circle") {
    if (source.sourceSegmentId !== void 0) throw new PierceReferenceError("The Pierce source curve changed type. Reselect it.");
    curve = contour;
  } else {
    if (!source.sourceSegmentId?.trim()) throw new PierceReferenceError("The Pierce source curve changed type. Reselect an identified source segment.");
    const indices = contour.segments.flatMap((s, i) => s.id === source.sourceSegmentId ? [i] : []);
    if (indices.length !== 1) throw new PierceReferenceError("The Pierce source segment is missing or ambiguous. Reselect it.");
    const index = indices[0];
    curve = { type: "segment", start: index ? contour.segments[index - 1].end : contour.start, segment: contour.segments[index] };
  }
  return pierceCurvePlane(curve, profileSketchFrame(feature), profileSketchFrame(target));
}
function resolveSketchPierce(features, targetFeatureId, reference, resolveDrawing) {
  return resolvePierceBranch(sketchPierceContacts(features, targetFeatureId, reference, resolveDrawing), reference.branch);
}
function validatePierceConstraint(c) {
  if (c.kind !== "pierce") {
    if (c.source !== void 0) throw Error("A Pierce source requires a Pierce constraint.");
    return;
  }
  const s = c.source, b = s?.branch;
  const id2 = (v) => typeof v === "string" && !!v.trim() && v.length <= 128;
  if (!s || s.kind !== "sketch-curve" || !id2(s.sourceFeatureId) || !id2(s.sourceContourId) || s.sourceSegmentId !== void 0 && !id2(s.sourceSegmentId) || !b || ![-1, 0, 1].includes(b.direction) || !Number.isInteger(b.ordinal) || b.ordinal < 0 || !Array.isArray(b.counts) || b.counts.length !== 3 || !b.counts.every((n) => Number.isInteger(n) && n >= 0) || b.ordinal >= b.counts[b.direction + 1])
    throw Error("Pierce needs a valid stable source and selected intersection branch.");
  if (!c.a || c.a.projectedContourId !== void 0 || Object.keys(c).some((key) => !["id", "kind", "a", "source"].includes(key)))
    throw Error("Pierce constrains one editable point or curve to its external source.");
}
function sameSource(a, b) {
  return a.kind === b.kind && a.sourceFeatureId === b.sourceFeatureId && a.sourceContourId === b.sourceContourId && a.sourceSegmentId === b.sourceSegmentId && a.branch.direction === b.branch.direction && a.branch.ordinal === b.branch.ordinal && a.branch.counts.every((n, i) => n === b.branch.counts[i]);
}
function pierceContextPoint(drawing, c) {
  validatePierceConstraint(c);
  const context = drawing.pierceContext?.[c.id];
  if (!context || !context.source || !sameSource(context.source, c.source) || !Array.isArray(context.point) || context.point.length !== 2 || !context.point.every(Number.isFinite))
    throw Error("Pierce source context is missing or stale. Resolve the sketch in its document.");
  return context.point;
}
function withPierceContext(features, targetId, drawing, resolveDrawing) {
  const next = structuredClone(drawing);
  delete next.pierceContext;
  for (const c of next.constraints ?? []) {
    validatePierceConstraint(c);
    if (c.kind !== "pierce") continue;
    const hit = resolveSketchPierce(features, targetId, c.source, resolveDrawing);
    (next.pierceContext ??= /* @__PURE__ */ Object.create(null))[c.id] = { source: structuredClone(c.source), point: [...hit.point] };
  }
  return next;
}
function pierceDependencies(drawing) {
  return [...new Set((drawing.constraints ?? []).filter((c) => c.kind === "pierce").map((c) => c.source?.sourceFeatureId ?? "missing-pierce-source"))];
}
function localPierceValidation(drawing) {
  if (drawing.pierceContext !== void 0) throw Error("Resolved Pierce context must not be saved.");
  if (drawing.constraints?.some((c) => c.kind === "pierce")) {
    const ids = drawing.constraints.map((c) => c.id);
    if (ids.length > 512 || new Set(ids).size !== ids.length || ids.some((id2) => typeof id2 !== "string" || !id2.trim())) throw Error("Invalid or duplicate sketch constraint identities.");
  }
  for (const c of drawing.constraints ?? []) {
    validatePierceConstraint(c);
    if (c.kind === "pierce") resolve(drawing, c.a);
  }
  return { ...drawing, constraints: drawing.constraints?.filter((c) => c.kind !== "pierce") };
}
const rollbackPosition = (doc) => doc.rollbackIndex ?? doc.features.length;
function bodyIDForFeature(doc, feature) {
  if ((feature.type === "extrude" || feature.type === "revolve" || feature.type === "sweep" || feature.type === "loft" || feature.type === "import-step" || feature.type === "import-cad") && feature.bodyId)
    return feature.bodyId;
  const first = doc.features.find(
    (f) => (f.type === "extrude" || f.type === "revolve" || f.type === "sweep" || f.type === "loft" || f.type === "import-step" || f.type === "import-cad") && f.operation === "new"
  );
  return first?.id === feature.id ? `${doc.documentId}:body-1` : `${doc.documentId}:body-${feature.id}`;
}
function bodyIDsForFeature(doc, feature) {
  if (feature.type === "transform") return feature.copyBodyIds ? feature.bodyIds.map((id2) => feature.copyBodyIds[id2]) : [];
  return feature.type === "extrude" && feature.separateBodies && feature.bodyOutputs ? feature.bodyOutputs : [bodyIDForFeature(doc, feature)];
}
function createdBodyIDs(doc, feature) {
  return feature.type === "transform" && feature.copyBodyIds ? bodyIDsForFeature(doc, feature) : "operation" in feature && feature.operation === "new" ? bodyIDsForFeature(doc, feature) : [];
}
function consumedBodyIDs(feature) {
  if (feature.suppressed) return [];
  if (feature.type === "extrude" && feature.scopeMode === "all") return scopeConsumedBodies(feature.scopeResolution);
  if (feature.type === "boolean" && !feature.keepTools) return feature.toolBodyIds;
  return feature.type === "extrude" && feature.operation === "add" ? feature.targetBodyIds?.slice(1) ?? [] : [];
}
function stableBodies(doc) {
  let targetBody;
  return {
    ...structuredClone(doc),
    features: doc.features.map((f) => {
      const feature = structuredClone(f);
      if (feature.type === "extrude" && feature.scopeMode === "all") {
        if (!feature.suppressed) targetBody = feature.scopeResolution?.groups.at(-1)?.bodyId ?? targetBody;
        return feature;
      }
      if (feature.type === "transform") {
        if (!feature.suppressed && feature.copyBodyIds) targetBody = bodyIDsForFeature(doc, feature).at(-1);
        return feature;
      }
      if (feature.type === "offset-face") return feature;
      if (consumedBodyIDs(feature).length && "targetBodyId" in feature) targetBody = feature.targetBodyId;
      if ((feature.type === "extrude" || feature.type === "revolve" || feature.type === "sweep" || feature.type === "loft" || feature.type === "import-step" || feature.type === "import-cad") && feature.operation === "new") {
        targetBody = bodyIDsForFeature(doc, feature).at(-1);
        return { ...feature, bodyId: bodyIDForFeature(doc, feature) };
      }
      if (!["profile", "sketch", "plane"].includes(feature.type) && targetBody)
        return { ...feature, targetBodyId: "targetBodyId" in feature && feature.targetBodyId || targetBody };
      return feature;
    })
  };
}
function featureDependencies(doc, includeSuppressedModifiers = false) {
  const result = /* @__PURE__ */ new Map(), bodyProducers = /* @__PURE__ */ new Map();
  let lastBody;
  for (const f of doc.features) {
    const refs = [];
    if (f.type === "plane" && f.definition) {
      const visit = (value2) => {
        if (!value2 || typeof value2 !== "object") return;
        const ref = value2;
        if (ref.kind === "feature") refs.push(String(ref.featureId));
        if (["face", "point", "axis"].includes(String(ref.kind))) refs.push(bodyProducers.get(String(ref.partId)) ?? `body:${ref.partId}`);
        Object.values(ref).forEach(visit);
      };
      visit(f.definition);
    }
    if (f.type === "transform") {
      refs.push(...transformReferences(f.transform).map((ref) => ref.sourceFeatureId));
      refs.push(...f.bodyIds.map((id2) => bodyProducers.get(id2) ?? `body:${id2}`));
      if (!f.suppressed || includeSuppressedModifiers) {
        for (const id2 of f.copyBodyIds ? bodyIDsForFeature(doc, f) : f.bodyIds) bodyProducers.set(id2, f.id);
        if (f.copyBodyIds) lastBody = bodyIDsForFeature(doc, f).at(-1);
      }
      result.set(f.id, [...new Set(refs)]);
      continue;
    }
    if (f.type === "offset-face") {
      refs.push(...f.faces.map((face) => face.sourceFeatureId));
      if (f.transform) refs.push(...transformReferences(f.transform).map((ref) => ref.sourceFeatureId));
    }
    if (f.type === "profile" && f.support) refs.push(f.support.sourceFeatureId);
    if (f.type === "profile") {
      const drawing = f.profile.type === "drawing" ? f.profile : f.profile.type === "projection" ? f.profile.authored : void 0;
      if (drawing) refs.push(...pierceDependencies(drawing));
    }
    if (f.type === "extrude" && f.startingReference && f.startingReference.kind !== "principal") refs.push(f.startingReference.sourceFeatureId);
    if (f.type === "extrude") {
      for (const end of [f, f.secondEnd]) if (end?.endType === "up-to-vertex" && end.endPointReference) refs.push(end.endPointReference.sourceFeatureId);
    }
    if (f.type === "extrude" && f.directionReference) refs.push(f.directionReference.sourceFeatureId);
    if (f.type === "extrude") {
      for (const end of [f, f.secondEnd]) if (end?.endType === "up-to-part" && end.endPartId) refs.push(bodyProducers.get(end.endPartId) ?? `body:${end.endPartId}`);
    }
    if (f.type === "boolean") refs.push(...f.toolBodyIds.map((id2) => bodyProducers.get(id2) ?? `body:${id2}`));
    if (f.type === "loft") refs.push(...f.sections.map((section) => section.profileFeatureId));
    if ("profileFeatureId" in f) refs.push(f.profileFeatureId);
    if (f.type === "extrude" && f.endType === "up-to-face" && f.endReference) refs.push(f.endReference.sourceFeatureId);
    if (f.type === "extrude" && f.secondEnd?.endType === "up-to-face" && f.secondEnd.endReference) refs.push(f.secondEnd.endReference.sourceFeatureId);
    if (f.type === "extrude" && (f.endType === "up-to-next" || f.secondEnd?.endType === "up-to-next")) refs.push(...bodyProducers.values());
    if (f.type === "extrude" && f.profileSelections) refs.push(...f.profileSelections.map((p) => p.profileFeatureId));
    if ("pathFeatureId" in f) refs.push(f.pathFeatureId);
    if ("sourceFeatureId" in f) refs.push(f.sourceFeatureId);
    if (f.type === "profile" && f.profile.type === "projection") refs.push(f.profile.sourceFeatureId);
    if ((f.type === "extrude" || f.type === "revolve" || f.type === "sweep" || f.type === "loft" || f.type === "import-step" || f.type === "import-cad") && f.operation === "new") {
      for (const id2 of bodyIDsForFeature(doc, f)) {
        lastBody = id2;
        bodyProducers.set(id2, f.id);
      }
    } else if (f.type === "extrude" && f.scopeMode === "all") {
      if (!f.suppressed || includeSuppressedModifiers) for (const id2 of bodyProducers.keys()) bodyProducers.set(id2, f.id);
      if (!f.suppressed) lastBody = f.scopeResolution?.groups.at(-1)?.bodyId ?? lastBody;
    } else if (!["sketch", "profile", "plane"].includes(f.type)) {
      const body = "targetBodyId" in f && f.targetBodyId ? f.targetBodyId : lastBody;
      const targets = f.type === "offset-face" ? offsetFaceBodies(f) : f.type === "extrude" && f.targetBodyIds ? f.targetBodyIds : [body];
      for (const target of targets) {
        refs.push((target && bodyProducers.get(target)) ?? `body:${target ?? "missing"}`);
        const mergedIntoPrimary = f.type === "extrude" && f.operation === "add" && f.targetBodyIds && target !== body;
        if (target && !mergedIntoPrimary && (!f.suppressed || includeSuppressedModifiers)) bodyProducers.set(target, f.id);
      }
    }
    const consumed = consumedBodyIDs(f);
    if (consumed.length && !(f.type === "extrude" && f.scopeMode === "all")) {
      for (const id2 of consumed) bodyProducers.delete(id2);
      lastBody = "targetBodyId" in f ? f.targetBodyId : lastBody;
    }
    result.set(f.id, [...new Set(refs)]);
  }
  return result;
}
function dependentFeatures(doc, id2) {
  const affected = /* @__PURE__ */ new Set([id2]);
  for (const [key, refs] of featureDependencies(doc))
    if (refs.some((r) => affected.has(r))) affected.add(key);
  return affected;
}
function setFeatureSuppressed(doc, id2, suppressed) {
  const next = structuredClone(doc), affected = suppressed ? dependentFeatures(doc, id2) : /* @__PURE__ */ new Set([id2]);
  if (!suppressed) {
    const deps = featureDependencies(doc, true);
    const visit = (key) => {
      for (const ref of deps.get(key) ?? [])
        if (!affected.has(ref)) {
          affected.add(ref);
          visit(ref);
        }
    };
    visit(id2);
  }
  next.features = next.features.map(
    (f) => affected.has(f.id) ? { ...f, suppressed } : f
  );
  validatePartDocument(next);
  return next;
}
function insertFeature(doc, feature) {
  const next = stableBodies(doc), index = rollbackPosition(doc);
  if ((feature.type === "extrude" || feature.type === "revolve" || feature.type === "sweep" || feature.type === "loft" || feature.type === "import-step" || feature.type === "import-cad") && feature.operation === "new")
    feature = {
      ...feature,
      bodyId: feature.bodyId ?? (doc.features.some(
        (f) => (f.type === "extrude" || f.type === "revolve" || f.type === "sweep" || f.type === "loft" || f.type === "import-step" || f.type === "import-cad") && f.operation === "new"
      ) ? `${doc.documentId}:body-${feature.id}` : `${doc.documentId}:body-1`)
    };
  next.features.splice(index, 0, feature);
  if (doc.rollbackIndex !== void 0) next.rollbackIndex = index + 1;
  validatePartDocument(next);
  return next;
}
function moveFeature(doc, id2, delta2) {
  const next = stableBodies(doc), index = next.features.findIndex((f) => f.id === id2), target = index + delta2;
  if (index < 0 || target < 0 || target >= next.features.length)
    throw new Error("Choose a position inside the feature history.");
  const [feature] = next.features.splice(index, 1);
  next.features.splice(target, 0, feature);
  validatePartDocument(next);
  return next;
}
function availableBodies(doc) {
  const errors = featureReferenceErrors(doc);
  const consumed = new Set(doc.features.slice(0, rollbackPosition(doc)).flatMap((f) => !errors.has(f.id) ? consumedBodyIDs(f) : []));
  return doc.features.slice(0, rollbackPosition(doc)).filter(
    (f) => !f.suppressed && !errors.has(f.id) && createdBodyIDs(doc, f).length > 0
  ).flatMap((f) => bodyIDsForFeature(doc, f)).filter((id2) => !consumed.has(id2)).map((id2) => ({
    id: id2,
    name: doc.bodyProperties?.[id2]?.name ?? `Body ${doc.features.flatMap((f) => createdBodyIDs(doc, f)).indexOf(id2) + 1}`,
    visible: doc.bodyProperties?.[id2]?.visible ?? true
  }));
}
function pierceReferenceFailure(features, feature, resolveDrawing) {
  if (feature.type !== "profile") return;
  const drawing = feature.profile.type === "drawing" ? feature.profile : feature.profile.type === "projection" ? feature.profile.authored : void 0;
  for (const constraint of drawing?.constraints ?? []) {
    if (constraint.kind !== "pierce") continue;
    validatePierceConstraint(constraint);
    try {
      resolveSketchPierce(features, feature.id, constraint.source, resolveDrawing);
    } catch (error) {
      if (!(error instanceof PierceReferenceError)) throw error;
      return `Pierce reference unavailable (${constraint.id}): ${error.message}`;
    }
  }
}
function featureReferenceErrors(document, failures = /* @__PURE__ */ new Map()) {
  const errors = /* @__PURE__ */ new Map();
  const earlier = /* @__PURE__ */ new Map();
  const names = new Map(document.features.map((f) => [f.id, f.name]));
  const dependencies = featureDependencies(document);
  const drawings = /* @__PURE__ */ new Map();
  const resolveDrawing = (id2) => {
    let drawing = drawings.get(id2);
    if (!drawing) {
      drawing = resolveProfileDrawing(document.features, id2);
      drawings.set(id2, drawing);
    }
    return drawing;
  };
  for (const feature of document.features.slice(0, rollbackPosition(document))) {
    if (!feature.suppressed) {
      const dependency = dependencies.get(feature.id)?.find((id2) => !earlier.get(id2));
      const reason = failures.get(feature.id) ?? (dependency ? names.has(dependency) ? `Reference unavailable: ${names.get(dependency)}. Restore or repair that feature.` : `Missing reference: ${dependency}. Restore the deleted feature or select a new reference.` : void 0) ?? pierceReferenceFailure(document.features, feature, resolveDrawing);
      if (reason) errors.set(feature.id, reason);
    }
    earlier.set(feature.id, !feature.suppressed && !errors.has(feature.id));
  }
  return errors;
}
function validateExtrusionFaceReference(ref, earlier, missing) {
  validateSolidFaceReference(ref, earlier, missing, "Up to face");
}
function resolveSketchTextExpression(expression, variables = /* @__PURE__ */ new Map()) {
  return normalizeSketchText(
    expressionText(
      evaluateExpression(expression, {
        resolveVariable(name) {
          const value2 = variables.get(name);
          if (value2 === void 0) throw Error(`Unknown variable #${name}.`);
          return value2;
        }
      })
    )
  );
}
function authoredTextDrawing(feature) {
  if (feature.type !== "profile") return void 0;
  if (feature.profile.type === "drawing") return feature.profile;
  if (feature.profile.type === "projection") return feature.profile.authored;
  return void 0;
}
function validateDocumentTextExpressions(features, variables) {
  for (const feature of features) {
    const drawing = authoredTextDrawing(feature);
    for (const constraint of drawing?.constraints ?? []) {
      if (constraint.valueExpression === void 0) continue;
      const expected = resolveDimensionExpression(
        constraint,
        constraint.valueExpression,
        variables
      );
      if (constraint.value !== expected)
        throw Error(
          `Stale dimension expression in ${feature.name} (${constraint.id}). Regenerate before saving.`
        );
    }
    for (const item of drawing?.textItems ?? []) {
      if (item.expression === void 0) continue;
      const expected = resolveSketchTextExpression(item.expression, variables);
      if (expected !== item.text)
        throw Error(
          `Stale text expression in ${feature.name} (${item.id}). Regenerate text before saving.`
        );
    }
  }
}
function evaluateDocumentVariables(value2) {
  if (value2 === void 0) return /* @__PURE__ */ new Map();
  if (!Array.isArray(value2) || value2.length > 256)
    throw Error("A Part supports at most 256 variables.");
  const definitions = /* @__PURE__ */ new Map();
  for (const variable of value2) {
    if (!variable || typeof variable.name !== "string" || !/^[A-Za-z_][A-Za-z0-9_]{0,63}$/.test(variable.name) || definitions.has(variable.name))
      throw Error(
        "Variable names must be unique identifiers of at most 64 characters."
      );
    if (!["number", "length", "angle", "string"].includes(variable.kind) || typeof variable.expression !== "string")
      throw Error(`Invalid definition for #${variable.name}.`);
    definitions.set(variable.name, variable);
  }
  const resolved = /* @__PURE__ */ new Map(), active = /* @__PURE__ */ new Set();
  const resolve2 = (name) => {
    const cached = resolved.get(name);
    if (cached !== void 0) return cached;
    const variable = definitions.get(name);
    if (!variable) throw Error(`Unknown variable #${name}.`);
    if (active.has(name))
      throw Error(`Circular variable dependency at #${name}.`);
    if (active.size >= 64)
      throw Error("Variable dependencies are nested too deeply.");
    active.add(name);
    try {
      const result = evaluateExpression(variable.expression, {
        resolveVariable: resolve2
      });
      if (variable.kind === "string") {
        if (typeof result !== "string")
          throw Error(`#${name} must resolve to text.`);
      } else {
        const expected = quantity(
          0,
          variable.kind === "length" ? 1 : 0,
          variable.kind === "angle" ? 1 : 0
        );
        if (!sameUnits(numeric(result), expected))
          throw Error(`#${name} has incompatible units for ${variable.kind}.`);
      }
      resolved.set(name, result);
      return result;
    } finally {
      active.delete(name);
    }
  };
  for (const name of definitions.keys()) resolve2(name);
  return resolved;
}
function validateSketchPresentation(value2) {
  if (value2 === void 0) return;
  if (!value2 || typeof value2 !== "object" || Array.isArray(value2))
    throw Error("Invalid sketch presentation metadata.");
  for (const item of Object.values(value2)) {
    const positions = item?.dimensionLabelPositionsMillimeters;
    if (!positions || typeof positions !== "object" || Array.isArray(positions))
      throw Error("Invalid dimension label positions.");
    for (const point2 of Object.values(positions))
      if (!Array.isArray(point2) || point2.length !== 2 || !point2.every((n) => typeof n === "number" && Number.isFinite(n)))
        throw Error("Dimension label coordinates must be finite millimeters.");
  }
}
const cadImportExtensions = {
  step: ["step", "stp"],
  iges: ["iges", "igs"],
  brep: ["brep", "brp"],
  stl: ["stl"],
  obj: ["obj"],
  ply: ["ply"],
  off: ["off"]
};
const isMeshImportFormat = (format) => ["stl", "obj", "ply", "off"].includes(format);
function validateImportCAD(feature) {
  if (feature.operation !== "new" || typeof feature.bodyId !== "string" || !feature.bodyId.trim()) throw Error("CAD import needs a unique body identity.");
  const extensions = cadImportExtensions[feature.format];
  if (!Array.isArray(extensions) || typeof feature.sourceName !== "string" || !extensions.includes(feature.sourceName.split(".").at(-1).toLowerCase())) throw Error("CAD import format must match its source filename.");
  if (typeof feature.dataBase64 !== "string" || !feature.dataBase64.length || feature.dataBase64.length > 4 * 1024 * 1024 || feature.dataBase64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(feature.dataBase64) || /=/.test(feature.dataBase64.slice(0, -2)) || /=[^=]$/.test(feature.dataBase64)) throw Error("Invalid CAD source (maximum 3 MiB per import).");
  if (isMeshImportFormat(feature.format)) {
    if (!["reference", "solid"].includes(feature.meshMode ?? "") || !["mm", "cm", "m", "in", "ft"].includes(feature.meshUnits ?? "")) throw Error("Mesh imports need explicit units and a mesh or solid interpretation.");
  } else if (feature.meshMode !== void 0 || feature.meshUnits !== void 0) throw Error("Exact CAD imports use their source units, without mesh conversion settings.");
}
function validateFaceExtrude(feature, earlier, missingReference) {
  validatePlanarFaceAnchor(feature.faceAnchor);
  if (typeof feature.sourceFeatureId !== "string" || !feature.sourceFeatureId.trim() || !earlier.has(feature.sourceFeatureId) && !missingReference(feature.sourceFeatureId)) throw Error("Push/Pull needs an earlier source feature.");
  if (["profile", "sketch", "plane"].includes(earlier.get(feature.sourceFeatureId) ?? "")) throw Error("Push/Pull source must be a solid feature.");
  if (typeof feature.targetBodyId !== "string" || !feature.targetBodyId.trim()) throw Error("Push/Pull needs a target body.");
  if (!Array.isArray(feature.normal) || feature.normal.length !== 3 || !feature.normal.every(Number.isFinite) || Math.abs(Math.hypot(...feature.normal) - 1) > 1e-6) throw Error("Push/Pull needs a valid planar face normal.");
  if (typeof feature.faceLabel !== "string" || !feature.faceLabel.trim()) throw Error("Push/Pull needs a face label.");
  if (!Number.isFinite(feature.distanceMillimeters) || Math.abs(feature.distanceMillimeters) < 1e-6) throw Error("Push/Pull distance must be finite and nonzero.");
}
function validateBoolean(feature) {
  if (!["union", "cut", "intersection"].includes(feature.operation))
    throw new Error("Choose Union, Cut or Intersection.");
  if (typeof feature.targetBodyId !== "string" || !feature.targetBodyId.trim())
    throw new Error("Boolean needs a target body.");
  if (!Array.isArray(feature.toolBodyIds) || !feature.toolBodyIds.length || feature.toolBodyIds.some((id2) => typeof id2 !== "string" || !id2.trim() || id2 === feature.targetBodyId) || new Set(feature.toolBodyIds).size !== feature.toolBodyIds.length)
    throw new Error("Choose distinct tool bodies different from the target.");
  if (typeof feature.keepTools !== "boolean") throw new Error("Invalid Keep tools setting.");
}
const patternSourceTypes = ["extrude", "revolve", "sweep", "loft", "hole"];
function validatePattern(feature, earlier, missing) {
  if (typeof feature.sourceFeatureId !== "string" || !missing(feature.sourceFeatureId) && !patternSourceTypes.includes(earlier.get(feature.sourceFeatureId) ?? ""))
    throw new Error("Pattern must reference an earlier additive or subtractive feature.");
  if (!Number.isInteger(feature.count) || feature.count < 2) throw new Error("Pattern needs at least two occurrences, including the original.");
  if (!["X", "Y", "Z"].includes(feature.axis) || typeof feature.reversed !== "boolean") throw new Error("Invalid pattern axis or direction.");
  if (feature.patternType === "linear") {
    if (!Number.isFinite(feature.spacingMillimeters) || feature.spacingMillimeters <= 0) throw new Error("Pattern spacing must be positive.");
  } else if (feature.patternType === "polar") {
    if (!Number.isFinite(feature.angleDegrees) || feature.angleDegrees <= 0 || feature.angleDegrees > 360) throw new Error("Pattern angle must be greater than 0 and at most 360 degrees.");
  } else throw new Error("Unknown pattern type.");
}
function validateDraft(feature) {
  for (const reference of [feature.facePlane, feature.neutralPlane]) {
    if (!reference || !["XY", "XZ", "YZ"].includes(reference.plane) || !Number.isFinite(reference.offsetMillimeters))
      throw new Error("Draft needs finite face and neutral plane references.");
  }
  if (!Number.isFinite(feature.angleDegrees) || feature.angleDegrees <= 0 || feature.angleDegrees >= 90)
    throw new Error("Draft angle must be greater than 0 and less than 90 degrees.");
  if (typeof feature.reversed !== "boolean") throw new Error("Invalid draft direction.");
}
function validateLoft(feature, earlier, missing) {
  if (!Array.isArray(feature.sections) || feature.sections.length < 2)
    throw new Error("Loft needs at least two ordered sketch sections.");
  const identities = /* @__PURE__ */ new Set();
  for (const section of feature.sections) {
    if (!section || typeof section.profileFeatureId !== "string" || !missing(section.profileFeatureId) && !["sketch", "profile"].includes(earlier.get(section.profileFeatureId) ?? ""))
      throw new Error("Each loft section must reference an earlier sketch.");
    if (section.profileContourId !== void 0 && (typeof section.profileContourId !== "string" || !section.profileContourId.trim() || section.profileContourId.length > 128))
      throw new Error("Invalid loft contour reference.");
    validateProfileRegionSelection(section);
    const identity = JSON.stringify([section.profileFeatureId, profileRegionIdentity(section)]);
    if (identities.has(identity)) throw new Error("A loft section cannot be selected twice.");
    identities.add(identity);
  }
  if (!["new", "add", "cut"].includes(feature.operation) || typeof feature.ruled !== "boolean")
    throw new Error("Invalid loft operation or surface mode.");
}
function validateHole(feature, earlier, missing) {
  const positive = (value2) => typeof value2 === "number" && Number.isFinite(value2) && value2 > 0;
  if (typeof feature.profileFeatureId !== "string" || !missing(feature.profileFeatureId) && !["sketch", "profile"].includes(earlier.get(feature.profileFeatureId) ?? ""))
    throw new Error("Hole must reference an earlier circular sketch region.");
  if (feature.profileContourId !== void 0 && (typeof feature.profileContourId !== "string" || !feature.profileContourId.trim() || feature.profileContourId.length > 128)) throw new Error("Invalid hole contour reference.");
  if (!positive(feature.diameterMillimeters) || !positive(feature.depthMillimeters)) throw new Error("Hole diameter and depth must be positive.");
  if (!["blind", "through-all"].includes(feature.depthType) || !["plain", "counterbore", "countersink"].includes(feature.cutType)) throw new Error("Invalid hole type.");
  if (feature.reversed !== void 0 && typeof feature.reversed !== "boolean") throw new Error("Invalid hole direction.");
  if (feature.cutType !== "plain" && (!positive(feature.counterDiameterMillimeters) || feature.counterDiameterMillimeters <= feature.diameterMillimeters))
    throw new Error("Head diameter must exceed the hole diameter.");
  if (feature.cutType === "counterbore" && (!positive(feature.counterDepthMillimeters) || feature.depthType === "blind" && feature.counterDepthMillimeters >= feature.depthMillimeters))
    throw new Error("Counterbore depth must be positive and less than a blind hole's depth.");
  if (feature.cutType === "countersink" && (!positive(feature.countersinkAngleDegrees) || feature.countersinkAngleDegrees >= 180))
    throw new Error("Countersink angle must be between 0 and 180 degrees.");
}
function validateImportSTEP(feature) {
  if (feature.operation !== "new" || typeof feature.bodyId !== "string" || !feature.bodyId.trim())
    throw Error("STEP import needs a unique body identity.");
  if (typeof feature.sourceName !== "string" || !/\.(step|stp)$/i.test(feature.sourceName))
    throw Error("STEP import needs its source filename.");
  if (typeof feature.dataBase64 !== "string" || !feature.dataBase64.length || feature.dataBase64.length > 4 * 1024 * 1024 || (feature.dataBase64.length % 4 !== 0 || /[^A-Za-z0-9+/=]/.test(feature.dataBase64) || /=/.test(feature.dataBase64.slice(0, -2)) || /=[^=]$/.test(feature.dataBase64)))
    throw Error("Invalid STEP source (maximum 3 MiB per import).");
}
function validateSolidFeature(feature, earlier, missingReference = () => false) {
  if (feature.type === "transform") return validateTransform(feature, earlier, missingReference);
  if (feature.type === "offset-face") return validateOffsetFace(feature, earlier, missingReference);
  if (feature.type === "face-extrude") return validateFaceExtrude(feature, earlier, missingReference);
  if (feature.type === "boolean") return validateBoolean(feature);
  if (feature.type === "pattern") {
    validatePattern(feature, earlier, missingReference);
    return;
  }
  if (feature.type === "draft") {
    validateDraft(feature);
    return;
  }
  if (feature.type === "loft") {
    validateLoft(feature, earlier, missingReference);
    return;
  }
  if (feature.type === "hole") {
    validateHole(feature, earlier, missingReference);
    return;
  }
  if (feature.type === "import-cad") {
    validateImportCAD(feature);
    return;
  }
  if (feature.type === "import-step") {
    validateImportSTEP(feature);
    return;
  }
  const positive = (value2, label) => {
    if (!Number.isFinite(value2) || value2 <= 0)
      throw new Error(`${label} must be positive.`);
  };
  if (feature.type === "plane") {
    if (!["XY", "XZ", "YZ"].includes(feature.plane) || !Number.isFinite(feature.offsetMillimeters)) throw new Error("Invalid construction plane.");
    validatePlaneDefinition(feature, new Set([...earlier].filter(([, type]) => type === "plane").map(([id2]) => id2)), missingReference);
    return;
  }
  if (feature.type === "profile") {
    if (!["XY", "XZ", "YZ"].includes(feature.plane) || !Number.isFinite(feature.offsetMillimeters))
      throw new Error("Sketch plane or offset is invalid.");
    if (feature.support) {
      const s = feature.support;
      validatePlanarFaceAnchor(s.faceAnchor);
      if (!missingReference(s.sourceFeatureId) && !earlier.has(s.sourceFeatureId) || !s.bodyId || typeof s.bodyId !== "string" || typeof s.label !== "string" || ![s.normal, s.xDirection].every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite) && Math.abs(Math.hypot(...v) - 1) < 1e-6) || Math.abs(s.normal.reduce((sum, v, i) => sum + v * s.xDirection[i], 0)) > 1e-6) throw new Error("Invalid sketch face support. Reselect a planar face.");
    }
    if (feature.frame) {
      const { originMillimeters: origin, xDirection: x, normal: n } = feature.frame;
      if (![origin, x, n].every((v) => Array.isArray(v) && v.length === 3 && v.every(Number.isFinite)) || Math.abs(Math.hypot(...x) - 1) > 1e-6 || Math.abs(Math.hypot(...n) - 1) > 1e-6 || Math.abs(x.reduce((sum, v, i) => sum + v * n[i], 0)) > 1e-6) throw new Error("Invalid sketch frame.");
    }
    if (feature.profile?.type === "projection") {
      if (feature.profile.authored !== void 0) {
        const authored = feature.profile.authored;
        if (authored.projectionContext !== void 0) throw Error("Resolved projection context must not be saved.");
        const local2 = localPierceValidation(authored);
        validateSketchDrawing({ ...local2, constraints: local2.constraints?.filter((c) => ![c.a, c.b, c.axis].some((r) => r?.projectedContourId !== void 0)) });
      }
      const contourId = feature.profile.sourceContourId;
      if (contourId !== void 0 && (typeof contourId !== "string" || !contourId.trim() || contourId.length > 128)) throw Error("Invalid projected contour identity.");
      if (typeof feature.profile.sourceFeatureId !== "string" || !missingReference(feature.profile.sourceFeatureId) && earlier.get(feature.profile.sourceFeatureId) !== "profile")
        throw new Error(`${feature.name}: projection must reference an earlier profile (${feature.profile.sourceFeatureId}).`);
    } else if (feature.profile?.type === "drawing") {
      if (feature.profile.projectionContext !== void 0) throw Error("Resolved projection context must not be saved.");
      validateSketchDrawing(localPierceValidation(feature.profile));
    } else if (feature.profile?.type === "circle") {
      positive(feature.profile.radiusMillimeters, "Circle radius");
      if (feature.profile.centerMillimeters?.length !== 2 || !feature.profile.centerMillimeters.every(Number.isFinite))
        throw new Error("Circle center is invalid.");
    } else if (feature.profile?.type === "polygon") {
      const points = feature.profile.pointsMillimeters;
      if (!Array.isArray(points) || points.length < 3 || points.length > 1e3 || !points.every(
        (p) => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)
      ))
        throw new Error("A closed profile needs at least three finite points.");
      const area = points.reduce(
        (a, p, i) => a + p[0] * points[(i + 1) % points.length][1] - points[(i + 1) % points.length][0] * p[1],
        0
      );
      if (Math.abs(area) < 1e-8) throw new Error("Profile has zero area.");
    } else throw new Error("Unsupported sketch profile.");
  } else if (feature.type === "revolve") {
    if (!missingReference(feature.profileFeatureId) && !["profile", "sketch"].includes(
      earlier.get(feature.profileFeatureId) || ""
    ))
      throw new Error("Revolve must reference an earlier sketch.");
    positive(feature.angleDegrees, "Revolve angle");
    for (const value2 of [feature.symmetric, feature.reversed]) {
      if (value2 !== void 0 && typeof value2 !== "boolean") throw new Error("Invalid revolve direction flag.");
    }
    const second = feature.secondAngleDegrees ?? 0;
    if (!Number.isFinite(second) || second < 0 || feature.angleDegrees + second > 360 || feature.symmetric && second > 0)
      throw new Error("Revolve angles must total at most 360 degrees; symmetric cannot have a second angle.");
    if (feature.angleDegrees > 360 || !["X", "Y", "Z"].includes(feature.axis) || !["new", "add", "cut"].includes(feature.operation))
      throw new Error("Invalid revolve settings.");
  } else if (feature.type === "sweep") {
    if (!missingReference(feature.profileFeatureId) && !["profile", "sketch"].includes(earlier.get(feature.profileFeatureId) || ""))
      throw new Error("Sweep must reference an earlier sketch profile.");
    if (!missingReference(feature.pathFeatureId) && !["profile", "sketch"].includes(earlier.get(feature.pathFeatureId) || ""))
      throw new Error("Sweep must reference an earlier sketch path.");
    if (!["new", "add", "cut"].includes(feature.operation))
      throw new Error("Invalid sweep settings.");
  } else if (feature.type === "shell") {
    positive(feature.thicknessMillimeters, "Shell thickness");
    if (feature.removedFaces) {
      for (const face of feature.removedFaces) {
        if (!["XY", "XZ", "YZ"].includes(face.plane) || !Number.isFinite(face.offsetMillimeters))
          throw new Error("Invalid shell removed face plane.");
      }
    }
  } else if (feature.type === "mirror") {
    if (!missingReference(feature.sourceFeatureId) && !["extrude", "revolve", "sweep", "mirror"].includes(
      earlier.get(feature.sourceFeatureId) || ""
    ))
      throw new Error("Mirror must reference an earlier solid feature.");
    if (!["XY", "XZ", "YZ"].includes(feature.plane) || !Number.isFinite(feature.offsetMillimeters) || !["add", "cut"].includes(feature.operation))
      throw new Error("Invalid mirror settings.");
  } else if (feature.type === "fillet" || feature.type === "chamfer") {
    positive(feature.radiusMillimeters, "Edge finish size");
    if (feature.edgePlane && (!["XY", "XZ", "YZ"].includes(feature.edgePlane.plane) || !Number.isFinite(feature.edgePlane.offsetMillimeters)))
      throw new Error("Invalid edge selection plane.");
  } else throw new Error("Unsupported solid feature.");
}
const constraintOrder = [
  "horizontal",
  "vertical",
  "coincident-origin"
];
const dimensionOrder = ["width", "height"];
function positiveFinite(value2, label) {
  if (!Number.isFinite(value2) || value2 <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
}
function constraintId(sketchId, type) {
  return `${sketchId}:constraint:${type}`;
}
function dimensionId(sketchId, type) {
  return `${sketchId}:dimension:${type}`;
}
function createCenterRectangleSketch(sketchId, plane2, widthMillimeters, heightMillimeters, fullyDefined = true) {
  return reviseCenterRectangleSketch(
    {
      id: sketchId,
      type: "sketch",
      name: "Sketch 1",
      plane: plane2,
      profile: {
        type: "center-rectangle",
        widthMillimeters,
        heightMillimeters,
        centerXMillimeters: 0,
        centerYMillimeters: 0,
        construction: false
      },
      constraints: [],
      dimensions: [],
      suppressed: false
    },
    {
      plane: plane2,
      widthMillimeters,
      heightMillimeters,
      anchoredToOrigin: true,
      widthDimensioned: fullyDefined,
      heightDimensioned: fullyDefined,
      construction: false
    }
  );
}
function reviseCenterRectangleSketch(sketch, revision) {
  positiveFinite(revision.widthMillimeters, "Sketch width");
  positiveFinite(revision.heightMillimeters, "Sketch height");
  const enabledConstraints = /* @__PURE__ */ new Set();
  enabledConstraints.add("horizontal");
  enabledConstraints.add("vertical");
  enabledConstraints.add("coincident-origin");
  const enabledDimensions = /* @__PURE__ */ new Set();
  if (revision.widthDimensioned) enabledDimensions.add("width");
  if (revision.heightDimensioned) enabledDimensions.add("height");
  return {
    ...sketch,
    plane: revision.plane,
    profile: {
      ...sketch.profile,
      widthMillimeters: revision.widthMillimeters,
      heightMillimeters: revision.heightMillimeters,
      centerXMillimeters: revision.anchoredToOrigin ? 0 : sketch.profile.centerXMillimeters,
      centerYMillimeters: revision.anchoredToOrigin ? 0 : sketch.profile.centerYMillimeters,
      construction: revision.construction
    },
    constraints: constraintOrder.filter((type) => enabledConstraints.has(type)).map((type) => ({
      id: constraintId(sketch.id, type),
      type,
      target: "center-rectangle"
    })),
    dimensions: dimensionOrder.filter((type) => enabledDimensions.has(type)).map((type) => ({
      id: dimensionId(sketch.id, type),
      type,
      target: "center-rectangle",
      valueMillimeters: type === "width" ? revision.widthMillimeters : revision.heightMillimeters
    }))
  };
}
function validateSketchFeature(sketch) {
  if (!sketch.id || !sketch.name.trim()) {
    throw new Error("Sketch needs an ID and name.");
  }
  if (!["XY", "XZ", "YZ"].includes(sketch.plane)) {
    throw new Error(`Unsupported sketch plane: ${String(sketch.plane)}.`);
  }
  if (sketch.profile.type !== "center-rectangle") {
    throw new Error("Part v2 supports a center-rectangle Sketch.");
  }
  positiveFinite(sketch.profile.widthMillimeters, "Sketch width");
  positiveFinite(sketch.profile.heightMillimeters, "Sketch height");
  if (!Number.isFinite(sketch.profile.centerXMillimeters)) {
    throw new Error("Sketch center X must be finite.");
  }
  if (!Number.isFinite(sketch.profile.centerYMillimeters)) {
    throw new Error("Sketch center Y must be finite.");
  }
  if (typeof sketch.profile.construction !== "boolean") {
    throw new Error("Sketch construction state is invalid.");
  }
  const ids = /* @__PURE__ */ new Set();
  for (const constraint of sketch.constraints) {
    if (!constraint.id || ids.has(constraint.id)) {
      throw new Error("Sketch constraint IDs must be unique.");
    }
    ids.add(constraint.id);
    if (!constraintOrder.includes(constraint.type)) {
      throw new Error(
        `Unsupported sketch constraint: ${String(constraint.type)}.`
      );
    }
    if (constraint.target !== "center-rectangle") {
      throw new Error("Sketch constraint target is invalid.");
    }
  }
  for (const dimension of sketch.dimensions) {
    if (!dimension.id || ids.has(dimension.id)) {
      throw new Error("Sketch dimension IDs must be unique.");
    }
    ids.add(dimension.id);
    if (!dimensionOrder.includes(dimension.type)) {
      throw new Error(
        `Unsupported sketch dimension: ${String(dimension.type)}.`
      );
    }
    if (dimension.target !== "center-rectangle") {
      throw new Error("Sketch dimension target is invalid.");
    }
    positiveFinite(dimension.valueMillimeters, `${dimension.type} dimension`);
  }
}
function circleSegments(center, radius) {
  const right = [center[0] + radius, center[1]], left = [center[0] - radius, center[1]];
  return [
    {
      start: right,
      segment: {
        type: "arc",
        middle: [center[0], center[1] + radius],
        end: left
      }
    },
    {
      start: left,
      segment: {
        type: "arc",
        middle: [center[0], center[1] - radius],
        end: right
      }
    }
  ];
}
const byID = (organization) => new Map(organization.folders.map((folder) => [folder.id, folder]));
function ancestorChain(organization, folderID) {
  const folders = byID(organization);
  const chain = [];
  const seen = /* @__PURE__ */ new Set();
  let current2 = folderID;
  while (current2 !== null && folders.has(current2) && !seen.has(current2)) {
    chain.push(current2);
    seen.add(current2);
    current2 = folders.get(current2).parentID;
  }
  return chain;
}
function validateTreeOrganization(value2) {
  if (value2 === void 0) return;
  if (!value2 || typeof value2 !== "object") throw new Error("Organization must be an object.");
  const organization = value2;
  if (!Array.isArray(organization.folders) || !organization.membership || typeof organization.membership !== "object") {
    throw new Error("Organization requires folders and membership.");
  }
  const ids = /* @__PURE__ */ new Set();
  for (const folder of organization.folders) {
    if (!folder || typeof folder.id !== "string" || !folder.id || typeof folder.name !== "string" || !folder.name.trim()) {
      throw new Error("Every folder requires an id and a name.");
    }
    if (ids.has(folder.id)) throw new Error(`Duplicate folder id ${folder.id}.`);
    ids.add(folder.id);
  }
  for (const folder of organization.folders) {
    if (folder.parentID !== null && !ids.has(folder.parentID)) {
      throw new Error(`Folder ${folder.id} references unknown parent ${folder.parentID}.`);
    }
  }
  const complete = organization;
  for (const folder of complete.folders) {
    const chain = ancestorChain(complete, folder.id);
    const last = complete.folders.find((entry) => entry.id === chain[chain.length - 1]);
    if (last && last.parentID !== null) throw new Error(`Folder nesting cycle at ${folder.id}.`);
  }
  for (const [itemID, folderID] of Object.entries(complete.membership)) {
    if (typeof folderID !== "string" || !ids.has(folderID)) {
      throw new Error(`Item ${itemID} references unknown folder ${String(folderID)}.`);
    }
  }
}
const PART_DOCUMENT_FORMAT = "aether-part";
const LEGACY_PART_DOCUMENT_FORMAT = "open-cad-part";
const PART_DOCUMENT_VERSION = partFormat.current;
function portableId() {
  const runtime = globalThis;
  const generated = runtime.crypto?.randomUUID?.();
  if (generated) return generated;
  return `aether-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}
function createEmptyPartDocument(name) {
  const doc = {
    format: PART_DOCUMENT_FORMAT,
    formatVersion: PART_DOCUMENT_VERSION,
    documentId: portableId(),
    name: name.trim(),
    units: "millimeter",
    features: []
  };
  validatePartDocument(doc);
  return doc;
}
function requirePositiveFinite(value2, label) {
  if (!Number.isFinite(value2) || value2 <= 0) {
    throw new Error(`${label} must be greater than zero.`);
  }
}
function validatePartDocument(value2) {
  if (!value2 || typeof value2 !== "object") {
    throw new Error("Part file is not an object.");
  }
  const document = value2;
  if (document.format !== PART_DOCUMENT_FORMAT) {
    throw new Error(
      `Unsupported Part format: ${String(document.format ?? "missing")}.`
    );
  }
  if (document.formatVersion !== PART_DOCUMENT_VERSION) {
    throw new Error(
      `Unsupported Part format version: ${String(document.formatVersion ?? "missing")}. Update Aether CAD to open newer Part files.`
    );
  }
  const expressionVariables = evaluateDocumentVariables(document.variables);
  validateSketchPresentation(document.sketchPresentation);
  validateImageCanvases(document.imageCanvases);
  validateTreeOrganization(document.organization);
  if (!document.documentId || typeof document.documentId !== "string") {
    throw new Error("Part documentId is required.");
  }
  if (!document.name?.trim()) throw new Error("Part name is required.");
  if (document.units !== "millimeter") {
    throw new Error("Part units must be millimeter.");
  }
  if (!Array.isArray(document.features)) {
    throw new Error("Part features must be an array.");
  }
  if (document.rollbackIndex !== void 0 && (!Number.isInteger(document.rollbackIndex) || document.rollbackIndex < 0 || document.rollbackIndex > document.features.length))
    throw new Error("Rollback position is outside the feature history.");
  if (document.bodyProperties !== void 0) {
    if (!document.bodyProperties || typeof document.bodyProperties !== "object")
      throw new Error("Invalid body properties.");
    for (const value22 of Object.values(document.bodyProperties))
      if (!value22 || typeof value22.name !== "string" || !value22.name.trim() || typeof value22.visible !== "boolean")
        throw new Error("Bodies need a name and visibility state.");
  }
  const ids = /* @__PURE__ */ new Set();
  const allIds = new Set(document.features.map((f) => f?.id));
  const missingReference = (id2) => typeof id2 === "string" && !!id2.trim() && !allIds.has(id2);
  const earlier = /* @__PURE__ */ new Map();
  const bodies = /* @__PURE__ */ new Set();
  document.features.forEach((feature, index) => {
    if (!feature || typeof feature !== "object" || typeof feature.id !== "string" || !feature.id || ids.has(feature.id))
      throw new Error("Feature IDs must be unique.");
    if (typeof feature.name !== "string" || !feature.name.trim())
      throw new Error(`Feature ${index + 1} needs a name.`);
    if (typeof feature.suppressed !== "boolean")
      throw new Error(`${feature.name} has an invalid suppressed state.`);
    ids.add(feature.id);
    if ("profileRegion" in feature && feature.profileRegion !== void 0) {
      if (!["extrude", "revolve", "sweep"].includes(feature.type)) throw Error("This feature does not accept a connected sketch region.");
      validateProfileRegionSelection(feature);
    }
    if (feature.type === "extrude") {
      if (feature.profileRegion && (feature.thin || feature.profileContourIds)) throw Error("A connected region cannot also reference individual extrusion curves.");
      for (const selection of Array.isArray(feature.profileSelections) ? feature.profileSelections : []) {
        if (!selection) throw Error("Choose valid sketch regions.");
        validateProfileRegionSelection(selection);
        if (feature.thin && selection.profileRegion) throw Error("Thin extrusion references individual curves, not connected faces.");
      }
    }
    if (feature.type === "transform") {
      const outputs = feature.copyBodyIds ? Object.values(feature.copyBodyIds) : [];
      for (const id2 of outputs) {
        if (bodies.has(id2)) throw Error("Copy outputs need new body identities.");
        bodies.add(id2);
      }
    } else if ((feature.type === "extrude" || feature.type === "revolve" || feature.type === "sweep" || feature.type === "loft" || feature.type === "import-step" || feature.type === "import-cad") && feature.operation === "new") {
      const id2 = feature.bodyId ?? (bodies.size === 0 ? `${document.documentId}:body-1` : `${document.documentId}:body-${feature.id}`);
      if (typeof id2 !== "string" || !id2 || bodies.has(id2))
        throw new Error("Body IDs must be unique.");
      const outputs = feature.type === "extrude" && feature.separateBodies && feature.bodyOutputs ? feature.bodyOutputs : [id2];
      if (!Array.isArray(outputs) || !outputs.length) throw new Error("Extrusion needs output body identities.");
      for (const output of outputs) {
        if (typeof output !== "string" || !output.trim() || bodies.has(output)) throw new Error("Body IDs must be unique.");
        bodies.add(output);
      }
    } else if (!["profile", "sketch", "plane"].includes(feature.type)) {
      if (!bodies.size && feature.type !== "offset-face" && !("targetBodyId" in feature && feature.targetBodyId))
        throw new Error(
          `${feature.name} needs an earlier body-producing feature.`
        );
      if ("targetBodyId" in feature && feature.targetBodyId && typeof feature.targetBodyId !== "string")
        throw new Error(
          `${feature.name} refers to an unavailable target body.`
        );
    }
    if (feature.type === "sketch") validateSketchFeature(feature);
    else if (feature.type === "extrude") {
      if (!missingReference(feature.profileFeatureId) && !["sketch", "profile"].includes(
        earlier.get(feature.profileFeatureId) || ""
      ))
        throw new Error("Extrude must reference an earlier Sketch.");
      if (!["new", "add", "cut", "intersect"].includes(feature.operation))
        throw new Error("Unsupported extrude operation.");
      if (feature.scopeMode !== void 0 && (feature.scopeMode !== "all" || !["add", "cut", "intersect"].includes(feature.operation) || feature.targetBodyId !== void 0 || feature.targetBodyIds !== void 0)) throw Error("Automatic extrusion scope cannot also specify target parts.");
      if (feature.scopeResolution !== void 0) {
        if (feature.scopeMode !== "all") throw Error("A scope resolution requires automatic scope.");
        validateExtrusionScopeResolution(feature.scopeResolution);
      }
      if (feature.targetBodyIds !== void 0) {
        const scope = feature.targetBodyIds;
        if (!["add", "cut", "intersect"].includes(feature.operation) || !Array.isArray(scope) || !scope.length || scope.length > 256 || scope.some((id2) => typeof id2 !== "string" || !id2.trim()) || new Set(scope).size !== scope.length || feature.targetBodyId !== scope[0]) throw Error("Extrusion scope needs distinct parts and a matching primary target for Add, Remove or Intersect.");
      }
      if (feature.profileContourId !== void 0 && (typeof feature.profileContourId !== "string" || !feature.profileContourId.trim() || feature.profileContourId.length > 128))
        throw new Error("Invalid extruded region identity.");
      if (feature.profileSelections !== void 0) {
        const picks = feature.profileSelections;
        if (!Array.isArray(picks) || !picks.length || picks.length > 256 || new Set(picks.map((p) => JSON.stringify([p?.profileFeatureId, p ? profileRegionIdentity(p) : null]))).size !== picks.length || picks.some((p) => !p || !missingReference(p.profileFeatureId) && !["sketch", "profile"].includes(earlier.get(p.profileFeatureId) || "") || p.profileContourId !== void 0 && (typeof p.profileContourId !== "string" || !p.profileContourId.trim() || p.profileContourId.length > 128))) throw Error("Choose distinct faces from earlier sketches.");
      }
      if (feature.separateBodies !== void 0 && typeof feature.separateBodies !== "boolean") throw Error("Invalid separate bodies option.");
      if (feature.bodyOutputs !== void 0 && (!feature.separateBodies || feature.operation !== "new" || !Array.isArray(feature.bodyOutputs) || !feature.bodyOutputs.length || feature.bodyOutputs.some((id2) => typeof id2 !== "string" || !id2.trim()))) throw Error("Invalid extrusion output bodies.");
      if (feature.regionMode !== void 0 && feature.regionMode !== "faces") throw Error("Invalid region mode.");
      if (feature.profileContourIds !== void 0 && (feature.regionMode !== "faces" || !Array.isArray(feature.profileContourIds) || !feature.profileContourIds.length || new Set(feature.profileContourIds).size !== feature.profileContourIds.length || feature.profileContourIds.some((id2) => typeof id2 !== "string" || !id2.trim() || id2.length > 128))) throw Error("Choose distinct region identities.");
      requirePositiveFinite(feature.distanceMillimeters, "Extrude distance");
      if (feature.thin !== void 0) {
        const wall = feature.thin;
        if (!wall || typeof wall !== "object" || Array.isArray(wall) || [wall.thickness1Millimeters, wall.thickness2Millimeters].some((v) => typeof v !== "number" || !Number.isFinite(v) || v < 0 || v > 1e6) || [wall.midplane, wall.flipped].some((v) => v !== void 0 && typeof v !== "boolean") || wall.midplaneThicknessMillimeters !== void 0 && (typeof wall.midplaneThicknessMillimeters !== "number" || !Number.isFinite(wall.midplaneThicknessMillimeters) || wall.midplaneThicknessMillimeters <= 0 || wall.midplaneThicknessMillimeters > 1e6) || (wall.midplane ? wall.midplaneThicknessMillimeters === void 0 : wall.thickness1Millimeters + wall.thickness2Millimeters <= 1e-7)) {
          throw Error("Thin extrusion needs valid wall thicknesses and a positive total thickness.");
        }
      }
      if (feature.secondEnd !== void 0) {
        if (!feature.secondEnd || typeof feature.secondEnd !== "object" || Array.isArray(feature.secondEnd)) throw Error("Invalid second-end definition.");
        if (feature.secondDistanceMillimeters !== void 0 || ["symmetric", "symmetric-through-all"].includes(feature.endType ?? "")) throw Error("Independent second end cannot combine with Symmetric or legacy opposite depth.");
        if (!["blind", "through-all", "up-to-next", "up-to-face", "up-to-part", "up-to-vertex"].includes(feature.secondEnd.endType)) throw Error("Invalid second-end condition.");
        requirePositiveFinite(feature.secondEnd.distanceMillimeters, "Second-end depth");
      }
      for (const end of [feature, ...feature.secondEnd ? [feature.secondEnd] : []]) {
        if (end.draftAngleDegrees !== void 0) {
          if (!Number.isFinite(end.draftAngleDegrees) || Math.abs(end.draftAngleDegrees) >= 90) throw Error("Extrusion draft must be between -90 and 90 degrees.");
        }
        if (end.endType !== void 0 && !["blind", "symmetric", "through-all", "symmetric-through-all", "up-to-next", "up-to-face", "up-to-part", "up-to-vertex"].includes(end.endType)) throw Error("Invalid extrusion end type.");
        if (["through-all", "symmetric-through-all"].includes(end.endType ?? "") && !["cut", "intersect"].includes(feature.operation)) throw Error("Through all requires Remove or Intersect.");
        if (end.endType === "up-to-part" && (typeof end.endPartId !== "string" || !end.endPartId.trim() || end.endPartId.length > 256)) throw Error("Up to part needs a stable stopping part identity.");
        if (end.endPartId !== void 0 && end.endType !== "up-to-part") throw Error("A stopping part requires Up to part.");
        if (end.endType === "up-to-vertex") validateExtrusionPointReference(end.endPointReference, earlier, missingReference);
        if (end.endPointReference !== void 0 && end.endType !== "up-to-vertex") throw Error("A stopping point requires Up to vertex.");
        if (end.endType === "up-to-face") validateExtrusionFaceReference(end.endReference, earlier, missingReference);
        if (end.endOffsetMillimeters !== void 0 && (!Number.isFinite(end.endOffsetMillimeters) || !["up-to-next", "up-to-face", "up-to-part", "up-to-vertex"].includes(end.endType ?? ""))) throw Error("End offset requires a supported stopping limit and a finite distance.");
      }
      if (feature.startingReference !== void 0) validateExtrusionStartReference(feature.startingReference, earlier, missingReference);
      if (feature.startingOffsetMillimeters !== void 0 && !Number.isFinite(feature.startingOffsetMillimeters)) throw Error("Invalid starting offset.");
      if (feature.secondDistanceMillimeters !== void 0) {
        requirePositiveFinite(feature.secondDistanceMillimeters, "Opposite depth");
        if (feature.endType && feature.endType !== "blind") throw Error("Opposite depth requires Blind.");
      }
      if (feature.directionVector !== void 0) {
        const vector2 = feature.directionVector;
        if (!Array.isArray(vector2) || vector2.length !== 3 || !vector2.every(Number.isFinite) || Math.abs(Math.hypot(...vector2) - 1) > 1e-6) throw Error("Extrusion direction must be a finite unit vector.");
      }
      if (feature.directionReference !== void 0) {
        const ref = feature.directionReference;
        if (!ref || ref.kind !== "sketch-line" || feature.directionVector !== void 0 || ![ref.sourceFeatureId, ref.contourId, ref.segmentId].every((id2) => typeof id2 === "string" && !!id2.trim() && id2.length <= 128) || !missingReference(ref.sourceFeatureId) && earlier.get(ref.sourceFeatureId) !== "profile") {
          throw Error("Extrusion direction needs a line in an earlier sketch; it cannot also store a manual vector.");
        }
      }
      if (feature.reversed !== void 0 && typeof feature.reversed !== "boolean") throw new Error("Invalid extrude direction.");
    } else validateSolidFeature(feature, earlier, missingReference);
    earlier.set(feature.id, feature.type);
  });
  validateDocumentTextExpressions(document.features, expressionVariables);
  const referenceErrors = featureReferenceErrors({ ...document, rollbackIndex: void 0 });
  for (const feature of document.features) {
    if (!feature.suppressed && !referenceErrors.has(feature.id) && feature.type === "profile") {
      const drawing = feature.profile.type === "drawing" ? feature.profile : feature.profile.type === "projection" ? feature.profile.authored : void 0;
      if (drawing?.constraints?.some((c) => c.kind === "pierce")) resolveProfileDrawing(document.features.map((f) => f.id === feature.id ? { ...f, suppressed: false } : f), feature.id);
    }
    if (!referenceErrors.has(feature.id) && feature.type === "profile" && feature.profile.type === "projection" && !missingReference(feature.profile.sourceFeatureId) && feature.profile.authored?.constraints?.some((c) => [c.a, c.b, c.axis].some((r) => r?.projectedContourId !== void 0))) {
      resolveProfileDrawing(document.features.map((f) => f.type === "profile" ? { ...f, suppressed: false } : f), feature.id);
    }
  }
}
function serializePartDocument(document) {
  validatePartDocument(document);
  return `${JSON.stringify(document, null, 2)}
`;
}
function parsePartDocument(text) {
  let value2;
  try {
    value2 = JSON.parse(text);
  } catch {
    throw new Error("The selected file is not valid JSON.");
  }
  const migrated = migratePartDocument(value2);
  validatePartDocument(migrated);
  return migrated;
}
function migratePartDocument(value2) {
  if (!value2 || typeof value2 !== "object") return value2;
  const record = value2;
  const format = record.format === LEGACY_PART_DOCUMENT_FORMAT ? PART_DOCUMENT_FORMAT : record.format;
  if (format !== PART_DOCUMENT_FORMAT) return value2;
  if (typeof record.formatVersion !== "number" || !partFormat.readable.includes(record.formatVersion)) {
    throw new Error(`Unsupported Part format version: ${String(record.formatVersion ?? "missing")}. Update Aether CAD to open newer Part files.`);
  }
  if (record.formatVersion !== 1) return { ...record, format, formatVersion: PART_DOCUMENT_VERSION };
  const features = Array.isArray(record.features) ? record.features.map((feature) => {
    if (!feature || typeof feature !== "object") return feature;
    const item = feature;
    if (item.type !== "sketch") return feature;
    const profile = item.profile;
    if (!profile || typeof item.id !== "string" || typeof profile.widthMillimeters !== "number" || typeof profile.heightMillimeters !== "number") {
      return feature;
    }
    return {
      ...createCenterRectangleSketch(
        item.id,
        item.plane === "XZ" || item.plane === "YZ" ? item.plane : "XY",
        profile.widthMillimeters,
        profile.heightMillimeters,
        true
      ),
      name: typeof item.name === "string" ? item.name : "Sketch 1",
      suppressed: typeof item.suppressed === "boolean" ? item.suppressed : false
    };
  }) : record.features;
  return {
    ...record,
    format,
    formatVersion: PART_DOCUMENT_VERSION,
    features
  };
}
similarityTransform([0, 0], [0, 0], 0);
function resolveExtrusionScopes(doc, scopes = {}) {
  const active = new Set(doc.features.slice(0, rollbackPosition(doc)).filter((f) => f.type === "extrude" && f.scopeMode === "all" && !f.suppressed).map((f) => f.id));
  if (Object.keys(scopes).some((id2) => !active.has(id2))) throw Error("Rebuild returned an unknown automatic extrusion scope.");
  const available = /* @__PURE__ */ new Set();
  const next = { ...doc, features: doc.features.map((feature) => {
    if (!feature.suppressed && "operation" in feature && feature.operation === "new") {
      bodyIDsForFeature(doc, feature).forEach((id2) => available.add(id2));
    }
    if (!active.has(feature.id)) {
      consumedBodyIDs(feature).forEach((id2) => available.delete(id2));
      return feature;
    }
    const resolution = scopes[feature.id];
    if (!resolution) throw Error(`${feature.name}: rebuild did not resolve the automatic scope.`);
    validateExtrusionScopeResolution(resolution);
    if (resolution.targets.some((id2) => !available.has(id2))) throw Error(`${feature.name}: rebuild returned an unavailable scope part.`);
    if (feature.type === "extrude" && feature.operation === "add" && resolution.groups.flatMap((g) => g.sources).length !== resolution.targets.length) throw Error("Add cannot discard source parts.");
    if (feature.type === "extrude" && feature.operation !== "add" && resolution.groups.some((g) => g.sources.length !== 1)) throw Error("Only Add can merge part identities.");
    if (feature.type === "extrude" && feature.operation === "intersect" && resolution.groups.length !== resolution.targets.length) throw Error("Intersect scope must retain overlapping parts.");
    scopeConsumedBodies(resolution).forEach((id2) => available.delete(id2));
    return { ...feature, scopeResolution: structuredClone(resolution) };
  }) };
  validatePartDocument(next);
  return next;
}
function extrusionSketchPoints(doc, beforeFeatureId) {
  const end = beforeFeatureId ? doc.features.findIndex((f) => f.id === beforeFeatureId) : rollbackPosition(doc);
  return doc.features.slice(0, Math.max(0, end)).flatMap((feature) => {
    if (feature.type !== "profile" || feature.suppressed || feature.profile.type === "projection") return [];
    try {
      return resolveProfileDrawing(doc.features, feature.id).contours.flatMap((contour, contourIndex) => {
        const base = { sourceFeatureId: feature.id, contourId: contour.id, contourIndex, frame: profileSketchFrame(feature), support: feature.support };
        const points = [];
        if (contour.type === "circle") points.push({ point: "center", index: 0, position: contour.center, label: `${feature.name} · Circle ${contourIndex + 1} center` });
        else {
          points.push({ point: "vertex", vertexId: contour.startVertexId, index: 0, position: contour.start, label: `${feature.name} · Point ${contourIndex + 1}.1` });
          contour.segments.forEach((segment, index) => {
            if (segment.endVertexId && points.some((p) => p.vertexId === segment.endVertexId) || index === contour.segments.length - 1 && Math.hypot(segment.end[0] - contour.start[0], segment.end[1] - contour.start[1]) < 1e-7) return;
            points.push({ point: "vertex", vertexId: segment.endVertexId, index: index + 1, position: segment.end, label: `${feature.name} · Point ${contourIndex + 1}.${index + 2}` });
          });
        }
        return points.map((point2) => ({ ...base, ...point2 }));
      });
    } catch {
      return [];
    }
  });
}
function nativeExtrusionPoint(doc, ref, beforeFeatureId) {
  if (ref.kind === "solid-vertex") return ref;
  const matches = extrusionSketchPoints(doc, beforeFeatureId).filter((p) => p.sourceFeatureId === ref.sourceFeatureId && p.contourId === ref.contourId && p.point === ref.point && (p.point === "center" || p.vertexId === ref.vertexId));
  if (matches.length !== 1) throw Error("Stopping sketch point is unavailable. Reselect a point in an earlier sketch.");
  const point2 = matches[0];
  return { kind: "sketch-point", local_point: point2.position, frame: point2.frame, ...point2.support ? { support: point2.support } : {} };
}
function sketchDirectionLines(doc, beforeFeatureId) {
  const end = beforeFeatureId ? doc.features.findIndex((f) => f.id === beforeFeatureId) : rollbackPosition(doc);
  return doc.features.slice(0, Math.max(0, end)).flatMap((feature) => {
    if (feature.type !== "profile" || feature.suppressed || feature.profile.type === "projection") return [];
    try {
      const drawing = resolveProfileDrawing(doc.features, feature.id);
      return drawing.contours.flatMap((contour, contourIndex) => {
        if (contour.type !== "path") return [];
        let start = contour.start;
        return contour.segments.flatMap((segment, segmentIndex) => {
          const a = start;
          start = segment.end;
          if (segment.type !== "line" || Math.hypot(segment.end[0] - a[0], segment.end[1] - a[1]) < 1e-9) return [];
          return [{
            sourceFeatureId: feature.id,
            contourIndex,
            segmentIndex,
            contourId: contour.id,
            segmentId: segment.id,
            label: `${feature.name} · ${contour.construction ? "Construction line" : "Line"} ${contourIndex + 1}.${segmentIndex + 1}`,
            start: a,
            end: segment.end,
            frame: profileSketchFrame(feature),
            support: feature.support
          }];
        });
      });
    } catch {
      return [];
    }
  });
}
function resolveSketchDirection(doc, ref, beforeFeatureId) {
  const matches = sketchDirectionLines(doc, beforeFeatureId).filter((line) => line.sourceFeatureId === ref.sourceFeatureId && line.contourId === ref.contourId && line.segmentId === ref.segmentId);
  if (matches.length !== 1) throw Error("Extrusion direction line is unavailable or no longer straight. Reselect a line in an earlier sketch.");
  return matches[0];
}
function nativeSketchDirection(doc, ref, beforeFeatureId) {
  const line = resolveSketchDirection(doc, ref, beforeFeatureId);
  return { kind: "sketch-line", local_vector: [line.end[0] - line.start[0], line.end[1] - line.start[1]], frame: line.frame, ...line.support ? { support: line.support } : {} };
}
function nativeVector(doc, ref, before) {
  if (ref.kind === "solid-edge") return ref;
  if (ref.kind === "two-points") return { kind: "two-points", from: nativeExtrusionPoint(doc, ref.from, before), to: nativeExtrusionPoint(doc, ref.to, before) };
  const line = resolveSketchDirection(doc, ref, before);
  return { kind: "two-points", ...Object.fromEntries([["from", line.start], ["to", line.end]].map(([key, point2]) => [key, { kind: "sketch-point", local_point: point2, frame: line.frame, ...line.support ? { support: line.support } : {} }])) };
}
function nativePartTransform(doc, t, before) {
  if (t.kind === "translate-reference" || t.kind === "rotate-reference") return { ...t, reference: nativeVector(doc, t.reference, before) };
  if (t.kind === "scale-reference") return { ...t, centerReference: nativeExtrusionPoint(doc, t.centerReference, before) };
  return t;
}
function nativeWireSegments(start, segments) {
  let current2 = start;
  return segments.map((segment) => {
    const native = segment.type === "ellipse" ? { ...segment, ellipse_frame: ellipseFrame(current2, segment) } : structuredClone(segment);
    current2 = segment.end;
    return native;
  });
}
function nativePierceChecks(features, feature, resolved) {
  const authored = feature.profile.type === "drawing" ? feature.profile : feature.profile.type === "projection" ? feature.profile.authored : void 0;
  const sources = [], checks = /* @__PURE__ */ new Map(), targets = /* @__PURE__ */ new Map();
  if (!authored) return { sources, checks, targets };
  const offset = feature.profile.type === "projection" ? resolved.contours.length - authored.contours.length : 0;
  for (const c of authored.constraints ?? []) {
    if (c.kind !== "pierce") continue;
    const source = c.source, hit = resolveSketchPierce(features, feature.id, source);
    const sourceFeature = features.find((f) => f.id === source.sourceFeatureId);
    const sourceContour = resolveProfileDrawing(features, sourceFeature.id).contours.find((q) => q.id === source.sourceContourId);
    const id2 = `${feature.id}#pierce-source#${c.id}`, frame = profileSketchFrame(sourceFeature);
    const placement = { frame, ...sourceFeature.support ? { support: sourceFeature.support, source_profile_id: sourceFeature.id } : {} };
    if (sourceContour.type === "circle") sources.push({ id: id2, kind: "sketch-circle", parameters: { center_mm: sourceContour.center, radius_mm: sourceContour.radius, ...placement } });
    else {
      const index = sourceContour.segments.findIndex((s) => s.id === source.sourceSegmentId), start = index ? sourceContour.segments[index - 1].end : sourceContour.start;
      sources.push({ id: id2, kind: "sketch-wire", parameters: { start_mm: start, segments: nativeWireSegments(start, [sourceContour.segments[index]]), ...placement } });
    }
    const contourIndex = c.a.contour + offset, contour = resolved.contours[contourIndex];
    const a = resolveSegmentReference(contour, { ...c.a, contour: contourIndex });
    let target;
    if (a.kind !== "point") target = { kind: "curve", geometry: contour.type === "circle" ? 0 : a.index };
    else if (contour.type === "circle") target = { kind: "center", geometry: 0 };
    else if (a.control !== void 0) target = { kind: "control", geometry: a.index, control: a.control, scale: a.controlScale ?? 1 };
    else {
      target = { kind: "endpoint", geometry: a.index === 0 ? 0 : a.index - 1, local_point: sketchEntityPoint(resolved, a) };
    }
    const entries = checks.get(contourIndex) ?? [];
    entries.push({ id: c.id, source_sketch: id2, world_point: hit.worldPoint, target });
    checks.set(contourIndex, entries);
    const targetPlacement = { frame: profileSketchFrame(feature), pierce_checks: entries, source_profile_id: feature.id, ...feature.support ? { support: feature.support } : {} };
    const targetId = `${feature.id}#pierce-target#${contourIndex}`;
    targets.set(contourIndex, contour.type === "circle" ? { id: targetId, kind: "sketch-circle", parameters: { center_mm: contour.center, radius_mm: contour.radius, ...targetPlacement } } : contour.segments.length ? { id: targetId, kind: "sketch-wire", parameters: { start_mm: contour.start, segments: nativeWireSegments(contour.start, contour.segments), ...targetPlacement } } : { id: targetId, kind: "sketch-point", parameters: { point_mm: contour.start, ...targetPlacement } });
  }
  return { sources, checks, targets };
}
const tolerance = 1e-7;
const distance = (a, b) => Math.hypot(a[0] - b[0], a[1] - b[1]);
const cross$2 = (a, b) => a[0] * b[1] - a[1] * b[0];
function oriented(path, reverse) {
  const points = [path.start, ...path.segments.map((s) => s.end)];
  const segments = path.segments.map((_, j) => {
    const i = reverse ? path.segments.length - 1 - j : j;
    const { id: _id, endVertexId: _vertex, ...segment } = structuredClone(path.segments[i]);
    if (!reverse) return segment;
    return {
      ...segment,
      end: [...points[i]],
      ...segment.type === "bezier" ? { controls: [segment.controls[1], segment.controls[0]] } : {},
      ...segment.type === "ellipse" ? { sweep: !segment.sweep } : {}
    };
  });
  return { type: "path", start: [...points[reverse ? points.length - 1 : 0]], segments };
}
function regularCubic(start, segment) {
  const [p, q] = segment.controls, end = segment.end;
  const a = start.map((v, k2) => -v + 3 * p[k2] - 3 * q[k2] + end[k2]);
  const b = start.map((v, k2) => 3 * v - 6 * p[k2] + 3 * q[k2]);
  const c = start.map((v, k2) => 3 * (p[k2] - v));
  const scale = Math.max(1, Math.hypot(...a), Math.hypot(...b), Math.hypot(...c));
  const axis = Math.abs(a[0]) + Math.abs(b[0]) + Math.abs(c[0]) >= Math.abs(a[1]) + Math.abs(b[1]) + Math.abs(c[1]) ? 0 : 1;
  for (const t of polynomialRoots([c[axis], 2 * b[axis], 3 * a[axis]])) {
    if (t > 1e-9 && t < 1 - 1e-9 && Math.hypot(...a.map((v, k2) => 3 * v * t * t + 2 * b[k2] * t + c[k2])) < scale * 1e-10) return false;
  }
  const denominator = cross$2(a, b);
  if (Math.abs(denominator) <= scale * scale * 1e-12) return true;
  const sum = -cross$2(a, c) / denominator;
  const k = Math.abs(a[0]) >= Math.abs(a[1]) ? 0 : 1;
  const product = sum * sum + (b[k] * sum + c[k]) / a[k];
  const discriminant = sum * sum - 4 * product;
  if (discriminant <= 1e-16) return true;
  const low = (sum - Math.sqrt(discriminant)) / 2, high = (sum + Math.sqrt(discriminant)) / 2;
  return low < -1e-9 || high > 1 + 1e-9;
}
function simpleBoundary(path) {
  const curves = path.segments.map((segment, i) => ({ start: i ? path.segments[i - 1].end : path.start, segment }));
  try {
    for (let i = 0; i < curves.length; i++) {
      const curve = curves[i];
      if (curve.segment.type === "bezier" && !regularCubic(curve.start, curve.segment)) return false;
      if (distance(curve.start, curve.segment.end) <= tolerance) return false;
      for (let j = i + 1; j < curves.length; j++) {
        const allowed = [];
        if (j === i + 1) allowed.push(curve.segment.end);
        if (i === 0 && j === curves.length - 1) allowed.push(path.start);
        const hits = curveIntersections(curve, curves[j]);
        if (curve.segment.type === "line" && curves[j].segment.type === "line" && hits.length > 1 && distance(hits[0].point, hits[1].point) > tolerance) return false;
        if (hits.some((hit) => !allowed.some((p) => distance(p, hit.point) <= tolerance))) return false;
      }
    }
    return true;
  } catch {
    return false;
  }
}
function connectedSketchRegions(drawing) {
  const edges = [];
  const points = [];
  drawing.contours.forEach((path, index) => {
    if (path.type !== "path" || path.construction || !path.segments.length || distance(path.start, path.segments.at(-1).end) <= tolerance) return;
    const first = points.length;
    points.push(path.start, path.segments.at(-1).end);
    edges.push({ path, index, nodes: [first, first + 1] });
  });
  const parents = points.map((_, i) => i);
  function root(i) {
    while (parents[i] !== i) {
      parents[i] = parents[parents[i]];
      i = parents[i];
    }
    return i;
  }
  for (let i = 0; i < points.length; i++) for (let j = i + 1; j < points.length; j++) {
    if (distance(points[i], points[j]) <= tolerance) parents[root(j)] = root(i);
  }
  const members = /* @__PURE__ */ new Map(), incident = /* @__PURE__ */ new Map();
  points.forEach((_, i) => {
    const r = root(i);
    members.set(r, [...members.get(r) ?? [], i]);
  });
  edges.forEach((edge, i) => {
    edge.nodes = edge.nodes.map(root);
    for (const n of edge.nodes) incident.set(n, [...incident.get(n) ?? [], i]);
  });
  const ambiguous = /* @__PURE__ */ new Set();
  for (const [node, list] of members) for (const a of list) for (const b of list) {
    if (distance(points[a], points[b]) > tolerance) ambiguous.add(node);
  }
  const regions = [], issues = [], visited = /* @__PURE__ */ new Set();
  edges.forEach((first, firstIndex) => {
    if (visited.has(firstIndex)) return;
    const component = /* @__PURE__ */ new Set(), nodes = /* @__PURE__ */ new Set(), pending = [firstIndex];
    while (pending.length) {
      const id22 = pending.pop();
      if (component.has(id22)) continue;
      component.add(id22);
      visited.add(id22);
      for (const node of edges[id22].nodes) {
        nodes.add(node);
        pending.push(...incident.get(node));
      }
    }
    const indices = [...component].map((i) => edges[i].index).sort((a, b) => a - b);
    const reason = [...nodes].some((n) => ambiguous.has(n)) ? "ambiguous-endpoints" : [...nodes].some((n) => incident.get(n).length > 2) ? "branched" : [...nodes].some((n) => incident.get(n).length !== 2) ? "open" : void 0;
    if (reason) {
      issues.push({ contourIndices: indices, reason });
      return;
    }
    let current2 = first.nodes[0], id2 = firstIndex;
    const order = [], parts = [];
    do {
      const edge = edges[id2], reverse = edge.nodes[0] !== current2;
      parts.push(oriented(edge.path, reverse));
      order.push(edge.index);
      current2 = edge.nodes[reverse ? 0 : 1];
      id2 = incident.get(current2).find((candidate) => candidate !== id2);
    } while (id2 !== firstIndex && order.length <= component.size);
    const contour = { type: "path", start: parts[0].start, segments: parts.flatMap((p) => p.segments) };
    if (order.length !== component.size || !simpleBoundary(contour)) {
      issues.push({ contourIndices: indices, reason: "invalid-boundary" });
      return;
    }
    const ids = order.map((index) => drawing.contours[index].id);
    regions.push({ contourIndices: order, ...ids.every((value2) => !!value2) && new Set(ids).size === ids.length ? { contourIds: ids } : {}, contour });
  });
  const isolated = regions.filter((region) => {
    const boundary = region.contour.segments.map((segment, i) => ({ start: i ? region.contour.segments[i - 1].end : region.contour.start, segment }));
    try {
      for (let i = 0; i < drawing.contours.length; i++) {
        const other = drawing.contours[i];
        if (other.construction || region.contourIndices.includes(i)) continue;
        const curves = other.type === "circle" ? circleSegments(other.center, other.radius) : other.segments.map((segment, j) => ({ start: j ? other.segments[j - 1].end : other.start, segment }));
        if (boundary.some((a) => curves.some((b) => curveIntersections(a, b).length > 0))) {
          issues.push({ contourIndices: region.contourIndices, reason: "invalid-boundary" });
          return false;
        }
      }
      return true;
    } catch {
      issues.push({ contourIndices: region.contourIndices, reason: "invalid-boundary" });
      return false;
    }
  });
  return { regions: isolated, issues };
}
function sketchFaceRegions(drawing) {
  const closed = drawing.contours.flatMap((contour, index) => contour.construction || !contourClosed(contour) ? [] : [{
    contourIndex: index,
    contour,
    sourceContourIndices: [index],
    sourceContourIds: contour.id ? [contour.id] : void 0
  }]);
  const joined = connectedSketchRegions(drawing).regions.map((region) => ({
    contourIndex: Math.min(...region.contourIndices),
    contour: region.contour,
    sourceContourIndices: region.contourIndices,
    sourceContourIds: region.contourIds
  }));
  return [...closed, ...joined].sort((a, b) => a.contourIndex - b.contourIndex);
}
function associativePlane(doc, id2, before) {
  const index = doc.features.findIndex((f) => f.id === id2), plane2 = doc.features[index];
  if (index < 0 || index >= before || plane2.type !== "plane" || plane2.suppressed) throw Error("Starting reference plane is unavailable. Reselect an earlier plane.");
  const definition = plane2.definition;
  if (definition) {
    if (!["offset", "mid"].includes(definition.method)) throw Error("This starting plane uses captured geometry. Choose a datum derived from principal planes or select a solid face directly.");
    const refs = definition.method === "offset" ? [definition.reference] : definition.method === "mid" ? definition.references : [];
    for (const ref of refs) {
      if (ref.kind === "face") throw Error("This starting plane uses a captured face. Select the solid face directly to follow model changes.");
      if (ref.kind === "feature") associativePlane(doc, ref.featureId, index);
    }
  }
  return plane2;
}
function nativeExtrusionStart(doc, ref, beforeFeatureId) {
  if (ref.kind === "face") return ref;
  if (ref.kind === "principal") return { kind: "plane", frame: principalFrame(ref.plane) };
  const before = beforeFeatureId ? doc.features.findIndex((f) => f.id === beforeFeatureId) : rollbackPosition(doc);
  const plane2 = associativePlane(doc, ref.sourceFeatureId, before);
  return { kind: "plane", frame: resolvePlaneFrame(plane2, doc.features.slice(0, doc.features.indexOf(plane2))) };
}
const soleRegion = (feature) => ({
  regions: [{ engineId: feature.id, contourIndex: 0, label: "Region 1", feature }],
  skipped: []
});
const regionKey = (region, fallback) => region.sourceContourIndices ? `connected:${JSON.stringify([...region.sourceContourIds ?? region.sourceContourIndices].sort())}` : region.contourId ?? fallback;
const planeName = (plane2) => typeof plane2 === "string" ? plane2 : "XY";
function profileFeature(feature, pierceChecks = /* @__PURE__ */ new Map()) {
  if (feature.type !== "profile" && feature.type !== "sketch")
    return `a ${feature.type} feature is not a profile`;
  const profile = feature.profile;
  if (!profile || typeof profile !== "object") return "the sketch has no profile";
  const plane2 = planeName(feature.plane);
  const offset_mm = feature.offsetMillimeters ?? 0;
  const frame = "frame" in feature ? feature.frame : void 0;
  const placement = { plane: plane2, offset_mm, ...frame ? { frame } : {}, ...feature.type === "profile" && feature.support ? { support: feature.support, source_profile_id: feature.id } : {} };
  if (profile.type === "circle") {
    const radius = Number(profile.radiusMillimeters);
    const center = profile.centerMillimeters ?? [0, 0];
    if (!Number.isFinite(radius) || radius <= 0) return "the circle has no positive radius";
    return soleRegion({
      id: feature.id,
      kind: "sketch-circle",
      parameters: { radius_mm: radius, center_mm: center, ...placement }
    });
  }
  if (profile.type === "center-rectangle") {
    const width = Number(profile.widthMillimeters);
    const height = Number(profile.heightMillimeters);
    const x = Number(profile.centerXMillimeters ?? 0);
    const y = Number(profile.centerYMillimeters ?? 0);
    if (!(width > 0) || !(height > 0)) return "the rectangle has no positive size";
    if (profile.construction) return "a construction rectangle makes no solid";
    const halfWidth = width / 2;
    const halfHeight = height / 2;
    return soleRegion({
      id: feature.id,
      kind: "sketch-polygon",
      parameters: {
        points_mm: [
          [x - halfWidth, y - halfHeight],
          [x + halfWidth, y - halfHeight],
          [x + halfWidth, y + halfHeight],
          [x - halfWidth, y + halfHeight]
        ],
        ...placement
      }
    });
  }
  if (profile.type === "polygon") {
    const points = profile.pointsMillimeters ?? [];
    if (points.length < 3) return "the polygon has fewer than three points";
    return soleRegion({
      id: feature.id,
      kind: "sketch-polygon",
      parameters: { points_mm: points, ...placement }
    });
  }
  if (profile.type === "drawing") {
    const contours = profile.contours ?? [];
    const regions = [];
    const skipped = [];
    contours.forEach((contour, index) => {
      if (contour.construction) return;
      const blocked = blockedSketchGeometry(profile, index);
      const checks = pierceChecks.get(index);
      const fixed = { ...blocked.length ? { blocked_geometry: blocked } : {}, ...checks ? { pierce_checks: checks } : {} };
      const contourId = typeof contour.id === "string" ? contour.id : void 0;
      const engineId = contours.length === 1 ? feature.id : `${feature.id}#${index}`;
      const label = `Region ${index + 1}`;
      if (contour.type === "circle") {
        const radius = Number(contour.radius);
        const center = contour.center ?? [0, 0];
        if (!Number.isFinite(radius) || radius <= 0)
          return void skipped.push(`${label} is a circle with no positive radius`);
        regions.push({
          engineId,
          contourId,
          contourIndex: index,
          label: `${label} · circle`,
          feature: {
            id: engineId,
            kind: "sketch-circle",
            parameters: { radius_mm: radius, center_mm: center, ...placement, ...fixed }
          }
        });
        return;
      }
      const points = polygonFromStraightContour(contour);
      const segments = contour.segments ?? [];
      const start = contour.start;
      if (contour.type !== "path" || !start || !segments.length) return;
      const end = segments.at(-1).end;
      const closed = Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-6;
      if (!segments.every((segment) => ["line", "arc", "bezier", "ellipse", "conic"].includes(String(segment.type)))) {
        skipped.push(`${label} contains an unsupported curve`);
        return;
      }
      if (segments.some((segment) => segment.type === "arc" && !Array.isArray(segment.middle))) {
        skipped.push(`${label} has an arc without its middle point`);
        return;
      }
      regions.push({
        engineId,
        contourId,
        contourIndex: index,
        label: points ? `${label} · ${points.length} sides` : `${label} · ${closed ? "curved" : "open path"}`,
        closed,
        feature: points && !blocked.length && !checks ? { id: engineId, kind: "sketch-polygon", parameters: { points_mm: points, ...placement } } : { id: engineId, kind: "sketch-wire", parameters: { start_mm: start, segments: nativeWireSegments(start, segments), ...placement, ...fixed } }
      });
    });
    for (const boundary of sketchFaceRegions(profile)) {
      if (boundary.sourceContourIndices.length < 2) continue;
      const sources = boundary.sourceContourIndices.map((index) => regions.find((region) => region.contourIndex === index && !region.sourceContourIndices));
      if (sources.some((source) => !source || source.closed !== false)) continue;
      const engineId = `${feature.id}#joined#${boundary.contourIndex}`;
      regions.push({
        engineId,
        contourIndex: boundary.contourIndex,
        sourceContourIndices: boundary.sourceContourIndices,
        sourceContourIds: boundary.sourceContourIds,
        previewContour: boundary.contour,
        closed: true,
        label: `Region ${boundary.contourIndex + 1} · ${sources.length} connected curves`,
        feature: { id: engineId, kind: "sketch-region", parameters: { profiles: sources.map((source) => source.engineId) } }
      });
    }
    if (!regions.length && skipped.length) return skipped[0];
    return { regions, skipped };
  }
  if (profile.type === "projection") return "projected sketches are not translated yet";
  return `a ${String(profile.type)} profile is not translated yet`;
}
function polygonFromStraightContour(contour) {
  if (contour.type !== "path") return null;
  const start = contour.start;
  const segments = contour.segments ?? [];
  if (!start || !segments.length) return null;
  if (!segments.every((segment) => segment.type === "line")) return null;
  const points = [start];
  for (const segment of segments) {
    const end = segment.end;
    points.push(end);
  }
  const last = points[points.length - 1];
  if (Math.hypot(last[0] - start[0], last[1] - start[1]) >= 1e-6) return null;
  points.pop();
  return points.length >= 3 ? points : null;
}
function translateDocument(document) {
  const features = [];
  const untranslated = [];
  const profileRegions = /* @__PURE__ */ new Map();
  const solids = /* @__PURE__ */ new Set();
  const paths = /* @__PURE__ */ new Map();
  let lastBody;
  const bodyParameters = (feature) => {
    const operation2 = "operation" in feature ? feature.operation : void 0;
    if (feature.type === "extrude" && feature.scopeMode === "all") return { operation: operation2, scope_mode: "all" };
    if (operation2 === "new") {
      const bodyId2 = bodyIDForFeature(document, feature);
      lastBody = feature.type === "extrude" && feature.separateBodies && feature.bodyOutputs ? feature.bodyOutputs.at(-1) : bodyId2;
      return { body_id: bodyId2, operation: operation2 };
    }
    const bodyId = "targetBodyId" in feature && feature.targetBodyId ? feature.targetBodyId : lastBody;
    return { body_id: bodyId, operation: operation2 };
  };
  const pickRegion = (profileFeatureId, contourId, curves = false, connected) => {
    const regions = (curves ? paths : profileRegions).get(profileFeatureId);
    if (connected) {
      if (curves) return "Choose individual sketch curves for this operation.";
      return regions?.find((region) => matchesProfileRegion({ profileRegion: connected }, region)) ?? "The referenced curves no longer form the same closed region. Repair the sketch or reselect the region.";
    }
    if (!regions?.length) return "its sketch was not translated";
    if (contourId !== void 0) {
      const named = regions.find((region) => region.contourId === contourId);
      return named ?? "the region it was built on is no longer in its sketch";
    }
    if (regions.length > 1)
      return `its sketch has ${regions.length} regions — choose which one to use`;
    return regions[0];
  };
  const referenceErrors = featureReferenceErrors(document);
  const dependencies = featureDependencies(document);
  const rollback = document.rollbackIndex ?? document.features.length;
  document.features.slice(0, rollback).forEach((feature) => {
    if (feature.suppressed) return;
    const note = (reason) => untranslated.push({ id: feature.id, name: feature.name, reason });
    const referenceError = referenceErrors.get(feature.id);
    if (referenceError) return note(referenceError);
    if (dependencies.get(feature.id)?.some((id2) => untranslated.some((item) => item.id === id2))) return note("A referenced feature could not be built. Repair it first.");
    if (feature.type === "profile" || feature.type === "sketch") {
      let mapped;
      try {
        if (feature.type === "profile") {
          const drawing = resolveProfileDrawing(document.features, feature.id);
          const pierce = nativePierceChecks(document.features, feature, drawing);
          mapped = profileFeature({ ...feature, profile: drawing }, pierce.checks);
          if (typeof mapped !== "string") {
            features.push(...pierce.sources);
            for (const [index, target] of pierce.targets) if (!mapped.regions.some((r) => r.contourIndex === index)) features.push(target);
          }
        } else mapped = profileFeature(feature);
      } catch (error) {
        return note(error.message);
      }
      if (typeof mapped === "string") return note(mapped);
      mapped.regions.forEach((region) => features.push(region.feature));
      profileRegions.set(feature.id, mapped.regions.filter((region) => region.closed !== false));
      paths.set(feature.id, mapped.regions.filter((region) => !region.sourceContourIndices));
      mapped.skipped.forEach(note);
      return;
    }
    if (feature.type === "import-step" || feature.type === "import-cad") {
      features.push({ id: feature.id, kind: feature.type, parameters: {
        ...bodyParameters(feature),
        data_base64: feature.dataBase64,
        ...feature.type === "import-cad" ? { format: feature.format, mesh_mode: feature.meshMode, mesh_units: feature.meshUnits } : {}
      } });
      if (feature.type === "import-step" || feature.meshMode !== "reference") solids.add(feature.id);
      return;
    }
    if (feature.type === "plane") return;
    if (feature.type === "extrude") {
      const extrude = feature;
      const selectionGroups = /* @__PURE__ */ new Map();
      for (const selection of feature.profileSelections ?? []) {
        const r = pickRegion(selection.profileFeatureId, selection.profileContourId, !!feature.thin, selection.profileRegion);
        if (typeof r === "string") return note(r);
        const group = selectionGroups.get(selection.profileFeatureId) ?? [];
        group.push(r);
        selectionGroups.set(selection.profileFeatureId, group);
      }
      const picked = feature.profileContourIds?.map((id2) => pickRegion(extrude.profileFeatureId, id2, !!feature.thin));
      if (picked?.some((region2) => typeof region2 === "string")) return note("A selected region is no longer in its sketch.");
      const region = selectionGroups.values().next().value?.[0] ?? picked?.[0] ?? pickRegion(extrude.profileFeatureId, extrude.profileContourId, !!feature.thin, feature.profileRegion);
      if (typeof region === "string") return note(region);
      if (!(extrude.distanceMillimeters > 0))
        return note("the extrude distance is not positive");
      const secondEnd = feature.secondEnd;
      let directionReference, pointReference, oppositePointReference, startingReference;
      try {
        if (feature.startingReference) startingReference = nativeExtrusionStart(document, feature.startingReference, feature.id);
        if (feature.endType === "up-to-vertex" && feature.endPointReference) pointReference = nativeExtrusionPoint(document, feature.endPointReference, feature.id);
        if (secondEnd?.endType === "up-to-vertex" && secondEnd.endPointReference) oppositePointReference = nativeExtrusionPoint(document, secondEnd.endPointReference, feature.id);
        if (feature.directionReference) directionReference = nativeSketchDirection(document, feature.directionReference, feature.id);
      } catch (error) {
        return note(error.message);
      }
      const sources = feature.thin ? paths : profileRegions;
      const thin = feature.thin ? { thin: { thickness_1_mm: feature.thin.thickness1Millimeters, thickness_2_mm: feature.thin.thickness2Millimeters, midplane: feature.thin.midplane ?? false, midplane_thickness_mm: feature.thin.midplaneThicknessMillimeters, flipped: feature.thin.flipped ?? false } } : {};
      const body = { ...bodyParameters(feature), ...thin, ...startingReference ? { starting_reference: startingReference } : {}, ...pointReference ? { end_point_reference: pointReference } : {}, ...directionReference ? { direction_reference: directionReference } : {}, ...feature.directionVector ? { direction_vector: feature.directionVector } : {}, ...secondEnd ? { second_end: { ...oppositePointReference ? { end_point_reference: oppositePointReference } : {}, end_type: secondEnd.endType, distance_mm: secondEnd.distanceMillimeters, end_offset_mm: secondEnd.endOffsetMillimeters ?? 0, draft_angle_deg: secondEnd.draftAngleDegrees ?? 0, ...secondEnd.endType === "up-to-part" ? { end_part_id: secondEnd.endPartId } : {}, ...secondEnd.endType === "up-to-face" ? { end_reference: secondEnd.endReference } : {} } } : {}, ...feature.targetBodyIds ? { target_body_ids: feature.targetBodyIds } : {}, end_type: feature.endType ?? "blind", ...feature.endType === "up-to-part" ? { end_part_id: feature.endPartId } : {}, ...feature.endType === "up-to-face" ? { end_reference: feature.endReference } : {}, starting_offset_mm: feature.startingOffsetMillimeters ?? 0, end_offset_mm: feature.endOffsetMillimeters ?? 0, second_distance_mm: feature.secondDistanceMillimeters, draft_angle_deg: feature.draftAngleDegrees ?? 0, ...feature.profileRegion || feature.scopeMode || feature.startingReference || feature.thin || feature.directionReference || feature.directionVector || feature.secondEnd || feature.draftAngleDegrees || feature.targetBodyIds || feature.operation === "intersect" || feature.profileSelections || feature.separateBodies || feature.regionMode === "faces" || feature.endType || feature.startingOffsetMillimeters || feature.secondDistanceMillimeters ? {
        region_mode: true,
        ...feature.profileSelections ? { profile_groups: [...selectionGroups].map(([sourceId, choices]) => ({ profiles: choices.map((r) => r.engineId), profile_regions: sources.get(sourceId).map((r) => r.engineId), profile_keys: Object.fromEntries(sources.get(sourceId).map((r) => [r.engineId, sourceId === feature.profileFeatureId ? regionKey(r, sourceId) : `${sourceId}:${regionKey(r, sourceId)}`])) })) } : {},
        separate_bodies: feature.separateBodies === true && feature.operation === "new",
        profile_keys: Object.fromEntries(sources.get(extrude.profileFeatureId).map((r) => [r.engineId, regionKey(r, extrude.profileFeatureId)])),
        profiles: (picked ?? [region]).map((r) => r.engineId),
        profile_regions: feature.regionMode === "faces" ? sources.get(extrude.profileFeatureId).map((r) => r.engineId) : [region.engineId]
      } : {} };
      features.push(
        extrude.operation === "cut" ? {
          id: feature.id,
          kind: "pocket",
          parameters: {
            ...body,
            reversed: extrude.reversed ?? false,
            profile: region.engineId,
            depth_mm: extrude.distanceMillimeters
          }
        } : {
          id: feature.id,
          kind: "pad",
          parameters: {
            ...body,
            reversed: extrude.reversed ?? false,
            profile: region.engineId,
            distance_mm: extrude.distanceMillimeters
          }
        }
      );
      solids.add(feature.id);
      if (feature.scopeMode === "all") lastBody = feature.scopeResolution?.groups.at(-1)?.bodyId ?? lastBody;
      if (feature.operation === "add" && (feature.targetBodyIds?.length ?? 0) > 1) lastBody = feature.targetBodyId;
      return;
    }
    if (feature.type === "revolve") {
      const revolve = feature;
      const spun = pickRegion(revolve.profileFeatureId, revolve.profileContourId, false, feature.profileRegion);
      if (typeof spun === "string") return note(spun);
      if (!(revolve.angleDegrees > 0 && revolve.angleDegrees <= 360))
        return note("the revolve angle is not between 0 and 360 degrees");
      features.push({
        id: feature.id,
        kind: "revolve",
        parameters: {
          ...bodyParameters(feature),
          profile: spun.engineId,
          axis: revolve.axis,
          angle_deg: revolve.angleDegrees,
          symmetric: feature.symmetric ?? false,
          reversed: feature.reversed ?? false,
          second_angle_deg: feature.secondAngleDegrees ?? 0,
          cut: revolve.operation === "cut"
        }
      });
      solids.add(feature.id);
      return;
    }
    if (feature.type === "mirror") {
      const mirror = feature;
      if (!solids.has(mirror.sourceFeatureId))
        return note("the feature it mirrors was not translated");
      if (mirror.operation !== "add")
        return note("a mirror that cuts is not translated yet");
      features.push({
        id: feature.id,
        kind: "mirror",
        parameters: {
          ...bodyParameters(feature),
          source: mirror.sourceFeatureId,
          plane: planeName(mirror.plane),
          offset_mm: mirror.offsetMillimeters
        }
      });
      solids.add(feature.id);
      return;
    }
    if (feature.type === "fillet" || feature.type === "chamfer") {
      const finish = feature;
      if (!(finish.radiusMillimeters > 0))
        return note("the edge finish has no positive size");
      features.push({
        id: feature.id,
        kind: feature.type,
        parameters: {
          ...bodyParameters(feature),
          radius_mm: finish.radiusMillimeters,
          // No plane means every edge, which is what the document means by
          // leaving the selection off.
          ...finish.edgePlane ? {
            plane: planeName(finish.edgePlane.plane),
            offset_mm: finish.edgePlane.offsetMillimeters
          } : {}
        }
      });
      return;
    }
    if (feature.type === "sweep") {
      const sweep = feature;
      const profile = pickRegion(sweep.profileFeatureId, sweep.profileContourId, false, sweep.profileRegion);
      if (typeof profile === "string") return note(profile);
      const path = paths.get(sweep.pathFeatureId);
      const chosenPath = sweep.pathContourId ? path?.find((region) => region.contourId === sweep.pathContourId) : path?.length === 1 ? path[0] : void 0;
      if (!chosenPath) return note("Choose one sweep path contour.");
      features.push({
        id: feature.id,
        kind: "sweep",
        parameters: {
          ...bodyParameters(feature),
          profile: profile.engineId,
          path: chosenPath.engineId,
          cut: sweep.operation === "cut"
        }
      });
      return;
    }
    if (feature.type === "boolean") {
      features.push({ id: feature.id, kind: "boolean", parameters: {
        body_id: feature.targetBodyId,
        boolean_operation: feature.operation,
        tool_body_ids: [...feature.toolBodyIds],
        keep_tools: feature.keepTools
      } });
      if (!feature.keepTools) lastBody = feature.targetBodyId;
      solids.add(feature.id);
      return;
    }
    if (feature.type === "pattern") {
      if (!solids.has(feature.sourceFeatureId)) return note("The source feature could not be built.");
      features.push({ id: feature.id, kind: "pattern", parameters: {
        ...bodyParameters(feature),
        source: feature.sourceFeatureId,
        pattern_type: feature.patternType,
        axis: feature.axis,
        count: feature.count,
        reversed: feature.reversed,
        ...feature.patternType === "linear" ? { spacing_mm: feature.spacingMillimeters } : { angle_deg: feature.angleDegrees }
      } });
      solids.add(feature.id);
      return;
    }
    if (feature.type === "draft") {
      features.push({ id: feature.id, kind: "draft", parameters: {
        ...bodyParameters(feature),
        angle_deg: feature.angleDegrees,
        reversed: feature.reversed,
        face_plane: feature.facePlane.plane,
        face_offset_mm: feature.facePlane.offsetMillimeters,
        neutral_plane: feature.neutralPlane.plane,
        neutral_offset_mm: feature.neutralPlane.offsetMillimeters
      } });
      solids.add(feature.id);
      return;
    }
    if (feature.type === "loft") {
      const sections = feature.sections.map((section) => pickRegion(section.profileFeatureId, section.profileContourId, false, section.profileRegion));
      const invalid = sections.find((section) => typeof section === "string");
      if (typeof invalid === "string") return note(invalid);
      if (sections.length < 2) return note("Choose at least two loft sections.");
      features.push({ id: feature.id, kind: "loft", parameters: {
        ...bodyParameters(feature),
        sections: sections.map((section) => section.engineId),
        ruled: feature.ruled
      } });
      solids.add(feature.id);
      return;
    }
    if (feature.type === "hole") {
      const region = pickRegion(feature.profileFeatureId, feature.profileContourId);
      if (typeof region === "string") return note(region);
      if (region.feature.kind !== "sketch-circle") return note("Choose a circular sketch region for the hole center.");
      features.push({ id: feature.id, kind: "hole", parameters: {
        ...bodyParameters(feature),
        operation: "cut",
        profile: region.engineId,
        diameter_mm: feature.diameterMillimeters,
        depth_mm: feature.depthMillimeters,
        depth_type: feature.depthType,
        cut_type: feature.cutType,
        counter_diameter_mm: feature.counterDiameterMillimeters,
        counter_depth_mm: feature.counterDepthMillimeters,
        countersink_angle_deg: feature.countersinkAngleDegrees,
        reversed: feature.reversed ?? false
      } });
      solids.add(feature.id);
      return;
    }
    if (feature.type === "transform") {
      let transform;
      try {
        transform = nativePartTransform(document, feature.transform, feature.id);
      } catch (error) {
        return note(error.message);
      }
      features.push({ id: feature.id, kind: "transform", parameters: { body_ids: feature.bodyIds, transform, ...feature.copyBodyIds ? { copy_body_ids: feature.copyBodyIds } : {} } });
      if (feature.copyBodyIds) lastBody = feature.copyBodyIds[feature.bodyIds.at(-1)];
      solids.add(feature.id);
      return;
    }
    if (feature.type === "offset-face") {
      let motion;
      try {
        motion = feature.transform ? { transform: nativePartTransform(document, feature.transform, feature.id) } : { distance_mm: feature.distanceMillimeters };
      } catch (error) {
        return note(error.message);
      }
      features.push({ id: feature.id, kind: "offset-face", parameters: { faces: feature.faces, ...motion } });
      solids.add(feature.id);
      return;
    }
    if (feature.type === "face-extrude") {
      features.push({ id: feature.id, kind: "face-extrude", parameters: { ...bodyParameters(feature), operation: feature.distanceMillimeters > 0 ? "add" : "cut", source_feature_id: feature.sourceFeatureId, normal: feature.normal, ...feature.faceAnchor ? { face_anchor: feature.faceAnchor } : {}, distance_mm: feature.distanceMillimeters } });
      solids.add(feature.id);
      return;
    }
    if (feature.type === "shell") {
      const shell = feature;
      features.push({
        id: feature.id,
        kind: "shell",
        parameters: {
          ...bodyParameters(feature),
          thickness_mm: shell.thicknessMillimeters,
          ...shell.removedFaces && shell.removedFaces.length > 0 ? {
            removed_plane: planeName(shell.removedFaces[0].plane),
            removed_offset_mm: shell.removedFaces[0].offsetMillimeters
          } : {}
        }
      });
      return;
    }
    note(`Unsupported feature type ${feature.type}.`);
  });
  return { features, untranslated, complete: untranslated.length === 0 };
}
function resolveBodyOutputs(document, outputs = {}) {
  const cutoff = rollbackPosition(document);
  const expected = new Set(document.features.slice(0, cutoff).filter((f) => !f.suppressed && (f.type === "extrude" && f.operation === "new" && f.separateBodies || f.type === "transform" && f.copyBodyIds)).map((f) => f.id));
  if (Object.keys(outputs).some((id2) => !expected.has(id2))) throw new Error("Rebuild returned an unknown body producer.");
  const next = { ...document, features: document.features.map((feature) => {
    if (!expected.has(feature.id)) return feature;
    const ids = outputs[feature.id];
    if (feature.type === "transform") {
      const expected2 = createdBodyIDs(document, feature);
      if (!Array.isArray(ids) || ids.length !== expected2.length || new Set(ids).size !== ids.length || ids.some((id2) => !expected2.includes(id2))) throw Error(`${feature.name}: rebuild changed the saved copy identities.`);
      return feature;
    }
    const prefix = `${bodyIDForFeature(document, feature)}:solid-`;
    if (!Array.isArray(ids) || !ids.length || ids.some((id2) => typeof id2 !== "string" || !id2.startsWith(prefix)) || new Set(ids).size !== ids.length)
      throw new Error(`${feature.name}: rebuild did not return distinct output body identities.`);
    return { ...feature, bodyOutputs: [...ids] };
  }) };
  validatePartDocument(next);
  return next;
}
function resolveSketchFrames(doc, frames = {}) {
  const active = new Set(doc.features.slice(0, rollbackPosition(doc)).filter((f) => f.type === "profile" && f.support && !f.suppressed).map((f) => f.id));
  if (Object.keys(frames).some((id2) => !active.has(id2))) throw new Error("Rebuild returned an unknown sketch support.");
  const next = { ...doc, features: doc.features.map((f) => {
    if (!active.has(f.id)) return f;
    if (!frames[f.id]) throw new Error(`${f.name}: support plane was not resolved. Reselect a planar face.`);
    return { ...f, frame: frames[f.id] };
  }) };
  validatePartDocument(next);
  return next;
}
const writes = /* @__PURE__ */ new Set(["cad.revolve.setextent", "cad.extrude.setoffset", "cad.extrude.setdepth", "cad.feature.suppress", "cad.feature.move"]);
const supported = /* @__PURE__ */ new Set(["cad.revolve.preview", "cad.part.inspect", "cad.part.evaluate", "cad.part.verify", "cad.part.topology", "cad.extrude.preview", "cad.extrude.previewoffset", ...writes]);
function describe(doc) {
  return {
    name: doc.name,
    document_id: doc.documentId,
    units: doc.units,
    rollback_index: rollbackPosition(doc),
    bodies: availableBodies(doc),
    features: doc.features.map((f) => ({
      id: f.id,
      name: f.name,
      type: f.type,
      suppressed: f.suppressed,
      ...f.type === "revolve" ? { angle_deg: f.angleDegrees, second_angle_deg: f.secondAngleDegrees ?? 0, symmetric: f.symmetric ?? false, reversed: f.reversed ?? false, axis: f.axis, operation: f.operation } : {},
      ...f.type === "extrude" ? { depth_mm: f.distanceMillimeters, end_offset_mm: f.endOffsetMillimeters ?? 0, operation: f.operation, end_type: f.endType ?? "blind", target_body_id: f.targetBodyId, end_part_id: f.endPartId, end_point_reference: f.endPointReference, scope_mode: f.scopeMode, scope_resolution: f.scopeResolution, starting_reference: f.startingReference, starting_offset_mm: f.startingOffsetMillimeters ?? 0 } : {}
    }))
  };
}
function prepareCommand(command, content, args) {
  if (!supported.has(command)) throw Error("Unknown CAD command.");
  const doc = parsePartDocument(content);
  if (doc.features.length > 512) throw Error("CAD automation supports at most 512 features.");
  if (command === "cad.part.inspect") return { result: describe(doc) };
  let next = structuredClone(doc);
  if (!["cad.part.evaluate", "cad.part.verify", "cad.part.topology"].includes(command)) {
    if (rollbackPosition(doc) !== doc.features.length) throw Error("Move the rollback bar to the end before editing this saved part.");
    const index = doc.features.findIndex((f) => f.id === args.feature_id);
    if (index < 0) throw Error("Feature not found. Inspect the part first.");
    const feature = doc.features[index];
    if (command.startsWith("cad.revolve.")) {
      if (feature.type !== "revolve" || feature.suppressed) throw Error("Select an unsuppressed Revolve feature.");
      if (typeof args.angle_deg !== "number" || !Number.isFinite(args.angle_deg) || typeof args.second_angle_deg !== "number" || !Number.isFinite(args.second_angle_deg) || typeof args.symmetric !== "boolean" || typeof args.reversed !== "boolean")
        throw Error("Specify the angle, opposite angle, symmetric and reverse settings.");
      if (feature.angleDegrees !== args.angle_deg || (feature.secondAngleDegrees ?? 0) !== args.second_angle_deg || (feature.symmetric ?? false) !== args.symmetric || (feature.reversed ?? false) !== args.reversed) {
        const updated = { ...feature, angleDegrees: args.angle_deg };
        delete updated.secondAngleDegrees;
        delete updated.symmetric;
        delete updated.reversed;
        if (args.second_angle_deg) updated.secondAngleDegrees = args.second_angle_deg;
        if (args.symmetric) updated.symmetric = true;
        if (args.reversed) updated.reversed = true;
        next.features[index] = updated;
      }
    } else if (command.startsWith("cad.extrude.")) {
      if (feature.type !== "extrude") throw Error("Select an Extrude feature.");
      if (feature.suppressed) throw Error("Unsuppress this extrusion before changing its depth.");
      if (command.endsWith("offset")) {
        if (!["up-to-next", "up-to-face", "up-to-part", "up-to-vertex"].includes(feature.endType ?? "")) throw Error("End offset requires a supported stopping limit.");
        if (typeof args.end_offset_mm !== "number" || !Number.isFinite(args.end_offset_mm) || Math.abs(args.end_offset_mm) > 1e6) throw Error("End offset must be finite and within 1000000 mm.");
        if ((feature.endOffsetMillimeters ?? 0) !== args.end_offset_mm) {
          const updated = { ...feature };
          if (args.end_offset_mm === 0) delete updated.endOffsetMillimeters;
          else updated.endOffsetMillimeters = args.end_offset_mm;
          next.features[index] = updated;
        }
      } else {
        if (!["blind", "symmetric"].includes(feature.endType ?? "blind")) throw Error("This end condition is not controlled by a depth.");
        if (typeof args.depth_mm !== "number" || !Number.isFinite(args.depth_mm) || args.depth_mm <= 0 || args.depth_mm > 1e6) throw Error("Depth must be greater than zero and at most 1000000 mm.");
        next.features[index] = { ...feature, distanceMillimeters: args.depth_mm };
      }
    } else if (command === "cad.feature.suppress") {
      if (!["suppress", "unsuppress"].includes(args.action ?? "")) throw Error("Choose suppress or unsuppress.");
      next = setFeatureSuppressed(doc, feature.id, args.action === "suppress");
    } else {
      if (args.direction !== -1 && args.direction !== 1) throw Error("Move one history position up or down.");
      next = moveFeature(doc, feature.id, args.direction);
    }
  }
  validatePartDocument(next);
  const translation = translateDocument(next);
  if (!translation.complete) throw Error("The native engine cannot evaluate the complete part: " + translation.untranslated.map((f) => `${f.name}: ${f.reason}`).join("; ").slice(0, 1500));
  const candidate = serializePartDocument(next);
  return {
    result: { ...describe(next), preview: command.startsWith("cad.extrude.preview") || command === "cad.revolve.preview", pixel_preview: false },
    features: translation.features,
    candidate,
    changed: writes.has(command) && candidate !== serializePartDocument(doc)
  };
}
function finalizeCandidate(content, outputs, frames = {}, scopes = {}) {
  return serializePartDocument(resolveExtrusionScopes(resolveSketchFrames(resolveBodyOutputs(parsePartDocument(content), outputs), frames), scopes));
}
const REVISION = "180";
const WebGLCoordinateSystem = 2e3;
const WebGPUCoordinateSystem = 2001;
function clamp(value2, min, max) {
  return Math.max(min, Math.min(max, value2));
}
class Quaternion {
  /**
   * Constructs a new quaternion.
   *
   * @param {number} [x=0] - The x value of this quaternion.
   * @param {number} [y=0] - The y value of this quaternion.
   * @param {number} [z=0] - The z value of this quaternion.
   * @param {number} [w=1] - The w value of this quaternion.
   */
  constructor(x = 0, y = 0, z = 0, w = 1) {
    this.isQuaternion = true;
    this._x = x;
    this._y = y;
    this._z = z;
    this._w = w;
  }
  /**
   * Interpolates between two quaternions via SLERP. This implementation assumes the
   * quaternion data are managed  in flat arrays.
   *
   * @param {Array<number>} dst - The destination array.
   * @param {number} dstOffset - An offset into the destination array.
   * @param {Array<number>} src0 - The source array of the first quaternion.
   * @param {number} srcOffset0 - An offset into the first source array.
   * @param {Array<number>} src1 -  The source array of the second quaternion.
   * @param {number} srcOffset1 - An offset into the second source array.
   * @param {number} t - The interpolation factor in the range `[0,1]`.
   * @see {@link Quaternion#slerp}
   */
  static slerpFlat(dst, dstOffset, src0, srcOffset0, src1, srcOffset1, t) {
    let x0 = src0[srcOffset0 + 0], y0 = src0[srcOffset0 + 1], z0 = src0[srcOffset0 + 2], w0 = src0[srcOffset0 + 3];
    const x1 = src1[srcOffset1 + 0], y1 = src1[srcOffset1 + 1], z1 = src1[srcOffset1 + 2], w1 = src1[srcOffset1 + 3];
    if (t === 0) {
      dst[dstOffset + 0] = x0;
      dst[dstOffset + 1] = y0;
      dst[dstOffset + 2] = z0;
      dst[dstOffset + 3] = w0;
      return;
    }
    if (t === 1) {
      dst[dstOffset + 0] = x1;
      dst[dstOffset + 1] = y1;
      dst[dstOffset + 2] = z1;
      dst[dstOffset + 3] = w1;
      return;
    }
    if (w0 !== w1 || x0 !== x1 || y0 !== y1 || z0 !== z1) {
      let s = 1 - t;
      const cos = x0 * x1 + y0 * y1 + z0 * z1 + w0 * w1, dir = cos >= 0 ? 1 : -1, sqrSin = 1 - cos * cos;
      if (sqrSin > Number.EPSILON) {
        const sin = Math.sqrt(sqrSin), len = Math.atan2(sin, cos * dir);
        s = Math.sin(s * len) / sin;
        t = Math.sin(t * len) / sin;
      }
      const tDir = t * dir;
      x0 = x0 * s + x1 * tDir;
      y0 = y0 * s + y1 * tDir;
      z0 = z0 * s + z1 * tDir;
      w0 = w0 * s + w1 * tDir;
      if (s === 1 - t) {
        const f = 1 / Math.sqrt(x0 * x0 + y0 * y0 + z0 * z0 + w0 * w0);
        x0 *= f;
        y0 *= f;
        z0 *= f;
        w0 *= f;
      }
    }
    dst[dstOffset] = x0;
    dst[dstOffset + 1] = y0;
    dst[dstOffset + 2] = z0;
    dst[dstOffset + 3] = w0;
  }
  /**
   * Multiplies two quaternions. This implementation assumes the quaternion data are managed
   * in flat arrays.
   *
   * @param {Array<number>} dst - The destination array.
   * @param {number} dstOffset - An offset into the destination array.
   * @param {Array<number>} src0 - The source array of the first quaternion.
   * @param {number} srcOffset0 - An offset into the first source array.
   * @param {Array<number>} src1 -  The source array of the second quaternion.
   * @param {number} srcOffset1 - An offset into the second source array.
   * @return {Array<number>} The destination array.
   * @see {@link Quaternion#multiplyQuaternions}.
   */
  static multiplyQuaternionsFlat(dst, dstOffset, src0, srcOffset0, src1, srcOffset1) {
    const x0 = src0[srcOffset0];
    const y0 = src0[srcOffset0 + 1];
    const z0 = src0[srcOffset0 + 2];
    const w0 = src0[srcOffset0 + 3];
    const x1 = src1[srcOffset1];
    const y1 = src1[srcOffset1 + 1];
    const z1 = src1[srcOffset1 + 2];
    const w1 = src1[srcOffset1 + 3];
    dst[dstOffset] = x0 * w1 + w0 * x1 + y0 * z1 - z0 * y1;
    dst[dstOffset + 1] = y0 * w1 + w0 * y1 + z0 * x1 - x0 * z1;
    dst[dstOffset + 2] = z0 * w1 + w0 * z1 + x0 * y1 - y0 * x1;
    dst[dstOffset + 3] = w0 * w1 - x0 * x1 - y0 * y1 - z0 * z1;
    return dst;
  }
  /**
   * The x value of this quaternion.
   *
   * @type {number}
   * @default 0
   */
  get x() {
    return this._x;
  }
  set x(value2) {
    this._x = value2;
    this._onChangeCallback();
  }
  /**
   * The y value of this quaternion.
   *
   * @type {number}
   * @default 0
   */
  get y() {
    return this._y;
  }
  set y(value2) {
    this._y = value2;
    this._onChangeCallback();
  }
  /**
   * The z value of this quaternion.
   *
   * @type {number}
   * @default 0
   */
  get z() {
    return this._z;
  }
  set z(value2) {
    this._z = value2;
    this._onChangeCallback();
  }
  /**
   * The w value of this quaternion.
   *
   * @type {number}
   * @default 1
   */
  get w() {
    return this._w;
  }
  set w(value2) {
    this._w = value2;
    this._onChangeCallback();
  }
  /**
   * Sets the quaternion components.
   *
   * @param {number} x - The x value of this quaternion.
   * @param {number} y - The y value of this quaternion.
   * @param {number} z - The z value of this quaternion.
   * @param {number} w - The w value of this quaternion.
   * @return {Quaternion} A reference to this quaternion.
   */
  set(x, y, z, w) {
    this._x = x;
    this._y = y;
    this._z = z;
    this._w = w;
    this._onChangeCallback();
    return this;
  }
  /**
   * Returns a new quaternion with copied values from this instance.
   *
   * @return {Quaternion} A clone of this instance.
   */
  clone() {
    return new this.constructor(this._x, this._y, this._z, this._w);
  }
  /**
   * Copies the values of the given quaternion to this instance.
   *
   * @param {Quaternion} quaternion - The quaternion to copy.
   * @return {Quaternion} A reference to this quaternion.
   */
  copy(quaternion) {
    this._x = quaternion.x;
    this._y = quaternion.y;
    this._z = quaternion.z;
    this._w = quaternion.w;
    this._onChangeCallback();
    return this;
  }
  /**
   * Sets this quaternion from the rotation specified by the given
   * Euler angles.
   *
   * @param {Euler} euler - The Euler angles.
   * @param {boolean} [update=true] - Whether the internal `onChange` callback should be executed or not.
   * @return {Quaternion} A reference to this quaternion.
   */
  setFromEuler(euler, update = true) {
    const x = euler._x, y = euler._y, z = euler._z, order = euler._order;
    const cos = Math.cos;
    const sin = Math.sin;
    const c1 = cos(x / 2);
    const c2 = cos(y / 2);
    const c3 = cos(z / 2);
    const s1 = sin(x / 2);
    const s2 = sin(y / 2);
    const s3 = sin(z / 2);
    switch (order) {
      case "XYZ":
        this._x = s1 * c2 * c3 + c1 * s2 * s3;
        this._y = c1 * s2 * c3 - s1 * c2 * s3;
        this._z = c1 * c2 * s3 + s1 * s2 * c3;
        this._w = c1 * c2 * c3 - s1 * s2 * s3;
        break;
      case "YXZ":
        this._x = s1 * c2 * c3 + c1 * s2 * s3;
        this._y = c1 * s2 * c3 - s1 * c2 * s3;
        this._z = c1 * c2 * s3 - s1 * s2 * c3;
        this._w = c1 * c2 * c3 + s1 * s2 * s3;
        break;
      case "ZXY":
        this._x = s1 * c2 * c3 - c1 * s2 * s3;
        this._y = c1 * s2 * c3 + s1 * c2 * s3;
        this._z = c1 * c2 * s3 + s1 * s2 * c3;
        this._w = c1 * c2 * c3 - s1 * s2 * s3;
        break;
      case "ZYX":
        this._x = s1 * c2 * c3 - c1 * s2 * s3;
        this._y = c1 * s2 * c3 + s1 * c2 * s3;
        this._z = c1 * c2 * s3 - s1 * s2 * c3;
        this._w = c1 * c2 * c3 + s1 * s2 * s3;
        break;
      case "YZX":
        this._x = s1 * c2 * c3 + c1 * s2 * s3;
        this._y = c1 * s2 * c3 + s1 * c2 * s3;
        this._z = c1 * c2 * s3 - s1 * s2 * c3;
        this._w = c1 * c2 * c3 - s1 * s2 * s3;
        break;
      case "XZY":
        this._x = s1 * c2 * c3 - c1 * s2 * s3;
        this._y = c1 * s2 * c3 - s1 * c2 * s3;
        this._z = c1 * c2 * s3 + s1 * s2 * c3;
        this._w = c1 * c2 * c3 + s1 * s2 * s3;
        break;
      default:
        console.warn("THREE.Quaternion: .setFromEuler() encountered an unknown order: " + order);
    }
    if (update === true) this._onChangeCallback();
    return this;
  }
  /**
   * Sets this quaternion from the given axis and angle.
   *
   * @param {Vector3} axis - The normalized axis.
   * @param {number} angle - The angle in radians.
   * @return {Quaternion} A reference to this quaternion.
   */
  setFromAxisAngle(axis, angle2) {
    const halfAngle = angle2 / 2, s = Math.sin(halfAngle);
    this._x = axis.x * s;
    this._y = axis.y * s;
    this._z = axis.z * s;
    this._w = Math.cos(halfAngle);
    this._onChangeCallback();
    return this;
  }
  /**
   * Sets this quaternion from the given rotation matrix.
   *
   * @param {Matrix4} m - A 4x4 matrix of which the upper 3x3 of matrix is a pure rotation matrix (i.e. unscaled).
   * @return {Quaternion} A reference to this quaternion.
   */
  setFromRotationMatrix(m) {
    const te = m.elements, m11 = te[0], m12 = te[4], m13 = te[8], m21 = te[1], m22 = te[5], m23 = te[9], m31 = te[2], m32 = te[6], m33 = te[10], trace = m11 + m22 + m33;
    if (trace > 0) {
      const s = 0.5 / Math.sqrt(trace + 1);
      this._w = 0.25 / s;
      this._x = (m32 - m23) * s;
      this._y = (m13 - m31) * s;
      this._z = (m21 - m12) * s;
    } else if (m11 > m22 && m11 > m33) {
      const s = 2 * Math.sqrt(1 + m11 - m22 - m33);
      this._w = (m32 - m23) / s;
      this._x = 0.25 * s;
      this._y = (m12 + m21) / s;
      this._z = (m13 + m31) / s;
    } else if (m22 > m33) {
      const s = 2 * Math.sqrt(1 + m22 - m11 - m33);
      this._w = (m13 - m31) / s;
      this._x = (m12 + m21) / s;
      this._y = 0.25 * s;
      this._z = (m23 + m32) / s;
    } else {
      const s = 2 * Math.sqrt(1 + m33 - m11 - m22);
      this._w = (m21 - m12) / s;
      this._x = (m13 + m31) / s;
      this._y = (m23 + m32) / s;
      this._z = 0.25 * s;
    }
    this._onChangeCallback();
    return this;
  }
  /**
   * Sets this quaternion to the rotation required to rotate the direction vector
   * `vFrom` to the direction vector `vTo`.
   *
   * @param {Vector3} vFrom - The first (normalized) direction vector.
   * @param {Vector3} vTo - The second (normalized) direction vector.
   * @return {Quaternion} A reference to this quaternion.
   */
  setFromUnitVectors(vFrom, vTo) {
    let r = vFrom.dot(vTo) + 1;
    if (r < 1e-8) {
      r = 0;
      if (Math.abs(vFrom.x) > Math.abs(vFrom.z)) {
        this._x = -vFrom.y;
        this._y = vFrom.x;
        this._z = 0;
        this._w = r;
      } else {
        this._x = 0;
        this._y = -vFrom.z;
        this._z = vFrom.y;
        this._w = r;
      }
    } else {
      this._x = vFrom.y * vTo.z - vFrom.z * vTo.y;
      this._y = vFrom.z * vTo.x - vFrom.x * vTo.z;
      this._z = vFrom.x * vTo.y - vFrom.y * vTo.x;
      this._w = r;
    }
    return this.normalize();
  }
  /**
   * Returns the angle between this quaternion and the given one in radians.
   *
   * @param {Quaternion} q - The quaternion to compute the angle with.
   * @return {number} The angle in radians.
   */
  angleTo(q) {
    return 2 * Math.acos(Math.abs(clamp(this.dot(q), -1, 1)));
  }
  /**
   * Rotates this quaternion by a given angular step to the given quaternion.
   * The method ensures that the final quaternion will not overshoot `q`.
   *
   * @param {Quaternion} q - The target quaternion.
   * @param {number} step - The angular step in radians.
   * @return {Quaternion} A reference to this quaternion.
   */
  rotateTowards(q, step) {
    const angle2 = this.angleTo(q);
    if (angle2 === 0) return this;
    const t = Math.min(1, step / angle2);
    this.slerp(q, t);
    return this;
  }
  /**
   * Sets this quaternion to the identity quaternion; that is, to the
   * quaternion that represents "no rotation".
   *
   * @return {Quaternion} A reference to this quaternion.
   */
  identity() {
    return this.set(0, 0, 0, 1);
  }
  /**
   * Inverts this quaternion via {@link Quaternion#conjugate}. The
   * quaternion is assumed to have unit length.
   *
   * @return {Quaternion} A reference to this quaternion.
   */
  invert() {
    return this.conjugate();
  }
  /**
   * Returns the rotational conjugate of this quaternion. The conjugate of a
   * quaternion represents the same rotation in the opposite direction about
   * the rotational axis.
   *
   * @return {Quaternion} A reference to this quaternion.
   */
  conjugate() {
    this._x *= -1;
    this._y *= -1;
    this._z *= -1;
    this._onChangeCallback();
    return this;
  }
  /**
   * Calculates the dot product of this quaternion and the given one.
   *
   * @param {Quaternion} v - The quaternion to compute the dot product with.
   * @return {number} The result of the dot product.
   */
  dot(v) {
    return this._x * v._x + this._y * v._y + this._z * v._z + this._w * v._w;
  }
  /**
   * Computes the squared Euclidean length (straight-line length) of this quaternion,
   * considered as a 4 dimensional vector. This can be useful if you are comparing the
   * lengths of two quaternions, as this is a slightly more efficient calculation than
   * {@link Quaternion#length}.
   *
   * @return {number} The squared Euclidean length.
   */
  lengthSq() {
    return this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w;
  }
  /**
   * Computes the Euclidean length (straight-line length) of this quaternion,
   * considered as a 4 dimensional vector.
   *
   * @return {number} The Euclidean length.
   */
  length() {
    return Math.sqrt(this._x * this._x + this._y * this._y + this._z * this._z + this._w * this._w);
  }
  /**
   * Normalizes this quaternion - that is, calculated the quaternion that performs
   * the same rotation as this one, but has a length equal to `1`.
   *
   * @return {Quaternion} A reference to this quaternion.
   */
  normalize() {
    let l = this.length();
    if (l === 0) {
      this._x = 0;
      this._y = 0;
      this._z = 0;
      this._w = 1;
    } else {
      l = 1 / l;
      this._x = this._x * l;
      this._y = this._y * l;
      this._z = this._z * l;
      this._w = this._w * l;
    }
    this._onChangeCallback();
    return this;
  }
  /**
   * Multiplies this quaternion by the given one.
   *
   * @param {Quaternion} q - The quaternion.
   * @return {Quaternion} A reference to this quaternion.
   */
  multiply(q) {
    return this.multiplyQuaternions(this, q);
  }
  /**
   * Pre-multiplies this quaternion by the given one.
   *
   * @param {Quaternion} q - The quaternion.
   * @return {Quaternion} A reference to this quaternion.
   */
  premultiply(q) {
    return this.multiplyQuaternions(q, this);
  }
  /**
   * Multiplies the given quaternions and stores the result in this instance.
   *
   * @param {Quaternion} a - The first quaternion.
   * @param {Quaternion} b - The second quaternion.
   * @return {Quaternion} A reference to this quaternion.
   */
  multiplyQuaternions(a, b) {
    const qax = a._x, qay = a._y, qaz = a._z, qaw = a._w;
    const qbx = b._x, qby = b._y, qbz = b._z, qbw = b._w;
    this._x = qax * qbw + qaw * qbx + qay * qbz - qaz * qby;
    this._y = qay * qbw + qaw * qby + qaz * qbx - qax * qbz;
    this._z = qaz * qbw + qaw * qbz + qax * qby - qay * qbx;
    this._w = qaw * qbw - qax * qbx - qay * qby - qaz * qbz;
    this._onChangeCallback();
    return this;
  }
  /**
   * Performs a spherical linear interpolation between quaternions.
   *
   * @param {Quaternion} qb - The target quaternion.
   * @param {number} t - The interpolation factor in the closed interval `[0, 1]`.
   * @return {Quaternion} A reference to this quaternion.
   */
  slerp(qb, t) {
    if (t === 0) return this;
    if (t === 1) return this.copy(qb);
    const x = this._x, y = this._y, z = this._z, w = this._w;
    let cosHalfTheta = w * qb._w + x * qb._x + y * qb._y + z * qb._z;
    if (cosHalfTheta < 0) {
      this._w = -qb._w;
      this._x = -qb._x;
      this._y = -qb._y;
      this._z = -qb._z;
      cosHalfTheta = -cosHalfTheta;
    } else {
      this.copy(qb);
    }
    if (cosHalfTheta >= 1) {
      this._w = w;
      this._x = x;
      this._y = y;
      this._z = z;
      return this;
    }
    const sqrSinHalfTheta = 1 - cosHalfTheta * cosHalfTheta;
    if (sqrSinHalfTheta <= Number.EPSILON) {
      const s = 1 - t;
      this._w = s * w + t * this._w;
      this._x = s * x + t * this._x;
      this._y = s * y + t * this._y;
      this._z = s * z + t * this._z;
      this.normalize();
      return this;
    }
    const sinHalfTheta = Math.sqrt(sqrSinHalfTheta);
    const halfTheta = Math.atan2(sinHalfTheta, cosHalfTheta);
    const ratioA = Math.sin((1 - t) * halfTheta) / sinHalfTheta, ratioB = Math.sin(t * halfTheta) / sinHalfTheta;
    this._w = w * ratioA + this._w * ratioB;
    this._x = x * ratioA + this._x * ratioB;
    this._y = y * ratioA + this._y * ratioB;
    this._z = z * ratioA + this._z * ratioB;
    this._onChangeCallback();
    return this;
  }
  /**
   * Performs a spherical linear interpolation between the given quaternions
   * and stores the result in this quaternion.
   *
   * @param {Quaternion} qa - The source quaternion.
   * @param {Quaternion} qb - The target quaternion.
   * @param {number} t - The interpolation factor in the closed interval `[0, 1]`.
   * @return {Quaternion} A reference to this quaternion.
   */
  slerpQuaternions(qa, qb, t) {
    return this.copy(qa).slerp(qb, t);
  }
  /**
   * Sets this quaternion to a uniformly random, normalized quaternion.
   *
   * @return {Quaternion} A reference to this quaternion.
   */
  random() {
    const theta1 = 2 * Math.PI * Math.random();
    const theta2 = 2 * Math.PI * Math.random();
    const x0 = Math.random();
    const r1 = Math.sqrt(1 - x0);
    const r2 = Math.sqrt(x0);
    return this.set(
      r1 * Math.sin(theta1),
      r1 * Math.cos(theta1),
      r2 * Math.sin(theta2),
      r2 * Math.cos(theta2)
    );
  }
  /**
   * Returns `true` if this quaternion is equal with the given one.
   *
   * @param {Quaternion} quaternion - The quaternion to test for equality.
   * @return {boolean} Whether this quaternion is equal with the given one.
   */
  equals(quaternion) {
    return quaternion._x === this._x && quaternion._y === this._y && quaternion._z === this._z && quaternion._w === this._w;
  }
  /**
   * Sets this quaternion's components from the given array.
   *
   * @param {Array<number>} array - An array holding the quaternion component values.
   * @param {number} [offset=0] - The offset into the array.
   * @return {Quaternion} A reference to this quaternion.
   */
  fromArray(array, offset = 0) {
    this._x = array[offset];
    this._y = array[offset + 1];
    this._z = array[offset + 2];
    this._w = array[offset + 3];
    this._onChangeCallback();
    return this;
  }
  /**
   * Writes the components of this quaternion to the given array. If no array is provided,
   * the method returns a new instance.
   *
   * @param {Array<number>} [array=[]] - The target array holding the quaternion components.
   * @param {number} [offset=0] - Index of the first element in the array.
   * @return {Array<number>} The quaternion components.
   */
  toArray(array = [], offset = 0) {
    array[offset] = this._x;
    array[offset + 1] = this._y;
    array[offset + 2] = this._z;
    array[offset + 3] = this._w;
    return array;
  }
  /**
   * Sets the components of this quaternion from the given buffer attribute.
   *
   * @param {BufferAttribute} attribute - The buffer attribute holding quaternion data.
   * @param {number} index - The index into the attribute.
   * @return {Quaternion} A reference to this quaternion.
   */
  fromBufferAttribute(attribute, index) {
    this._x = attribute.getX(index);
    this._y = attribute.getY(index);
    this._z = attribute.getZ(index);
    this._w = attribute.getW(index);
    this._onChangeCallback();
    return this;
  }
  /**
   * This methods defines the serialization result of this class. Returns the
   * numerical elements of this quaternion in an array of format `[x, y, z, w]`.
   *
   * @return {Array<number>} The serialized quaternion.
   */
  toJSON() {
    return this.toArray();
  }
  _onChange(callback) {
    this._onChangeCallback = callback;
    return this;
  }
  _onChangeCallback() {
  }
  *[Symbol.iterator]() {
    yield this._x;
    yield this._y;
    yield this._z;
    yield this._w;
  }
}
class Vector3 {
  /**
   * Constructs a new 3D vector.
   *
   * @param {number} [x=0] - The x value of this vector.
   * @param {number} [y=0] - The y value of this vector.
   * @param {number} [z=0] - The z value of this vector.
   */
  constructor(x = 0, y = 0, z = 0) {
    Vector3.prototype.isVector3 = true;
    this.x = x;
    this.y = y;
    this.z = z;
  }
  /**
   * Sets the vector components.
   *
   * @param {number} x - The value of the x component.
   * @param {number} y - The value of the y component.
   * @param {number} z - The value of the z component.
   * @return {Vector3} A reference to this vector.
   */
  set(x, y, z) {
    if (z === void 0) z = this.z;
    this.x = x;
    this.y = y;
    this.z = z;
    return this;
  }
  /**
   * Sets the vector components to the same value.
   *
   * @param {number} scalar - The value to set for all vector components.
   * @return {Vector3} A reference to this vector.
   */
  setScalar(scalar2) {
    this.x = scalar2;
    this.y = scalar2;
    this.z = scalar2;
    return this;
  }
  /**
   * Sets the vector's x component to the given value
   *
   * @param {number} x - The value to set.
   * @return {Vector3} A reference to this vector.
   */
  setX(x) {
    this.x = x;
    return this;
  }
  /**
   * Sets the vector's y component to the given value
   *
   * @param {number} y - The value to set.
   * @return {Vector3} A reference to this vector.
   */
  setY(y) {
    this.y = y;
    return this;
  }
  /**
   * Sets the vector's z component to the given value
   *
   * @param {number} z - The value to set.
   * @return {Vector3} A reference to this vector.
   */
  setZ(z) {
    this.z = z;
    return this;
  }
  /**
   * Allows to set a vector component with an index.
   *
   * @param {number} index - The component index. `0` equals to x, `1` equals to y, `2` equals to z.
   * @param {number} value - The value to set.
   * @return {Vector3} A reference to this vector.
   */
  setComponent(index, value2) {
    switch (index) {
      case 0:
        this.x = value2;
        break;
      case 1:
        this.y = value2;
        break;
      case 2:
        this.z = value2;
        break;
      default:
        throw new Error("index is out of range: " + index);
    }
    return this;
  }
  /**
   * Returns the value of the vector component which matches the given index.
   *
   * @param {number} index - The component index. `0` equals to x, `1` equals to y, `2` equals to z.
   * @return {number} A vector component value.
   */
  getComponent(index) {
    switch (index) {
      case 0:
        return this.x;
      case 1:
        return this.y;
      case 2:
        return this.z;
      default:
        throw new Error("index is out of range: " + index);
    }
  }
  /**
   * Returns a new vector with copied values from this instance.
   *
   * @return {Vector3} A clone of this instance.
   */
  clone() {
    return new this.constructor(this.x, this.y, this.z);
  }
  /**
   * Copies the values of the given vector to this instance.
   *
   * @param {Vector3} v - The vector to copy.
   * @return {Vector3} A reference to this vector.
   */
  copy(v) {
    this.x = v.x;
    this.y = v.y;
    this.z = v.z;
    return this;
  }
  /**
   * Adds the given vector to this instance.
   *
   * @param {Vector3} v - The vector to add.
   * @return {Vector3} A reference to this vector.
   */
  add(v) {
    this.x += v.x;
    this.y += v.y;
    this.z += v.z;
    return this;
  }
  /**
   * Adds the given scalar value to all components of this instance.
   *
   * @param {number} s - The scalar to add.
   * @return {Vector3} A reference to this vector.
   */
  addScalar(s) {
    this.x += s;
    this.y += s;
    this.z += s;
    return this;
  }
  /**
   * Adds the given vectors and stores the result in this instance.
   *
   * @param {Vector3} a - The first vector.
   * @param {Vector3} b - The second vector.
   * @return {Vector3} A reference to this vector.
   */
  addVectors(a, b) {
    this.x = a.x + b.x;
    this.y = a.y + b.y;
    this.z = a.z + b.z;
    return this;
  }
  /**
   * Adds the given vector scaled by the given factor to this instance.
   *
   * @param {Vector3|Vector4} v - The vector.
   * @param {number} s - The factor that scales `v`.
   * @return {Vector3} A reference to this vector.
   */
  addScaledVector(v, s) {
    this.x += v.x * s;
    this.y += v.y * s;
    this.z += v.z * s;
    return this;
  }
  /**
   * Subtracts the given vector from this instance.
   *
   * @param {Vector3} v - The vector to subtract.
   * @return {Vector3} A reference to this vector.
   */
  sub(v) {
    this.x -= v.x;
    this.y -= v.y;
    this.z -= v.z;
    return this;
  }
  /**
   * Subtracts the given scalar value from all components of this instance.
   *
   * @param {number} s - The scalar to subtract.
   * @return {Vector3} A reference to this vector.
   */
  subScalar(s) {
    this.x -= s;
    this.y -= s;
    this.z -= s;
    return this;
  }
  /**
   * Subtracts the given vectors and stores the result in this instance.
   *
   * @param {Vector3} a - The first vector.
   * @param {Vector3} b - The second vector.
   * @return {Vector3} A reference to this vector.
   */
  subVectors(a, b) {
    this.x = a.x - b.x;
    this.y = a.y - b.y;
    this.z = a.z - b.z;
    return this;
  }
  /**
   * Multiplies the given vector with this instance.
   *
   * @param {Vector3} v - The vector to multiply.
   * @return {Vector3} A reference to this vector.
   */
  multiply(v) {
    this.x *= v.x;
    this.y *= v.y;
    this.z *= v.z;
    return this;
  }
  /**
   * Multiplies the given scalar value with all components of this instance.
   *
   * @param {number} scalar - The scalar to multiply.
   * @return {Vector3} A reference to this vector.
   */
  multiplyScalar(scalar2) {
    this.x *= scalar2;
    this.y *= scalar2;
    this.z *= scalar2;
    return this;
  }
  /**
   * Multiplies the given vectors and stores the result in this instance.
   *
   * @param {Vector3} a - The first vector.
   * @param {Vector3} b - The second vector.
   * @return {Vector3} A reference to this vector.
   */
  multiplyVectors(a, b) {
    this.x = a.x * b.x;
    this.y = a.y * b.y;
    this.z = a.z * b.z;
    return this;
  }
  /**
   * Applies the given Euler rotation to this vector.
   *
   * @param {Euler} euler - The Euler angles.
   * @return {Vector3} A reference to this vector.
   */
  applyEuler(euler) {
    return this.applyQuaternion(_quaternion$4.setFromEuler(euler));
  }
  /**
   * Applies a rotation specified by an axis and an angle to this vector.
   *
   * @param {Vector3} axis - A normalized vector representing the rotation axis.
   * @param {number} angle - The angle in radians.
   * @return {Vector3} A reference to this vector.
   */
  applyAxisAngle(axis, angle2) {
    return this.applyQuaternion(_quaternion$4.setFromAxisAngle(axis, angle2));
  }
  /**
   * Multiplies this vector with the given 3x3 matrix.
   *
   * @param {Matrix3} m - The 3x3 matrix.
   * @return {Vector3} A reference to this vector.
   */
  applyMatrix3(m) {
    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;
    this.x = e[0] * x + e[3] * y + e[6] * z;
    this.y = e[1] * x + e[4] * y + e[7] * z;
    this.z = e[2] * x + e[5] * y + e[8] * z;
    return this;
  }
  /**
   * Multiplies this vector by the given normal matrix and normalizes
   * the result.
   *
   * @param {Matrix3} m - The normal matrix.
   * @return {Vector3} A reference to this vector.
   */
  applyNormalMatrix(m) {
    return this.applyMatrix3(m).normalize();
  }
  /**
   * Multiplies this vector (with an implicit 1 in the 4th dimension) by m, and
   * divides by perspective.
   *
   * @param {Matrix4} m - The matrix to apply.
   * @return {Vector3} A reference to this vector.
   */
  applyMatrix4(m) {
    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;
    const w = 1 / (e[3] * x + e[7] * y + e[11] * z + e[15]);
    this.x = (e[0] * x + e[4] * y + e[8] * z + e[12]) * w;
    this.y = (e[1] * x + e[5] * y + e[9] * z + e[13]) * w;
    this.z = (e[2] * x + e[6] * y + e[10] * z + e[14]) * w;
    return this;
  }
  /**
   * Applies the given Quaternion to this vector.
   *
   * @param {Quaternion} q - The Quaternion.
   * @return {Vector3} A reference to this vector.
   */
  applyQuaternion(q) {
    const vx = this.x, vy = this.y, vz = this.z;
    const qx = q.x, qy = q.y, qz = q.z, qw = q.w;
    const tx = 2 * (qy * vz - qz * vy);
    const ty = 2 * (qz * vx - qx * vz);
    const tz = 2 * (qx * vy - qy * vx);
    this.x = vx + qw * tx + qy * tz - qz * ty;
    this.y = vy + qw * ty + qz * tx - qx * tz;
    this.z = vz + qw * tz + qx * ty - qy * tx;
    return this;
  }
  /**
   * Projects this vector from world space into the camera's normalized
   * device coordinate (NDC) space.
   *
   * @param {Camera} camera - The camera.
   * @return {Vector3} A reference to this vector.
   */
  project(camera) {
    return this.applyMatrix4(camera.matrixWorldInverse).applyMatrix4(camera.projectionMatrix);
  }
  /**
   * Unprojects this vector from the camera's normalized device coordinate (NDC)
   * space into world space.
   *
   * @param {Camera} camera - The camera.
   * @return {Vector3} A reference to this vector.
   */
  unproject(camera) {
    return this.applyMatrix4(camera.projectionMatrixInverse).applyMatrix4(camera.matrixWorld);
  }
  /**
   * Transforms the direction of this vector by a matrix (the upper left 3 x 3
   * subset of the given 4x4 matrix and then normalizes the result.
   *
   * @param {Matrix4} m - The matrix.
   * @return {Vector3} A reference to this vector.
   */
  transformDirection(m) {
    const x = this.x, y = this.y, z = this.z;
    const e = m.elements;
    this.x = e[0] * x + e[4] * y + e[8] * z;
    this.y = e[1] * x + e[5] * y + e[9] * z;
    this.z = e[2] * x + e[6] * y + e[10] * z;
    return this.normalize();
  }
  /**
   * Divides this instance by the given vector.
   *
   * @param {Vector3} v - The vector to divide.
   * @return {Vector3} A reference to this vector.
   */
  divide(v) {
    this.x /= v.x;
    this.y /= v.y;
    this.z /= v.z;
    return this;
  }
  /**
   * Divides this vector by the given scalar.
   *
   * @param {number} scalar - The scalar to divide.
   * @return {Vector3} A reference to this vector.
   */
  divideScalar(scalar2) {
    return this.multiplyScalar(1 / scalar2);
  }
  /**
   * If this vector's x, y or z value is greater than the given vector's x, y or z
   * value, replace that value with the corresponding min value.
   *
   * @param {Vector3} v - The vector.
   * @return {Vector3} A reference to this vector.
   */
  min(v) {
    this.x = Math.min(this.x, v.x);
    this.y = Math.min(this.y, v.y);
    this.z = Math.min(this.z, v.z);
    return this;
  }
  /**
   * If this vector's x, y or z value is less than the given vector's x, y or z
   * value, replace that value with the corresponding max value.
   *
   * @param {Vector3} v - The vector.
   * @return {Vector3} A reference to this vector.
   */
  max(v) {
    this.x = Math.max(this.x, v.x);
    this.y = Math.max(this.y, v.y);
    this.z = Math.max(this.z, v.z);
    return this;
  }
  /**
   * If this vector's x, y or z value is greater than the max vector's x, y or z
   * value, it is replaced by the corresponding value.
   * If this vector's x, y or z value is less than the min vector's x, y or z value,
   * it is replaced by the corresponding value.
   *
   * @param {Vector3} min - The minimum x, y and z values.
   * @param {Vector3} max - The maximum x, y and z values in the desired range.
   * @return {Vector3} A reference to this vector.
   */
  clamp(min, max) {
    this.x = clamp(this.x, min.x, max.x);
    this.y = clamp(this.y, min.y, max.y);
    this.z = clamp(this.z, min.z, max.z);
    return this;
  }
  /**
   * If this vector's x, y or z values are greater than the max value, they are
   * replaced by the max value.
   * If this vector's x, y or z values are less than the min value, they are
   * replaced by the min value.
   *
   * @param {number} minVal - The minimum value the components will be clamped to.
   * @param {number} maxVal - The maximum value the components will be clamped to.
   * @return {Vector3} A reference to this vector.
   */
  clampScalar(minVal, maxVal) {
    this.x = clamp(this.x, minVal, maxVal);
    this.y = clamp(this.y, minVal, maxVal);
    this.z = clamp(this.z, minVal, maxVal);
    return this;
  }
  /**
   * If this vector's length is greater than the max value, it is replaced by
   * the max value.
   * If this vector's length is less than the min value, it is replaced by the
   * min value.
   *
   * @param {number} min - The minimum value the vector length will be clamped to.
   * @param {number} max - The maximum value the vector length will be clamped to.
   * @return {Vector3} A reference to this vector.
   */
  clampLength(min, max) {
    const length = this.length();
    return this.divideScalar(length || 1).multiplyScalar(clamp(length, min, max));
  }
  /**
   * The components of this vector are rounded down to the nearest integer value.
   *
   * @return {Vector3} A reference to this vector.
   */
  floor() {
    this.x = Math.floor(this.x);
    this.y = Math.floor(this.y);
    this.z = Math.floor(this.z);
    return this;
  }
  /**
   * The components of this vector are rounded up to the nearest integer value.
   *
   * @return {Vector3} A reference to this vector.
   */
  ceil() {
    this.x = Math.ceil(this.x);
    this.y = Math.ceil(this.y);
    this.z = Math.ceil(this.z);
    return this;
  }
  /**
   * The components of this vector are rounded to the nearest integer value
   *
   * @return {Vector3} A reference to this vector.
   */
  round() {
    this.x = Math.round(this.x);
    this.y = Math.round(this.y);
    this.z = Math.round(this.z);
    return this;
  }
  /**
   * The components of this vector are rounded towards zero (up if negative,
   * down if positive) to an integer value.
   *
   * @return {Vector3} A reference to this vector.
   */
  roundToZero() {
    this.x = Math.trunc(this.x);
    this.y = Math.trunc(this.y);
    this.z = Math.trunc(this.z);
    return this;
  }
  /**
   * Inverts this vector - i.e. sets x = -x, y = -y and z = -z.
   *
   * @return {Vector3} A reference to this vector.
   */
  negate() {
    this.x = -this.x;
    this.y = -this.y;
    this.z = -this.z;
    return this;
  }
  /**
   * Calculates the dot product of the given vector with this instance.
   *
   * @param {Vector3} v - The vector to compute the dot product with.
   * @return {number} The result of the dot product.
   */
  dot(v) {
    return this.x * v.x + this.y * v.y + this.z * v.z;
  }
  // TODO lengthSquared?
  /**
   * Computes the square of the Euclidean length (straight-line length) from
   * (0, 0, 0) to (x, y, z). If you are comparing the lengths of vectors, you should
   * compare the length squared instead as it is slightly more efficient to calculate.
   *
   * @return {number} The square length of this vector.
   */
  lengthSq() {
    return this.x * this.x + this.y * this.y + this.z * this.z;
  }
  /**
   * Computes the  Euclidean length (straight-line length) from (0, 0, 0) to (x, y, z).
   *
   * @return {number} The length of this vector.
   */
  length() {
    return Math.sqrt(this.x * this.x + this.y * this.y + this.z * this.z);
  }
  /**
   * Computes the Manhattan length of this vector.
   *
   * @return {number} The length of this vector.
   */
  manhattanLength() {
    return Math.abs(this.x) + Math.abs(this.y) + Math.abs(this.z);
  }
  /**
   * Converts this vector to a unit vector - that is, sets it equal to a vector
   * with the same direction as this one, but with a vector length of `1`.
   *
   * @return {Vector3} A reference to this vector.
   */
  normalize() {
    return this.divideScalar(this.length() || 1);
  }
  /**
   * Sets this vector to a vector with the same direction as this one, but
   * with the specified length.
   *
   * @param {number} length - The new length of this vector.
   * @return {Vector3} A reference to this vector.
   */
  setLength(length) {
    return this.normalize().multiplyScalar(length);
  }
  /**
   * Linearly interpolates between the given vector and this instance, where
   * alpha is the percent distance along the line - alpha = 0 will be this
   * vector, and alpha = 1 will be the given one.
   *
   * @param {Vector3} v - The vector to interpolate towards.
   * @param {number} alpha - The interpolation factor, typically in the closed interval `[0, 1]`.
   * @return {Vector3} A reference to this vector.
   */
  lerp(v, alpha) {
    this.x += (v.x - this.x) * alpha;
    this.y += (v.y - this.y) * alpha;
    this.z += (v.z - this.z) * alpha;
    return this;
  }
  /**
   * Linearly interpolates between the given vectors, where alpha is the percent
   * distance along the line - alpha = 0 will be first vector, and alpha = 1 will
   * be the second one. The result is stored in this instance.
   *
   * @param {Vector3} v1 - The first vector.
   * @param {Vector3} v2 - The second vector.
   * @param {number} alpha - The interpolation factor, typically in the closed interval `[0, 1]`.
   * @return {Vector3} A reference to this vector.
   */
  lerpVectors(v1, v2, alpha) {
    this.x = v1.x + (v2.x - v1.x) * alpha;
    this.y = v1.y + (v2.y - v1.y) * alpha;
    this.z = v1.z + (v2.z - v1.z) * alpha;
    return this;
  }
  /**
   * Calculates the cross product of the given vector with this instance.
   *
   * @param {Vector3} v - The vector to compute the cross product with.
   * @return {Vector3} The result of the cross product.
   */
  cross(v) {
    return this.crossVectors(this, v);
  }
  /**
   * Calculates the cross product of the given vectors and stores the result
   * in this instance.
   *
   * @param {Vector3} a - The first vector.
   * @param {Vector3} b - The second vector.
   * @return {Vector3} A reference to this vector.
   */
  crossVectors(a, b) {
    const ax = a.x, ay = a.y, az = a.z;
    const bx = b.x, by = b.y, bz = b.z;
    this.x = ay * bz - az * by;
    this.y = az * bx - ax * bz;
    this.z = ax * by - ay * bx;
    return this;
  }
  /**
   * Projects this vector onto the given one.
   *
   * @param {Vector3} v - The vector to project to.
   * @return {Vector3} A reference to this vector.
   */
  projectOnVector(v) {
    const denominator = v.lengthSq();
    if (denominator === 0) return this.set(0, 0, 0);
    const scalar2 = v.dot(this) / denominator;
    return this.copy(v).multiplyScalar(scalar2);
  }
  /**
   * Projects this vector onto a plane by subtracting this
   * vector projected onto the plane's normal from this vector.
   *
   * @param {Vector3} planeNormal - The plane normal.
   * @return {Vector3} A reference to this vector.
   */
  projectOnPlane(planeNormal) {
    _vector$c.copy(this).projectOnVector(planeNormal);
    return this.sub(_vector$c);
  }
  /**
   * Reflects this vector off a plane orthogonal to the given normal vector.
   *
   * @param {Vector3} normal - The (normalized) normal vector.
   * @return {Vector3} A reference to this vector.
   */
  reflect(normal) {
    return this.sub(_vector$c.copy(normal).multiplyScalar(2 * this.dot(normal)));
  }
  /**
   * Returns the angle between the given vector and this instance in radians.
   *
   * @param {Vector3} v - The vector to compute the angle with.
   * @return {number} The angle in radians.
   */
  angleTo(v) {
    const denominator = Math.sqrt(this.lengthSq() * v.lengthSq());
    if (denominator === 0) return Math.PI / 2;
    const theta = this.dot(v) / denominator;
    return Math.acos(clamp(theta, -1, 1));
  }
  /**
   * Computes the distance from the given vector to this instance.
   *
   * @param {Vector3} v - The vector to compute the distance to.
   * @return {number} The distance.
   */
  distanceTo(v) {
    return Math.sqrt(this.distanceToSquared(v));
  }
  /**
   * Computes the squared distance from the given vector to this instance.
   * If you are just comparing the distance with another distance, you should compare
   * the distance squared instead as it is slightly more efficient to calculate.
   *
   * @param {Vector3} v - The vector to compute the squared distance to.
   * @return {number} The squared distance.
   */
  distanceToSquared(v) {
    const dx = this.x - v.x, dy = this.y - v.y, dz = this.z - v.z;
    return dx * dx + dy * dy + dz * dz;
  }
  /**
   * Computes the Manhattan distance from the given vector to this instance.
   *
   * @param {Vector3} v - The vector to compute the Manhattan distance to.
   * @return {number} The Manhattan distance.
   */
  manhattanDistanceTo(v) {
    return Math.abs(this.x - v.x) + Math.abs(this.y - v.y) + Math.abs(this.z - v.z);
  }
  /**
   * Sets the vector components from the given spherical coordinates.
   *
   * @param {Spherical} s - The spherical coordinates.
   * @return {Vector3} A reference to this vector.
   */
  setFromSpherical(s) {
    return this.setFromSphericalCoords(s.radius, s.phi, s.theta);
  }
  /**
   * Sets the vector components from the given spherical coordinates.
   *
   * @param {number} radius - The radius.
   * @param {number} phi - The phi angle in radians.
   * @param {number} theta - The theta angle in radians.
   * @return {Vector3} A reference to this vector.
   */
  setFromSphericalCoords(radius, phi, theta) {
    const sinPhiRadius = Math.sin(phi) * radius;
    this.x = sinPhiRadius * Math.sin(theta);
    this.y = Math.cos(phi) * radius;
    this.z = sinPhiRadius * Math.cos(theta);
    return this;
  }
  /**
   * Sets the vector components from the given cylindrical coordinates.
   *
   * @param {Cylindrical} c - The cylindrical coordinates.
   * @return {Vector3} A reference to this vector.
   */
  setFromCylindrical(c) {
    return this.setFromCylindricalCoords(c.radius, c.theta, c.y);
  }
  /**
   * Sets the vector components from the given cylindrical coordinates.
   *
   * @param {number} radius - The radius.
   * @param {number} theta - The theta angle in radians.
   * @param {number} y - The y value.
   * @return {Vector3} A reference to this vector.
   */
  setFromCylindricalCoords(radius, theta, y) {
    this.x = radius * Math.sin(theta);
    this.y = y;
    this.z = radius * Math.cos(theta);
    return this;
  }
  /**
   * Sets the vector components to the position elements of the
   * given transformation matrix.
   *
   * @param {Matrix4} m - The 4x4 matrix.
   * @return {Vector3} A reference to this vector.
   */
  setFromMatrixPosition(m) {
    const e = m.elements;
    this.x = e[12];
    this.y = e[13];
    this.z = e[14];
    return this;
  }
  /**
   * Sets the vector components to the scale elements of the
   * given transformation matrix.
   *
   * @param {Matrix4} m - The 4x4 matrix.
   * @return {Vector3} A reference to this vector.
   */
  setFromMatrixScale(m) {
    const sx = this.setFromMatrixColumn(m, 0).length();
    const sy = this.setFromMatrixColumn(m, 1).length();
    const sz = this.setFromMatrixColumn(m, 2).length();
    this.x = sx;
    this.y = sy;
    this.z = sz;
    return this;
  }
  /**
   * Sets the vector components from the specified matrix column.
   *
   * @param {Matrix4} m - The 4x4 matrix.
   * @param {number} index - The column index.
   * @return {Vector3} A reference to this vector.
   */
  setFromMatrixColumn(m, index) {
    return this.fromArray(m.elements, index * 4);
  }
  /**
   * Sets the vector components from the specified matrix column.
   *
   * @param {Matrix3} m - The 3x3 matrix.
   * @param {number} index - The column index.
   * @return {Vector3} A reference to this vector.
   */
  setFromMatrix3Column(m, index) {
    return this.fromArray(m.elements, index * 3);
  }
  /**
   * Sets the vector components from the given Euler angles.
   *
   * @param {Euler} e - The Euler angles to set.
   * @return {Vector3} A reference to this vector.
   */
  setFromEuler(e) {
    this.x = e._x;
    this.y = e._y;
    this.z = e._z;
    return this;
  }
  /**
   * Sets the vector components from the RGB components of the
   * given color.
   *
   * @param {Color} c - The color to set.
   * @return {Vector3} A reference to this vector.
   */
  setFromColor(c) {
    this.x = c.r;
    this.y = c.g;
    this.z = c.b;
    return this;
  }
  /**
   * Returns `true` if this vector is equal with the given one.
   *
   * @param {Vector3} v - The vector to test for equality.
   * @return {boolean} Whether this vector is equal with the given one.
   */
  equals(v) {
    return v.x === this.x && v.y === this.y && v.z === this.z;
  }
  /**
   * Sets this vector's x value to be `array[ offset ]`, y value to be `array[ offset + 1 ]`
   * and z value to be `array[ offset + 2 ]`.
   *
   * @param {Array<number>} array - An array holding the vector component values.
   * @param {number} [offset=0] - The offset into the array.
   * @return {Vector3} A reference to this vector.
   */
  fromArray(array, offset = 0) {
    this.x = array[offset];
    this.y = array[offset + 1];
    this.z = array[offset + 2];
    return this;
  }
  /**
   * Writes the components of this vector to the given array. If no array is provided,
   * the method returns a new instance.
   *
   * @param {Array<number>} [array=[]] - The target array holding the vector components.
   * @param {number} [offset=0] - Index of the first element in the array.
   * @return {Array<number>} The vector components.
   */
  toArray(array = [], offset = 0) {
    array[offset] = this.x;
    array[offset + 1] = this.y;
    array[offset + 2] = this.z;
    return array;
  }
  /**
   * Sets the components of this vector from the given buffer attribute.
   *
   * @param {BufferAttribute} attribute - The buffer attribute holding vector data.
   * @param {number} index - The index into the attribute.
   * @return {Vector3} A reference to this vector.
   */
  fromBufferAttribute(attribute, index) {
    this.x = attribute.getX(index);
    this.y = attribute.getY(index);
    this.z = attribute.getZ(index);
    return this;
  }
  /**
   * Sets each component of this vector to a pseudo-random value between `0` and
   * `1`, excluding `1`.
   *
   * @return {Vector3} A reference to this vector.
   */
  random() {
    this.x = Math.random();
    this.y = Math.random();
    this.z = Math.random();
    return this;
  }
  /**
   * Sets this vector to a uniformly random point on a unit sphere.
   *
   * @return {Vector3} A reference to this vector.
   */
  randomDirection() {
    const theta = Math.random() * Math.PI * 2;
    const u = Math.random() * 2 - 1;
    const c = Math.sqrt(1 - u * u);
    this.x = c * Math.cos(theta);
    this.y = u;
    this.z = c * Math.sin(theta);
    return this;
  }
  *[Symbol.iterator]() {
    yield this.x;
    yield this.y;
    yield this.z;
  }
}
const _vector$c = /* @__PURE__ */ new Vector3();
const _quaternion$4 = /* @__PURE__ */ new Quaternion();
class Matrix4 {
  /**
   * Constructs a new 4x4 matrix. The arguments are supposed to be
   * in row-major order. If no arguments are provided, the constructor
   * initializes the matrix as an identity matrix.
   *
   * @param {number} [n11] - 1-1 matrix element.
   * @param {number} [n12] - 1-2 matrix element.
   * @param {number} [n13] - 1-3 matrix element.
   * @param {number} [n14] - 1-4 matrix element.
   * @param {number} [n21] - 2-1 matrix element.
   * @param {number} [n22] - 2-2 matrix element.
   * @param {number} [n23] - 2-3 matrix element.
   * @param {number} [n24] - 2-4 matrix element.
   * @param {number} [n31] - 3-1 matrix element.
   * @param {number} [n32] - 3-2 matrix element.
   * @param {number} [n33] - 3-3 matrix element.
   * @param {number} [n34] - 3-4 matrix element.
   * @param {number} [n41] - 4-1 matrix element.
   * @param {number} [n42] - 4-2 matrix element.
   * @param {number} [n43] - 4-3 matrix element.
   * @param {number} [n44] - 4-4 matrix element.
   */
  constructor(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44) {
    Matrix4.prototype.isMatrix4 = true;
    this.elements = [
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1
    ];
    if (n11 !== void 0) {
      this.set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44);
    }
  }
  /**
   * Sets the elements of the matrix.The arguments are supposed to be
   * in row-major order.
   *
   * @param {number} [n11] - 1-1 matrix element.
   * @param {number} [n12] - 1-2 matrix element.
   * @param {number} [n13] - 1-3 matrix element.
   * @param {number} [n14] - 1-4 matrix element.
   * @param {number} [n21] - 2-1 matrix element.
   * @param {number} [n22] - 2-2 matrix element.
   * @param {number} [n23] - 2-3 matrix element.
   * @param {number} [n24] - 2-4 matrix element.
   * @param {number} [n31] - 3-1 matrix element.
   * @param {number} [n32] - 3-2 matrix element.
   * @param {number} [n33] - 3-3 matrix element.
   * @param {number} [n34] - 3-4 matrix element.
   * @param {number} [n41] - 4-1 matrix element.
   * @param {number} [n42] - 4-2 matrix element.
   * @param {number} [n43] - 4-3 matrix element.
   * @param {number} [n44] - 4-4 matrix element.
   * @return {Matrix4} A reference to this matrix.
   */
  set(n11, n12, n13, n14, n21, n22, n23, n24, n31, n32, n33, n34, n41, n42, n43, n44) {
    const te = this.elements;
    te[0] = n11;
    te[4] = n12;
    te[8] = n13;
    te[12] = n14;
    te[1] = n21;
    te[5] = n22;
    te[9] = n23;
    te[13] = n24;
    te[2] = n31;
    te[6] = n32;
    te[10] = n33;
    te[14] = n34;
    te[3] = n41;
    te[7] = n42;
    te[11] = n43;
    te[15] = n44;
    return this;
  }
  /**
   * Sets this matrix to the 4x4 identity matrix.
   *
   * @return {Matrix4} A reference to this matrix.
   */
  identity() {
    this.set(
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1
    );
    return this;
  }
  /**
   * Returns a matrix with copied values from this instance.
   *
   * @return {Matrix4} A clone of this instance.
   */
  clone() {
    return new Matrix4().fromArray(this.elements);
  }
  /**
   * Copies the values of the given matrix to this instance.
   *
   * @param {Matrix4} m - The matrix to copy.
   * @return {Matrix4} A reference to this matrix.
   */
  copy(m) {
    const te = this.elements;
    const me = m.elements;
    te[0] = me[0];
    te[1] = me[1];
    te[2] = me[2];
    te[3] = me[3];
    te[4] = me[4];
    te[5] = me[5];
    te[6] = me[6];
    te[7] = me[7];
    te[8] = me[8];
    te[9] = me[9];
    te[10] = me[10];
    te[11] = me[11];
    te[12] = me[12];
    te[13] = me[13];
    te[14] = me[14];
    te[15] = me[15];
    return this;
  }
  /**
   * Copies the translation component of the given matrix
   * into this matrix's translation component.
   *
   * @param {Matrix4} m - The matrix to copy the translation component.
   * @return {Matrix4} A reference to this matrix.
   */
  copyPosition(m) {
    const te = this.elements, me = m.elements;
    te[12] = me[12];
    te[13] = me[13];
    te[14] = me[14];
    return this;
  }
  /**
   * Set the upper 3x3 elements of this matrix to the values of given 3x3 matrix.
   *
   * @param {Matrix3} m - The 3x3 matrix.
   * @return {Matrix4} A reference to this matrix.
   */
  setFromMatrix3(m) {
    const me = m.elements;
    this.set(
      me[0],
      me[3],
      me[6],
      0,
      me[1],
      me[4],
      me[7],
      0,
      me[2],
      me[5],
      me[8],
      0,
      0,
      0,
      0,
      1
    );
    return this;
  }
  /**
   * Extracts the basis of this matrix into the three axis vectors provided.
   *
   * @param {Vector3} xAxis - The basis's x axis.
   * @param {Vector3} yAxis - The basis's y axis.
   * @param {Vector3} zAxis - The basis's z axis.
   * @return {Matrix4} A reference to this matrix.
   */
  extractBasis(xAxis, yAxis, zAxis) {
    xAxis.setFromMatrixColumn(this, 0);
    yAxis.setFromMatrixColumn(this, 1);
    zAxis.setFromMatrixColumn(this, 2);
    return this;
  }
  /**
   * Sets the given basis vectors to this matrix.
   *
   * @param {Vector3} xAxis - The basis's x axis.
   * @param {Vector3} yAxis - The basis's y axis.
   * @param {Vector3} zAxis - The basis's z axis.
   * @return {Matrix4} A reference to this matrix.
   */
  makeBasis(xAxis, yAxis, zAxis) {
    this.set(
      xAxis.x,
      yAxis.x,
      zAxis.x,
      0,
      xAxis.y,
      yAxis.y,
      zAxis.y,
      0,
      xAxis.z,
      yAxis.z,
      zAxis.z,
      0,
      0,
      0,
      0,
      1
    );
    return this;
  }
  /**
   * Extracts the rotation component of the given matrix
   * into this matrix's rotation component.
   *
   * Note: This method does not support reflection matrices.
   *
   * @param {Matrix4} m - The matrix.
   * @return {Matrix4} A reference to this matrix.
   */
  extractRotation(m) {
    const te = this.elements;
    const me = m.elements;
    const scaleX = 1 / _v1$5.setFromMatrixColumn(m, 0).length();
    const scaleY = 1 / _v1$5.setFromMatrixColumn(m, 1).length();
    const scaleZ = 1 / _v1$5.setFromMatrixColumn(m, 2).length();
    te[0] = me[0] * scaleX;
    te[1] = me[1] * scaleX;
    te[2] = me[2] * scaleX;
    te[3] = 0;
    te[4] = me[4] * scaleY;
    te[5] = me[5] * scaleY;
    te[6] = me[6] * scaleY;
    te[7] = 0;
    te[8] = me[8] * scaleZ;
    te[9] = me[9] * scaleZ;
    te[10] = me[10] * scaleZ;
    te[11] = 0;
    te[12] = 0;
    te[13] = 0;
    te[14] = 0;
    te[15] = 1;
    return this;
  }
  /**
   * Sets the rotation component (the upper left 3x3 matrix) of this matrix to
   * the rotation specified by the given Euler angles. The rest of
   * the matrix is set to the identity. Depending on the {@link Euler#order},
   * there are six possible outcomes. See [this page]{@link https://en.wikipedia.org/wiki/Euler_angles#Rotation_matrix}
   * for a complete list.
   *
   * @param {Euler} euler - The Euler angles.
   * @return {Matrix4} A reference to this matrix.
   */
  makeRotationFromEuler(euler) {
    const te = this.elements;
    const x = euler.x, y = euler.y, z = euler.z;
    const a = Math.cos(x), b = Math.sin(x);
    const c = Math.cos(y), d = Math.sin(y);
    const e = Math.cos(z), f = Math.sin(z);
    if (euler.order === "XYZ") {
      const ae = a * e, af = a * f, be = b * e, bf = b * f;
      te[0] = c * e;
      te[4] = -c * f;
      te[8] = d;
      te[1] = af + be * d;
      te[5] = ae - bf * d;
      te[9] = -b * c;
      te[2] = bf - ae * d;
      te[6] = be + af * d;
      te[10] = a * c;
    } else if (euler.order === "YXZ") {
      const ce = c * e, cf = c * f, de = d * e, df = d * f;
      te[0] = ce + df * b;
      te[4] = de * b - cf;
      te[8] = a * d;
      te[1] = a * f;
      te[5] = a * e;
      te[9] = -b;
      te[2] = cf * b - de;
      te[6] = df + ce * b;
      te[10] = a * c;
    } else if (euler.order === "ZXY") {
      const ce = c * e, cf = c * f, de = d * e, df = d * f;
      te[0] = ce - df * b;
      te[4] = -a * f;
      te[8] = de + cf * b;
      te[1] = cf + de * b;
      te[5] = a * e;
      te[9] = df - ce * b;
      te[2] = -a * d;
      te[6] = b;
      te[10] = a * c;
    } else if (euler.order === "ZYX") {
      const ae = a * e, af = a * f, be = b * e, bf = b * f;
      te[0] = c * e;
      te[4] = be * d - af;
      te[8] = ae * d + bf;
      te[1] = c * f;
      te[5] = bf * d + ae;
      te[9] = af * d - be;
      te[2] = -d;
      te[6] = b * c;
      te[10] = a * c;
    } else if (euler.order === "YZX") {
      const ac = a * c, ad = a * d, bc = b * c, bd = b * d;
      te[0] = c * e;
      te[4] = bd - ac * f;
      te[8] = bc * f + ad;
      te[1] = f;
      te[5] = a * e;
      te[9] = -b * e;
      te[2] = -d * e;
      te[6] = ad * f + bc;
      te[10] = ac - bd * f;
    } else if (euler.order === "XZY") {
      const ac = a * c, ad = a * d, bc = b * c, bd = b * d;
      te[0] = c * e;
      te[4] = -f;
      te[8] = d * e;
      te[1] = ac * f + bd;
      te[5] = a * e;
      te[9] = ad * f - bc;
      te[2] = bc * f - ad;
      te[6] = b * e;
      te[10] = bd * f + ac;
    }
    te[3] = 0;
    te[7] = 0;
    te[11] = 0;
    te[12] = 0;
    te[13] = 0;
    te[14] = 0;
    te[15] = 1;
    return this;
  }
  /**
   * Sets the rotation component of this matrix to the rotation specified by
   * the given Quaternion as outlined [here]{@link https://en.wikipedia.org/wiki/Rotation_matrix#Quaternion}
   * The rest of the matrix is set to the identity.
   *
   * @param {Quaternion} q - The Quaternion.
   * @return {Matrix4} A reference to this matrix.
   */
  makeRotationFromQuaternion(q) {
    return this.compose(_zero, q, _one);
  }
  /**
   * Sets the rotation component of the transformation matrix, looking from `eye` towards
   * `target`, and oriented by the up-direction.
   *
   * @param {Vector3} eye - The eye vector.
   * @param {Vector3} target - The target vector.
   * @param {Vector3} up - The up vector.
   * @return {Matrix4} A reference to this matrix.
   */
  lookAt(eye, target, up) {
    const te = this.elements;
    _z.subVectors(eye, target);
    if (_z.lengthSq() === 0) {
      _z.z = 1;
    }
    _z.normalize();
    _x.crossVectors(up, _z);
    if (_x.lengthSq() === 0) {
      if (Math.abs(up.z) === 1) {
        _z.x += 1e-4;
      } else {
        _z.z += 1e-4;
      }
      _z.normalize();
      _x.crossVectors(up, _z);
    }
    _x.normalize();
    _y.crossVectors(_z, _x);
    te[0] = _x.x;
    te[4] = _y.x;
    te[8] = _z.x;
    te[1] = _x.y;
    te[5] = _y.y;
    te[9] = _z.y;
    te[2] = _x.z;
    te[6] = _y.z;
    te[10] = _z.z;
    return this;
  }
  /**
   * Post-multiplies this matrix by the given 4x4 matrix.
   *
   * @param {Matrix4} m - The matrix to multiply with.
   * @return {Matrix4} A reference to this matrix.
   */
  multiply(m) {
    return this.multiplyMatrices(this, m);
  }
  /**
   * Pre-multiplies this matrix by the given 4x4 matrix.
   *
   * @param {Matrix4} m - The matrix to multiply with.
   * @return {Matrix4} A reference to this matrix.
   */
  premultiply(m) {
    return this.multiplyMatrices(m, this);
  }
  /**
   * Multiples the given 4x4 matrices and stores the result
   * in this matrix.
   *
   * @param {Matrix4} a - The first matrix.
   * @param {Matrix4} b - The second matrix.
   * @return {Matrix4} A reference to this matrix.
   */
  multiplyMatrices(a, b) {
    const ae = a.elements;
    const be = b.elements;
    const te = this.elements;
    const a11 = ae[0], a12 = ae[4], a13 = ae[8], a14 = ae[12];
    const a21 = ae[1], a22 = ae[5], a23 = ae[9], a24 = ae[13];
    const a31 = ae[2], a32 = ae[6], a33 = ae[10], a34 = ae[14];
    const a41 = ae[3], a42 = ae[7], a43 = ae[11], a44 = ae[15];
    const b11 = be[0], b12 = be[4], b13 = be[8], b14 = be[12];
    const b21 = be[1], b22 = be[5], b23 = be[9], b24 = be[13];
    const b31 = be[2], b32 = be[6], b33 = be[10], b34 = be[14];
    const b41 = be[3], b42 = be[7], b43 = be[11], b44 = be[15];
    te[0] = a11 * b11 + a12 * b21 + a13 * b31 + a14 * b41;
    te[4] = a11 * b12 + a12 * b22 + a13 * b32 + a14 * b42;
    te[8] = a11 * b13 + a12 * b23 + a13 * b33 + a14 * b43;
    te[12] = a11 * b14 + a12 * b24 + a13 * b34 + a14 * b44;
    te[1] = a21 * b11 + a22 * b21 + a23 * b31 + a24 * b41;
    te[5] = a21 * b12 + a22 * b22 + a23 * b32 + a24 * b42;
    te[9] = a21 * b13 + a22 * b23 + a23 * b33 + a24 * b43;
    te[13] = a21 * b14 + a22 * b24 + a23 * b34 + a24 * b44;
    te[2] = a31 * b11 + a32 * b21 + a33 * b31 + a34 * b41;
    te[6] = a31 * b12 + a32 * b22 + a33 * b32 + a34 * b42;
    te[10] = a31 * b13 + a32 * b23 + a33 * b33 + a34 * b43;
    te[14] = a31 * b14 + a32 * b24 + a33 * b34 + a34 * b44;
    te[3] = a41 * b11 + a42 * b21 + a43 * b31 + a44 * b41;
    te[7] = a41 * b12 + a42 * b22 + a43 * b32 + a44 * b42;
    te[11] = a41 * b13 + a42 * b23 + a43 * b33 + a44 * b43;
    te[15] = a41 * b14 + a42 * b24 + a43 * b34 + a44 * b44;
    return this;
  }
  /**
   * Multiplies every component of the matrix by the given scalar.
   *
   * @param {number} s - The scalar.
   * @return {Matrix4} A reference to this matrix.
   */
  multiplyScalar(s) {
    const te = this.elements;
    te[0] *= s;
    te[4] *= s;
    te[8] *= s;
    te[12] *= s;
    te[1] *= s;
    te[5] *= s;
    te[9] *= s;
    te[13] *= s;
    te[2] *= s;
    te[6] *= s;
    te[10] *= s;
    te[14] *= s;
    te[3] *= s;
    te[7] *= s;
    te[11] *= s;
    te[15] *= s;
    return this;
  }
  /**
   * Computes and returns the determinant of this matrix.
   *
   * Based on the method outlined [here]{@link http://www.euclideanspace.com/maths/algebra/matrix/functions/inverse/fourD/index.html}.
   *
   * @return {number} The determinant.
   */
  determinant() {
    const te = this.elements;
    const n11 = te[0], n12 = te[4], n13 = te[8], n14 = te[12];
    const n21 = te[1], n22 = te[5], n23 = te[9], n24 = te[13];
    const n31 = te[2], n32 = te[6], n33 = te[10], n34 = te[14];
    const n41 = te[3], n42 = te[7], n43 = te[11], n44 = te[15];
    return n41 * (+n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34) + n42 * (+n11 * n23 * n34 - n11 * n24 * n33 + n14 * n21 * n33 - n13 * n21 * n34 + n13 * n24 * n31 - n14 * n23 * n31) + n43 * (+n11 * n24 * n32 - n11 * n22 * n34 - n14 * n21 * n32 + n12 * n21 * n34 + n14 * n22 * n31 - n12 * n24 * n31) + n44 * (-n13 * n22 * n31 - n11 * n23 * n32 + n11 * n22 * n33 + n13 * n21 * n32 - n12 * n21 * n33 + n12 * n23 * n31);
  }
  /**
   * Transposes this matrix in place.
   *
   * @return {Matrix4} A reference to this matrix.
   */
  transpose() {
    const te = this.elements;
    let tmp;
    tmp = te[1];
    te[1] = te[4];
    te[4] = tmp;
    tmp = te[2];
    te[2] = te[8];
    te[8] = tmp;
    tmp = te[6];
    te[6] = te[9];
    te[9] = tmp;
    tmp = te[3];
    te[3] = te[12];
    te[12] = tmp;
    tmp = te[7];
    te[7] = te[13];
    te[13] = tmp;
    tmp = te[11];
    te[11] = te[14];
    te[14] = tmp;
    return this;
  }
  /**
   * Sets the position component for this matrix from the given vector,
   * without affecting the rest of the matrix.
   *
   * @param {number|Vector3} x - The x component of the vector or alternatively the vector object.
   * @param {number} y - The y component of the vector.
   * @param {number} z - The z component of the vector.
   * @return {Matrix4} A reference to this matrix.
   */
  setPosition(x, y, z) {
    const te = this.elements;
    if (x.isVector3) {
      te[12] = x.x;
      te[13] = x.y;
      te[14] = x.z;
    } else {
      te[12] = x;
      te[13] = y;
      te[14] = z;
    }
    return this;
  }
  /**
   * Inverts this matrix, using the [analytic method]{@link https://en.wikipedia.org/wiki/Invertible_matrix#Analytic_solution}.
   * You can not invert with a determinant of zero. If you attempt this, the method produces
   * a zero matrix instead.
   *
   * @return {Matrix4} A reference to this matrix.
   */
  invert() {
    const te = this.elements, n11 = te[0], n21 = te[1], n31 = te[2], n41 = te[3], n12 = te[4], n22 = te[5], n32 = te[6], n42 = te[7], n13 = te[8], n23 = te[9], n33 = te[10], n43 = te[11], n14 = te[12], n24 = te[13], n34 = te[14], n44 = te[15], t11 = n23 * n34 * n42 - n24 * n33 * n42 + n24 * n32 * n43 - n22 * n34 * n43 - n23 * n32 * n44 + n22 * n33 * n44, t12 = n14 * n33 * n42 - n13 * n34 * n42 - n14 * n32 * n43 + n12 * n34 * n43 + n13 * n32 * n44 - n12 * n33 * n44, t13 = n13 * n24 * n42 - n14 * n23 * n42 + n14 * n22 * n43 - n12 * n24 * n43 - n13 * n22 * n44 + n12 * n23 * n44, t14 = n14 * n23 * n32 - n13 * n24 * n32 - n14 * n22 * n33 + n12 * n24 * n33 + n13 * n22 * n34 - n12 * n23 * n34;
    const det = n11 * t11 + n21 * t12 + n31 * t13 + n41 * t14;
    if (det === 0) return this.set(0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0);
    const detInv = 1 / det;
    te[0] = t11 * detInv;
    te[1] = (n24 * n33 * n41 - n23 * n34 * n41 - n24 * n31 * n43 + n21 * n34 * n43 + n23 * n31 * n44 - n21 * n33 * n44) * detInv;
    te[2] = (n22 * n34 * n41 - n24 * n32 * n41 + n24 * n31 * n42 - n21 * n34 * n42 - n22 * n31 * n44 + n21 * n32 * n44) * detInv;
    te[3] = (n23 * n32 * n41 - n22 * n33 * n41 - n23 * n31 * n42 + n21 * n33 * n42 + n22 * n31 * n43 - n21 * n32 * n43) * detInv;
    te[4] = t12 * detInv;
    te[5] = (n13 * n34 * n41 - n14 * n33 * n41 + n14 * n31 * n43 - n11 * n34 * n43 - n13 * n31 * n44 + n11 * n33 * n44) * detInv;
    te[6] = (n14 * n32 * n41 - n12 * n34 * n41 - n14 * n31 * n42 + n11 * n34 * n42 + n12 * n31 * n44 - n11 * n32 * n44) * detInv;
    te[7] = (n12 * n33 * n41 - n13 * n32 * n41 + n13 * n31 * n42 - n11 * n33 * n42 - n12 * n31 * n43 + n11 * n32 * n43) * detInv;
    te[8] = t13 * detInv;
    te[9] = (n14 * n23 * n41 - n13 * n24 * n41 - n14 * n21 * n43 + n11 * n24 * n43 + n13 * n21 * n44 - n11 * n23 * n44) * detInv;
    te[10] = (n12 * n24 * n41 - n14 * n22 * n41 + n14 * n21 * n42 - n11 * n24 * n42 - n12 * n21 * n44 + n11 * n22 * n44) * detInv;
    te[11] = (n13 * n22 * n41 - n12 * n23 * n41 - n13 * n21 * n42 + n11 * n23 * n42 + n12 * n21 * n43 - n11 * n22 * n43) * detInv;
    te[12] = t14 * detInv;
    te[13] = (n13 * n24 * n31 - n14 * n23 * n31 + n14 * n21 * n33 - n11 * n24 * n33 - n13 * n21 * n34 + n11 * n23 * n34) * detInv;
    te[14] = (n14 * n22 * n31 - n12 * n24 * n31 - n14 * n21 * n32 + n11 * n24 * n32 + n12 * n21 * n34 - n11 * n22 * n34) * detInv;
    te[15] = (n12 * n23 * n31 - n13 * n22 * n31 + n13 * n21 * n32 - n11 * n23 * n32 - n12 * n21 * n33 + n11 * n22 * n33) * detInv;
    return this;
  }
  /**
   * Multiplies the columns of this matrix by the given vector.
   *
   * @param {Vector3} v - The scale vector.
   * @return {Matrix4} A reference to this matrix.
   */
  scale(v) {
    const te = this.elements;
    const x = v.x, y = v.y, z = v.z;
    te[0] *= x;
    te[4] *= y;
    te[8] *= z;
    te[1] *= x;
    te[5] *= y;
    te[9] *= z;
    te[2] *= x;
    te[6] *= y;
    te[10] *= z;
    te[3] *= x;
    te[7] *= y;
    te[11] *= z;
    return this;
  }
  /**
   * Gets the maximum scale value of the three axes.
   *
   * @return {number} The maximum scale.
   */
  getMaxScaleOnAxis() {
    const te = this.elements;
    const scaleXSq = te[0] * te[0] + te[1] * te[1] + te[2] * te[2];
    const scaleYSq = te[4] * te[4] + te[5] * te[5] + te[6] * te[6];
    const scaleZSq = te[8] * te[8] + te[9] * te[9] + te[10] * te[10];
    return Math.sqrt(Math.max(scaleXSq, scaleYSq, scaleZSq));
  }
  /**
   * Sets this matrix as a translation transform from the given vector.
   *
   * @param {number|Vector3} x - The amount to translate in the X axis or alternatively a translation vector.
   * @param {number} y - The amount to translate in the Y axis.
   * @param {number} z - The amount to translate in the z axis.
   * @return {Matrix4} A reference to this matrix.
   */
  makeTranslation(x, y, z) {
    if (x.isVector3) {
      this.set(
        1,
        0,
        0,
        x.x,
        0,
        1,
        0,
        x.y,
        0,
        0,
        1,
        x.z,
        0,
        0,
        0,
        1
      );
    } else {
      this.set(
        1,
        0,
        0,
        x,
        0,
        1,
        0,
        y,
        0,
        0,
        1,
        z,
        0,
        0,
        0,
        1
      );
    }
    return this;
  }
  /**
   * Sets this matrix as a rotational transformation around the X axis by
   * the given angle.
   *
   * @param {number} theta - The rotation in radians.
   * @return {Matrix4} A reference to this matrix.
   */
  makeRotationX(theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    this.set(
      1,
      0,
      0,
      0,
      0,
      c,
      -s,
      0,
      0,
      s,
      c,
      0,
      0,
      0,
      0,
      1
    );
    return this;
  }
  /**
   * Sets this matrix as a rotational transformation around the Y axis by
   * the given angle.
   *
   * @param {number} theta - The rotation in radians.
   * @return {Matrix4} A reference to this matrix.
   */
  makeRotationY(theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    this.set(
      c,
      0,
      s,
      0,
      0,
      1,
      0,
      0,
      -s,
      0,
      c,
      0,
      0,
      0,
      0,
      1
    );
    return this;
  }
  /**
   * Sets this matrix as a rotational transformation around the Z axis by
   * the given angle.
   *
   * @param {number} theta - The rotation in radians.
   * @return {Matrix4} A reference to this matrix.
   */
  makeRotationZ(theta) {
    const c = Math.cos(theta), s = Math.sin(theta);
    this.set(
      c,
      -s,
      0,
      0,
      s,
      c,
      0,
      0,
      0,
      0,
      1,
      0,
      0,
      0,
      0,
      1
    );
    return this;
  }
  /**
   * Sets this matrix as a rotational transformation around the given axis by
   * the given angle.
   *
   * This is a somewhat controversial but mathematically sound alternative to
   * rotating via Quaternions. See the discussion [here]{@link https://www.gamedev.net/articles/programming/math-and-physics/do-we-really-need-quaternions-r1199}.
   *
   * @param {Vector3} axis - The normalized rotation axis.
   * @param {number} angle - The rotation in radians.
   * @return {Matrix4} A reference to this matrix.
   */
  makeRotationAxis(axis, angle2) {
    const c = Math.cos(angle2);
    const s = Math.sin(angle2);
    const t = 1 - c;
    const x = axis.x, y = axis.y, z = axis.z;
    const tx = t * x, ty = t * y;
    this.set(
      tx * x + c,
      tx * y - s * z,
      tx * z + s * y,
      0,
      tx * y + s * z,
      ty * y + c,
      ty * z - s * x,
      0,
      tx * z - s * y,
      ty * z + s * x,
      t * z * z + c,
      0,
      0,
      0,
      0,
      1
    );
    return this;
  }
  /**
   * Sets this matrix as a scale transformation.
   *
   * @param {number} x - The amount to scale in the X axis.
   * @param {number} y - The amount to scale in the Y axis.
   * @param {number} z - The amount to scale in the Z axis.
   * @return {Matrix4} A reference to this matrix.
   */
  makeScale(x, y, z) {
    this.set(
      x,
      0,
      0,
      0,
      0,
      y,
      0,
      0,
      0,
      0,
      z,
      0,
      0,
      0,
      0,
      1
    );
    return this;
  }
  /**
   * Sets this matrix as a shear transformation.
   *
   * @param {number} xy - The amount to shear X by Y.
   * @param {number} xz - The amount to shear X by Z.
   * @param {number} yx - The amount to shear Y by X.
   * @param {number} yz - The amount to shear Y by Z.
   * @param {number} zx - The amount to shear Z by X.
   * @param {number} zy - The amount to shear Z by Y.
   * @return {Matrix4} A reference to this matrix.
   */
  makeShear(xy, xz, yx, yz, zx, zy) {
    this.set(
      1,
      yx,
      zx,
      0,
      xy,
      1,
      zy,
      0,
      xz,
      yz,
      1,
      0,
      0,
      0,
      0,
      1
    );
    return this;
  }
  /**
   * Sets this matrix to the transformation composed of the given position,
   * rotation (Quaternion) and scale.
   *
   * @param {Vector3} position - The position vector.
   * @param {Quaternion} quaternion - The rotation as a Quaternion.
   * @param {Vector3} scale - The scale vector.
   * @return {Matrix4} A reference to this matrix.
   */
  compose(position, quaternion, scale) {
    const te = this.elements;
    const x = quaternion._x, y = quaternion._y, z = quaternion._z, w = quaternion._w;
    const x2 = x + x, y2 = y + y, z2 = z + z;
    const xx = x * x2, xy = x * y2, xz = x * z2;
    const yy = y * y2, yz = y * z2, zz = z * z2;
    const wx = w * x2, wy = w * y2, wz = w * z2;
    const sx = scale.x, sy = scale.y, sz = scale.z;
    te[0] = (1 - (yy + zz)) * sx;
    te[1] = (xy + wz) * sx;
    te[2] = (xz - wy) * sx;
    te[3] = 0;
    te[4] = (xy - wz) * sy;
    te[5] = (1 - (xx + zz)) * sy;
    te[6] = (yz + wx) * sy;
    te[7] = 0;
    te[8] = (xz + wy) * sz;
    te[9] = (yz - wx) * sz;
    te[10] = (1 - (xx + yy)) * sz;
    te[11] = 0;
    te[12] = position.x;
    te[13] = position.y;
    te[14] = position.z;
    te[15] = 1;
    return this;
  }
  /**
   * Decomposes this matrix into its position, rotation and scale components
   * and provides the result in the given objects.
   *
   * Note: Not all matrices are decomposable in this way. For example, if an
   * object has a non-uniformly scaled parent, then the object's world matrix
   * may not be decomposable, and this method may not be appropriate.
   *
   * @param {Vector3} position - The position vector.
   * @param {Quaternion} quaternion - The rotation as a Quaternion.
   * @param {Vector3} scale - The scale vector.
   * @return {Matrix4} A reference to this matrix.
   */
  decompose(position, quaternion, scale) {
    const te = this.elements;
    let sx = _v1$5.set(te[0], te[1], te[2]).length();
    const sy = _v1$5.set(te[4], te[5], te[6]).length();
    const sz = _v1$5.set(te[8], te[9], te[10]).length();
    const det = this.determinant();
    if (det < 0) sx = -sx;
    position.x = te[12];
    position.y = te[13];
    position.z = te[14];
    _m1$2.copy(this);
    const invSX = 1 / sx;
    const invSY = 1 / sy;
    const invSZ = 1 / sz;
    _m1$2.elements[0] *= invSX;
    _m1$2.elements[1] *= invSX;
    _m1$2.elements[2] *= invSX;
    _m1$2.elements[4] *= invSY;
    _m1$2.elements[5] *= invSY;
    _m1$2.elements[6] *= invSY;
    _m1$2.elements[8] *= invSZ;
    _m1$2.elements[9] *= invSZ;
    _m1$2.elements[10] *= invSZ;
    quaternion.setFromRotationMatrix(_m1$2);
    scale.x = sx;
    scale.y = sy;
    scale.z = sz;
    return this;
  }
  /**
  	 * Creates a perspective projection matrix. This is used internally by
  	 * {@link PerspectiveCamera#updateProjectionMatrix}.
  
  	 * @param {number} left - Left boundary of the viewing frustum at the near plane.
  	 * @param {number} right - Right boundary of the viewing frustum at the near plane.
  	 * @param {number} top - Top boundary of the viewing frustum at the near plane.
  	 * @param {number} bottom - Bottom boundary of the viewing frustum at the near plane.
  	 * @param {number} near - The distance from the camera to the near plane.
  	 * @param {number} far - The distance from the camera to the far plane.
  	 * @param {(WebGLCoordinateSystem|WebGPUCoordinateSystem)} [coordinateSystem=WebGLCoordinateSystem] - The coordinate system.
  	 * @param {boolean} [reversedDepth=false] - Whether to use a reversed depth.
  	 * @return {Matrix4} A reference to this matrix.
  	 */
  makePerspective(left, right, top, bottom, near, far, coordinateSystem = WebGLCoordinateSystem, reversedDepth = false) {
    const te = this.elements;
    const x = 2 * near / (right - left);
    const y = 2 * near / (top - bottom);
    const a = (right + left) / (right - left);
    const b = (top + bottom) / (top - bottom);
    let c, d;
    if (reversedDepth) {
      c = near / (far - near);
      d = far * near / (far - near);
    } else {
      if (coordinateSystem === WebGLCoordinateSystem) {
        c = -(far + near) / (far - near);
        d = -2 * far * near / (far - near);
      } else if (coordinateSystem === WebGPUCoordinateSystem) {
        c = -far / (far - near);
        d = -far * near / (far - near);
      } else {
        throw new Error("THREE.Matrix4.makePerspective(): Invalid coordinate system: " + coordinateSystem);
      }
    }
    te[0] = x;
    te[4] = 0;
    te[8] = a;
    te[12] = 0;
    te[1] = 0;
    te[5] = y;
    te[9] = b;
    te[13] = 0;
    te[2] = 0;
    te[6] = 0;
    te[10] = c;
    te[14] = d;
    te[3] = 0;
    te[7] = 0;
    te[11] = -1;
    te[15] = 0;
    return this;
  }
  /**
  	 * Creates a orthographic projection matrix. This is used internally by
  	 * {@link OrthographicCamera#updateProjectionMatrix}.
  
  	 * @param {number} left - Left boundary of the viewing frustum at the near plane.
  	 * @param {number} right - Right boundary of the viewing frustum at the near plane.
  	 * @param {number} top - Top boundary of the viewing frustum at the near plane.
  	 * @param {number} bottom - Bottom boundary of the viewing frustum at the near plane.
  	 * @param {number} near - The distance from the camera to the near plane.
  	 * @param {number} far - The distance from the camera to the far plane.
  	 * @param {(WebGLCoordinateSystem|WebGPUCoordinateSystem)} [coordinateSystem=WebGLCoordinateSystem] - The coordinate system.
  	 * @param {boolean} [reversedDepth=false] - Whether to use a reversed depth.
  	 * @return {Matrix4} A reference to this matrix.
  	 */
  makeOrthographic(left, right, top, bottom, near, far, coordinateSystem = WebGLCoordinateSystem, reversedDepth = false) {
    const te = this.elements;
    const x = 2 / (right - left);
    const y = 2 / (top - bottom);
    const a = -(right + left) / (right - left);
    const b = -(top + bottom) / (top - bottom);
    let c, d;
    if (reversedDepth) {
      c = 1 / (far - near);
      d = far / (far - near);
    } else {
      if (coordinateSystem === WebGLCoordinateSystem) {
        c = -2 / (far - near);
        d = -(far + near) / (far - near);
      } else if (coordinateSystem === WebGPUCoordinateSystem) {
        c = -1 / (far - near);
        d = -near / (far - near);
      } else {
        throw new Error("THREE.Matrix4.makeOrthographic(): Invalid coordinate system: " + coordinateSystem);
      }
    }
    te[0] = x;
    te[4] = 0;
    te[8] = 0;
    te[12] = a;
    te[1] = 0;
    te[5] = y;
    te[9] = 0;
    te[13] = b;
    te[2] = 0;
    te[6] = 0;
    te[10] = c;
    te[14] = d;
    te[3] = 0;
    te[7] = 0;
    te[11] = 0;
    te[15] = 1;
    return this;
  }
  /**
   * Returns `true` if this matrix is equal with the given one.
   *
   * @param {Matrix4} matrix - The matrix to test for equality.
   * @return {boolean} Whether this matrix is equal with the given one.
   */
  equals(matrix) {
    const te = this.elements;
    const me = matrix.elements;
    for (let i = 0; i < 16; i++) {
      if (te[i] !== me[i]) return false;
    }
    return true;
  }
  /**
   * Sets the elements of the matrix from the given array.
   *
   * @param {Array<number>} array - The matrix elements in column-major order.
   * @param {number} [offset=0] - Index of the first element in the array.
   * @return {Matrix4} A reference to this matrix.
   */
  fromArray(array, offset = 0) {
    for (let i = 0; i < 16; i++) {
      this.elements[i] = array[i + offset];
    }
    return this;
  }
  /**
   * Writes the elements of this matrix to the given array. If no array is provided,
   * the method returns a new instance.
   *
   * @param {Array<number>} [array=[]] - The target array holding the matrix elements in column-major order.
   * @param {number} [offset=0] - Index of the first element in the array.
   * @return {Array<number>} The matrix elements in column-major order.
   */
  toArray(array = [], offset = 0) {
    const te = this.elements;
    array[offset] = te[0];
    array[offset + 1] = te[1];
    array[offset + 2] = te[2];
    array[offset + 3] = te[3];
    array[offset + 4] = te[4];
    array[offset + 5] = te[5];
    array[offset + 6] = te[6];
    array[offset + 7] = te[7];
    array[offset + 8] = te[8];
    array[offset + 9] = te[9];
    array[offset + 10] = te[10];
    array[offset + 11] = te[11];
    array[offset + 12] = te[12];
    array[offset + 13] = te[13];
    array[offset + 14] = te[14];
    array[offset + 15] = te[15];
    return array;
  }
}
const _v1$5 = /* @__PURE__ */ new Vector3();
const _m1$2 = /* @__PURE__ */ new Matrix4();
const _zero = /* @__PURE__ */ new Vector3(0, 0, 0);
const _one = /* @__PURE__ */ new Vector3(1, 1, 1);
const _x = /* @__PURE__ */ new Vector3();
const _y = /* @__PURE__ */ new Vector3();
const _z = /* @__PURE__ */ new Vector3();
if (typeof __THREE_DEVTOOLS__ !== "undefined") {
  __THREE_DEVTOOLS__.dispatchEvent(new CustomEvent("register", { detail: {
    revision: REVISION
  } }));
}
if (typeof window !== "undefined") {
  if (window.__THREE__) {
    console.warn("WARNING: Multiple instances of Three.js being imported.");
  } else {
    window.__THREE__ = REVISION;
  }
}
function cross$1(a, b) {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0]
  ];
}
function normalize(value2, label) {
  const length = Math.hypot(value2[0], value2[1], value2[2]);
  if (length < 1e-12) throw new Error(`${label} axis has zero length.`);
  return [value2[0] / length, value2[1] / length, value2[2] / length];
}
function connectorTransform(frame) {
  const xInput = normalize(frame.xAxis, "Connector X");
  const zAxis = normalize(frame.zAxis, "Connector Z");
  const yAxis = normalize(cross$1(zAxis, xInput), "Connector Y");
  const xAxis = normalize(cross$1(yAxis, zAxis), "Connector X");
  const [x, y, z] = frame.origin;
  if (![x, y, z].every(Number.isFinite)) {
    throw new Error("Connector origin must be finite.");
  }
  return [
    xAxis[0],
    xAxis[1],
    xAxis[2],
    0,
    yAxis[0],
    yAxis[1],
    yAxis[2],
    0,
    zAxis[0],
    zAxis[1],
    zAxis[2],
    0,
    x,
    y,
    z,
    1
  ];
}
function connectorMatrix(frame) {
  return new Matrix4().fromArray(connectorTransform(frame));
}
const METRES_TO_MM = 1e3;
const cross = (a, b) => [
  a[1] * b[2] - a[2] * b[1],
  a[2] * b[0] - a[0] * b[2],
  a[0] * b[1] - a[1] * b[0]
];
function connectorPlacement(frame) {
  const origin = [
    frame.origin_m[0] * METRES_TO_MM,
    frame.origin_m[1] * METRES_TO_MM,
    frame.origin_m[2] * METRES_TO_MM
  ];
  const zAxis = [...frame.primary_axis_xyz];
  const xAxis = [...frame.secondary_axis_xyz];
  const matrix = connectorMatrix({ origin, zAxis, xAxis, yAxis: cross(zAxis, xAxis) });
  const rotation = new Quaternion().setFromRotationMatrix(matrix);
  return {
    placement_mm: origin,
    rotation: [rotation.x, rotation.y, rotation.z, rotation.w]
  };
}
function assemblyJobFor(projection) {
  const untranslated = [];
  const note = (id2, name, reason) => untranslated.push({ id: id2, name, reason });
  const parts = [];
  const buildable = /* @__PURE__ */ new Set();
  for (const definition of projection.part_definitions) {
    const document = definition.feature_document;
    if (!document) {
      note(definition.id, definition.name, "the part carries no feature document");
      continue;
    }
    const translated = translateDocument(document);
    if (!translated.features.length) {
      note(definition.id, definition.name, "the part translated to no geometry");
      continue;
    }
    if (!translated.complete)
      note(
        definition.id,
        definition.name,
        `part is incomplete: ${translated.untranslated[0]?.reason ?? "unknown"}`
      );
    parts.push({ id: definition.id, features: translated.features });
    buildable.add(definition.id);
  }
  const connectors = new Map(
    projection.connector_definitions.map((connector) => [connector.id, connector])
  );
  const instanceDefinitions = new Map(projection.instances.map((instance) => [instance.id, instance.definition_id]));
  const placed = /* @__PURE__ */ new Set();
  const instances = projection.instances.flatMap((instance) => {
    if (instance.suppressed) return [];
    if (instance.definition_kind !== "part") {
      note(instance.id, instance.name, "sub-assemblies are not solved yet");
      return [];
    }
    if (!buildable.has(instance.definition_id)) {
      note(instance.id, instance.name, "its part did not translate");
      return [];
    }
    placed.add(instance.id);
    const rest = instance.rest_transform;
    return [{
      id: instance.id,
      part: instance.definition_id,
      placement_mm: [
        rest.position_m[0] * METRES_TO_MM,
        rest.position_m[1] * METRES_TO_MM,
        rest.position_m[2] * METRES_TO_MM
      ],
      rotation: [...rest.rotation_quaternion_xyzw],
      grounded: instance.grounded
    }];
  });
  const joints = projection.mates.flatMap((mate) => {
    if (mate.suppressed) return [];
    const end = (endpoint) => {
      if (!placed.has(endpoint.instance_id)) return null;
      const connector = connectors.get(endpoint.connector_definition_id);
      if (!connector || connector.suppressed) {
        note(mate.id, mate.name, `Connector ${endpoint.connector_definition_id} is ${connector ? "suppressed" : "missing"}. Restore it or select a new connector.`);
        return null;
      }
      if (connector.part_definition_id !== instanceDefinitions.get(endpoint.instance_id)) {
        note(mate.id, mate.name, "The connector belongs to a different part definition. Select a connector on this component.");
        return null;
      }
      const frame = connector.frame_part_local;
      const finite = (vector2) => vector2.length === 3 && vector2.every(Number.isFinite);
      const length = (vector2) => Math.hypot(...vector2);
      if (!finite(frame.origin_m) || !finite(frame.primary_axis_xyz) || !finite(frame.secondary_axis_xyz) || length(frame.primary_axis_xyz) < 1e-9 || length(frame.secondary_axis_xyz) < 1e-9 || length(cross(frame.primary_axis_xyz, frame.secondary_axis_xyz)) / (length(frame.primary_axis_xyz) * length(frame.secondary_axis_xyz)) < 1e-6) {
        note(mate.id, mate.name, "The connector frame is invalid. Repair its origin and axes before solving.");
        return null;
      }
      return { instance: endpoint.instance_id, ...connectorPlacement(frame) };
    };
    const a = end(mate.endpoint_a);
    const b = end(mate.endpoint_b);
    if (!a || !b) {
      if (!placed.has(mate.endpoint_a.instance_id) || !placed.has(mate.endpoint_b.instance_id))
        note(mate.id, mate.name, "it mates an instance that is not in the assembly");
      return [];
    }
    return [{ id: mate.id, kind: mate.type_id, a, b }];
  });
  return {
    job: { parts, instances, joints },
    untranslated,
    complete: untranslated.length === 0
  };
}
const primitiveNames = { box: "Box", cylinder: "Cylinder", cone: "Cone", sphere: "Sphere", torus: "Torus" };
const defaultPrimitiveDimensions = { width: 20, length: 30, height: 10, radius: 10, tubeRadius: 3 };
const primitiveFields = {
  box: ["width", "length", "height"],
  cylinder: ["radius", "height"],
  cone: ["radius", "height"],
  sphere: ["radius"],
  torus: ["radius", "tubeRadius"]
};
function appendSolidPrimitive(source, kind, dimensions) {
  if (!Object.hasOwn(primitiveFields, kind)) throw Error("Unknown solid primitive.");
  for (const key of primitiveFields[kind]) if (!Number.isFinite(dimensions[key]) || dimensions[key] <= 0 || dimensions[key] > 1e6)
    throw Error("Dimensions must be positive and no greater than 1,000,000 mm.");
  const { width, length, height, radius, tubeRadius } = dimensions;
  if (kind === "torus" && tubeRadius >= radius) throw Error("The tube radius must be smaller than the major radius.");
  const name = primitiveNames[kind], sketchId = crypto.randomUUID(), bodyId = crypto.randomUUID();
  const profile = {
    id: sketchId,
    type: "profile",
    name: `${name} profile`,
    suppressed: false,
    plane: kind === "sphere" || kind === "torus" || kind === "cone" ? "XZ" : "XY",
    offsetMillimeters: 0,
    profile: kind === "box" ? { type: "polygon", pointsMillimeters: [[-width / 2, -length / 2], [width / 2, -length / 2], [width / 2, length / 2], [-width / 2, length / 2]] } : kind === "cone" ? { type: "polygon", pointsMillimeters: [[0, 0], [radius, 0], [0, height]] } : kind === "sphere" ? { type: "drawing", contours: [{ type: "path", start: [0, -radius], segments: [{ type: "arc", middle: [radius, 0], end: [0, radius] }, { type: "line", end: [0, -radius] }] }] } : { type: "circle", radiusMillimeters: kind === "torus" ? tubeRadius : radius, centerMillimeters: [kind === "torus" ? radius : 0, 0] }
  };
  let result = insertFeature(source ?? createEmptyPartDocument(name), profile);
  const common = { id: crypto.randomUUID(), name, suppressed: false, bodyId, profileFeatureId: sketchId, operation: "new" };
  result = insertFeature(result, kind === "sphere" || kind === "torus" || kind === "cone" ? { ...common, type: "revolve", axis: "Z", angleDegrees: 360 } : { ...common, type: "extrude", distanceMillimeters: height });
  validatePartDocument(result);
  return result;
}
const tool$1 = (name, description, properties, required = []) => ({
  name: `aether_cad_${name}`,
  description,
  inputSchema: { type: "object", properties, required, additionalProperties: false }
});
const knowledgeTool = tool$1(
  "docs",
  "Discover the actual tools and examples available in this CAD editor. Search by query or describe one exact tool name. Results include input schemas and honest runtime limits; discovering a tool does not execute it.",
  { query: { type: "string", maxLength: 200 }, name: { type: "string", maxLength: 100 }, offset: { type: "integer", minimum: 0 } }
);
const partAITools = [
  knowledgeTool,
  tool$1(
    "run_program",
    'Run 1–16 existing Part editing commands as one transaction and one undo step. program_json is {version:1,steps:[{id,tool,arguments}]}. Tool names are existing aether_cad_* editing tools. Later arguments may use {"$ref":"step_id.feature_id"} or {"$ref":"step_id.body_id"}. Exact rebuilds resolve identities between steps; only the completed program commits. No arbitrary JavaScript, loops, filesystem or network access. Use docs for examples, then verify and preview the result.',
    { program_json: { type: "string", maxLength: 65536 } },
    ["program_json"]
  ),
  tool$1(
    "verify",
    "Rebuild and inspect exact native solid properties without editing. Returns volume in mm³, area in mm², center and bounds in mm; optional density in kg/m³ adds mass and inertia. Meshes and invalid geometry are refused. This is geometry evidence, not engineering certification.",
    { density_kg_m3: { type: "number", exclusiveMinimum: 0, maximum: 1e6 }, offset: { type: "integer", minimum: 0, maximum: 512 } }
  ),
  tool$1(
    "preview",
    "Inspect a PNG of the current CAD viewport without changing camera, selection or history. Includes visible bodies, current display settings and overlays; hidden/off-screen geometry is not shown. A visual check complements exact verify measurements. No app panels or desktop capture.",
    {}
  )
];
const number = { type: "number" }, string = { type: "string" }, boolean = { type: "boolean" };
const tool = (name, description, properties, required = []) => ({ name: "aether_cad_" + name, description, inputSchema: { type: "object", properties, required, additionalProperties: false } });
const plane = { name: string, plane: { type: "string", enum: ["XY", "XZ", "YZ"] }, offset_mm: number };
const operation = { name: string, profile_id: string, operation: { type: "string", enum: ["new", "add", "cut"] }, target_body_id: string };
const cadAgentTools = [
  ...partAITools,
  tool("inspect", "Inspect the open Part: feature IDs, editable parameters and body IDs. All geometry tools use explicit millimeters or degrees. Use offset/limit to page the features.", { offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 50 } }),
  tool("feature_references", "Inspect direct inputs or dependents of one feature before editing. Uses the canonical history graph, including suppressed features; does not claim face/edge correspondence or geometric validity. Paginate using next_offset.", { feature_id: string, direction: { type: "string", enum: ["inputs", "dependents"] }, offset: { type: "integer", minimum: 0 }, limit: { type: "integer", minimum: 1, maximum: 50 } }, ["feature_id"]),
  tool("solid_primitive", "Create a new exact body with editable profile and solid features, using the same operation as the tool tray. Choose box (width_mm, length_mm, height_mm), cylinder or cone (radius_mm, height_mm), sphere (radius_mm), or torus (radius_mm, tube_radius_mm). All listed dimensions for the chosen kind are required; other dimensions are refused. Cone base lies on XY and its tip points in positive Z. Rebuild must succeed before committing.", { kind: { type: "string", enum: Object.keys(primitiveFields) }, width_mm: number, length_mm: number, height_mm: number, radius_mm: number, tube_radius_mm: number }, ["kind"]),
  tool("sketch_rectangle", "Add an editable rectangular sketch profile on XY, XZ or YZ. x_mm/y_mm are local sketch coordinates; offset_mm moves its plane along its normal.", { ...plane, x_mm: number, y_mm: number, width_mm: number, height_mm: number }, ["plane", "x_mm", "y_mm", "width_mm", "height_mm"]),
  tool("sketch_circle", "Add an editable circular sketch profile; returns its feature ID.", { ...plane, center_x_mm: number, center_y_mm: number, radius_mm: number }, ["plane", "center_x_mm", "center_y_mm", "radius_mm"]),
  tool("sketch_polygon", "Add a closed polygon sketch. Coordinates are local millimeters; do not repeat the first point. Native CAD validates the profile.", { ...plane, points_mm: { type: "array", minItems: 3, maxItems: 128, items: { type: "array", items: number, minItems: 2, maxItems: 2 } } }, ["plane", "points_mm"]),
  tool("extrude", "Extrude a sketch: new/add travel along its normal; cut travels opposite the normal by default. Reversed flips that direction. Use new for a new body; add/cut require a target_body_id from inspect. Exact native rebuild must succeed before the document changes.", { ...operation, depth_mm: number, reversed: boolean }, ["profile_id", "depth_mm", "operation"]),
  tool("revolve", "Revolve a sketch around a principal axis. add/cut require target_body_id. Native engine checks validity.", { ...operation, axis: { type: "string", enum: ["X", "Y", "Z"] }, angle_deg: number }, ["profile_id", "axis", "angle_deg", "operation"]),
  tool("extrude_depth", "Change an existing blind/symmetric extrusion depth, then rebuild.", { feature_id: string, depth_mm: number }, ["feature_id", "depth_mm"]),
  tool("suppress", "Suppress or unsuppress an existing feature. Rebuild must succeed.", { feature_id: string, suppressed: boolean }, ["feature_id", "suppressed"]),
  tool("undo", "Undo one successful Part edit, using the same history as the editor.", {}),
  tool("redo", "Redo one Part edit, using the same history as the editor.", {})
];
function numberValue(a, key, fallback, positive = false) {
  const v = a[key] ?? fallback;
  if (typeof v !== "number" || !Number.isFinite(v) || Math.abs(v) > 1e6 || positive && v <= 0) throw Error(`${key} must be finite ${positive ? "and positive " : ""}within 1000000.`);
  return v;
}
function nameValue(a, fallback) {
  const v = a.name ?? fallback;
  if (typeof v !== "string" || !v.trim() || v.length > 200) throw Error("Use a name with 1–200 characters.");
  return v;
}
function validateLiveArguments(name, args) {
  const t = cadAgentTools.find((t2) => t2.name === name);
  if (!t || !args || typeof args !== "object" || Array.isArray(args) || Object.keys(args).some((k) => !Object.hasOwn(t.inputSchema.properties, k))) throw Error("Unknown CAD tool or argument.");
}
function inspectPart(doc, args = {}) {
  const offset = numberValue(args, "offset", 0), limit = numberValue(args, "limit", 25, true);
  if (!Number.isInteger(offset) || offset < 0 || !Number.isInteger(limit) || limit > 50) throw Error("Use offset >= 0 and limit 1–50.");
  const result = prepareCommand("cad.part.inspect", JSON.stringify(doc), {}).result;
  return { ...result, total_features: doc.features.length, offset, features: result.features.slice(offset, offset + limit).map((f, i) => {
    const source = doc.features[offset + i];
    return { ...f, ...source.type === "profile" ? { plane: source.plane, offset_mm: source.offsetMillimeters, profile: source.profile.type === "circle" || source.profile.type === "polygon" ? source.profile : { type: source.profile.type } } : {} };
  }), next_offset: offset + limit < doc.features.length ? offset + limit : null };
}
function preparePartEdit(doc, name, args) {
  validateLiveArguments(name, args);
  validatePartDocument(doc);
  if (rollbackPosition(doc) !== doc.features.length) throw Error("Move the rollback bar to the end before agent editing.");
  if (doc.features.length >= 512) throw Error("Agent editing supports at most 512 features.");
  if (name === "aether_cad_solid_primitive") {
    if (typeof args.kind !== "string" || !Object.hasOwn(primitiveFields, args.kind)) throw Error("Choose box, cylinder, cone, sphere or torus.");
    if (doc.features.length > 510) throw Error("A primitive requires room for two features within the 512-feature limit.");
    const kind = args.kind;
    const names = { width: "width_mm", length: "length_mm", height: "height_mm", radius: "radius_mm", tubeRadius: "tube_radius_mm" };
    const required = primitiveFields[kind];
    const allowed = /* @__PURE__ */ new Set(["kind", ...required.map((key) => names[key])]);
    if (Object.keys(args).some((key) => !allowed.has(key))) throw Error("Only provide the dimensions used by the chosen primitive.");
    const dimensions = { ...defaultPrimitiveDimensions };
    for (const key of required) dimensions[key] = numberValue(args, names[key], void 0, true);
    const document = appendSolidPrimitive(doc, kind, dimensions);
    return { document, featureID: document.features.at(-1).id };
  }
  if (name === "aether_cad_extrude_depth" || name === "aether_cad_suppress") {
    if (typeof args.feature_id !== "string") throw Error("Inspect the part for its feature ID.");
    if (name === "aether_cad_suppress" && typeof args.suppressed !== "boolean") throw Error("suppressed must be true or false.");
    const result = prepareCommand(name === "aether_cad_suppress" ? "cad.feature.suppress" : "cad.extrude.setdepth", JSON.stringify(doc), { feature_id: args.feature_id, ...name === "aether_cad_suppress" ? { action: args.suppressed ? "suppress" : "unsuppress" } : { depth_mm: numberValue(args, "depth_mm", void 0, true) } });
    if (!result.candidate) throw Error("The CAD operation produced no candidate.");
    return { document: JSON.parse(result.candidate), featureID: args.feature_id };
  }
  const id2 = crypto.randomUUID();
  let feature;
  if (name.startsWith("aether_cad_sketch_")) {
    if (!["XY", "XZ", "YZ"].includes(String(args.plane))) throw Error("Choose XY, XZ or YZ.");
    let profile;
    if (name === "aether_cad_sketch_circle") profile = { type: "circle", centerMillimeters: [numberValue(args, "center_x_mm"), numberValue(args, "center_y_mm")], radiusMillimeters: numberValue(args, "radius_mm", void 0, true) };
    else if (name === "aether_cad_sketch_rectangle") {
      const x = numberValue(args, "x_mm"), y = numberValue(args, "y_mm"), w = numberValue(args, "width_mm", void 0, true), h = numberValue(args, "height_mm", void 0, true);
      profile = { type: "polygon", pointsMillimeters: [[x, y], [x + w, y], [x + w, y + h], [x, y + h]] };
    } else {
      if (!Array.isArray(args.points_mm) || args.points_mm.length < 3 || args.points_mm.length > 128) throw Error("Use 3–128 points.");
      profile = { type: "polygon", pointsMillimeters: args.points_mm.map((p) => {
        if (!Array.isArray(p) || p.length !== 2) throw Error("Use x,y pairs.");
        return [numberValue({ v: p[0] }, "v"), numberValue({ v: p[1] }, "v")];
      }) };
    }
    feature = { type: "profile", id: id2, name: nameValue(args, `Sketch ${doc.features.length + 1}`), suppressed: false, plane: args.plane, offsetMillimeters: numberValue(args, "offset_mm", 0), profile };
  } else if (name === "aether_cad_extrude" || name === "aether_cad_revolve") {
    const profile = doc.features.find((f) => f.id === args.profile_id && (f.type === "profile" || f.type === "sketch") && !f.suppressed);
    if (!profile) throw Error("Inspect the part and choose an unsuppressed sketch ID.");
    if (!["new", "add", "cut"].includes(String(args.operation))) throw Error("Choose new, add or cut.");
    const operation2 = args.operation;
    if (operation2 !== "new" && typeof args.target_body_id !== "string") throw Error("Choose a target_body_id from inspect.");
    const common = { id: id2, suppressed: false, profileFeatureId: profile.id, operation: operation2, ...operation2 !== "new" ? { targetBodyId: args.target_body_id } : {} };
    if (name === "aether_cad_extrude") {
      if (args.reversed !== void 0 && typeof args.reversed !== "boolean") throw Error("reversed must be true or false.");
      feature = { ...common, type: "extrude", name: nameValue(args, "Extrude"), distanceMillimeters: numberValue(args, "depth_mm", void 0, true), endType: "blind", ...args.reversed ? { reversed: true } : {}, ...operation2 === "new" ? { separateBodies: true } : {} };
    } else {
      if (!["X", "Y", "Z"].includes(String(args.axis))) throw Error("Choose X, Y or Z.");
      const angle2 = numberValue(args, "angle_deg", void 0, true);
      if (angle2 > 360) throw Error("Revolve angle must be at most 360 degrees.");
      feature = { ...common, type: "revolve", name: nameValue(args, "Revolve"), axis: args.axis, angleDegrees: angle2 };
    }
  } else throw Error("Unknown CAD edit.");
  return { document: insertFeature(doc, feature), featureID: id2 };
}
const programToolNames = ["solid_primitive", "sketch_rectangle", "sketch_circle", "sketch_polygon", "extrude", "revolve", "extrude_depth", "suppress"].map((name) => `aether_cad_${name}`);
const edits = new Set(programToolNames);
const object = (value2) => !!value2 && typeof value2 === "object" && !Array.isArray(value2);
function fields(value2, names) {
  if (!object(value2) || Object.keys(value2).some((key) => !names.includes(key))) throw Error("Unknown or malformed program fields.");
}
function parseProgram(encoded) {
  if (typeof encoded !== "string" || new TextEncoder().encode(encoded).length > 65536) throw Error("Use a program of at most 64 KiB.");
  const program = JSON.parse(encoded);
  fields(program, ["version", "steps"]);
  if (program.version !== 1 || !Array.isArray(program.steps) || !program.steps.length || program.steps.length > 16) throw Error("Use version 1 with 1–16 steps.");
  const ids = /* @__PURE__ */ new Set();
  for (const step of program.steps) {
    fields(step, ["id", "tool", "arguments"]);
    if (typeof step.id !== "string" || !/^[a-zA-Z][a-zA-Z0-9_-]{0,39}$/.test(step.id) || ids.has(step.id)) throw Error("Use unique step IDs of 1–40 letters, digits, underscores or hyphens, starting with a letter.");
    if (typeof step.tool !== "string" || !edits.has(step.tool) || !object(step.arguments)) throw Error("Choose an existing Part editing tool with an arguments object.");
    ids.add(step.id);
  }
  return program.steps;
}
function prepareProgramStep(source, step, references) {
  parseProgram(JSON.stringify({ version: 1, steps: [step] }));
  if (Object.hasOwn(references, step.id)) throw Error("A program step cannot execute twice.");
  function resolve2(value2, depth = 0) {
    if (depth > 12) throw Error("Program arguments are nested too deeply.");
    if (Array.isArray(value2)) return value2.map((item) => resolve2(item, depth + 1));
    if (!object(value2)) return value2;
    if ("$ref" in value2) {
      fields(value2, ["$ref"]);
      const match = typeof value2.$ref === "string" && /^([a-zA-Z][a-zA-Z0-9_-]{0,39})\.(feature_id|body_id)$/.exec(value2.$ref);
      const result = match && Object.hasOwn(references, match[1]) && references[match[1]]?.[match[2]];
      if (!result) throw Error("A program reference must name an earlier step and an available feature_id or body_id.");
      return result;
    }
    return Object.fromEntries(Object.entries(value2).map(([key, item]) => [key, resolve2(item, depth + 1)]));
  }
  const args = resolve2(step.arguments);
  const beforeBodyIDs = availableBodies(source).map((body) => body.id);
  const edited = preparePartEdit(structuredClone(source), step.tool, args);
  return { ...edited, beforeBodyIDs, targetBodyID: typeof args.target_body_id === "string" ? args.target_body_id : void 0 };
}
function programStepReference(step, resolved) {
  const before = new Set(step.beforeBodyIDs);
  const added = availableBodies(resolved).filter((body) => !before.has(body.id));
  return { feature_id: step.featureID, ...added.length === 1 ? { body_id: added[0].id } : step.targetBodyID ? { body_id: step.targetBodyID } : {} };
}
const plateProgram = { version: 1, steps: [
  { id: "outline", tool: "aether_cad_sketch_rectangle", arguments: { plane: "XY", x_mm: 0, y_mm: 0, width_mm: 80, height_mm: 50 } },
  { id: "plate", tool: "aether_cad_extrude", arguments: { profile_id: { $ref: "outline.feature_id" }, depth_mm: 10, operation: "new" } }
] };
function beginSavedProgram(content, encoded) {
  const doc = parsePartDocument(content);
  if (doc.features.length > 512) throw Error("CAD automation supports at most 512 features.");
  if (rollbackPosition(doc) !== doc.features.length) throw Error("Move the rollback bar to the end before editing this saved part.");
  return { steps: parseProgram(encoded) };
}
function prepareSavedProgramStep(content, step, references) {
  const prepared = prepareProgramStep(parsePartDocument(content), step, references);
  const translation = translateDocument(prepared.document);
  if (!translation.complete) throw Error("The native engine cannot evaluate the complete program candidate.");
  return {
    candidate: serializePartDocument(prepared.document),
    features: translation.features,
    pending: { featureID: prepared.featureID, beforeBodyIDs: prepared.beforeBodyIDs, targetBodyID: prepared.targetBodyID }
  };
}
function acceptSavedProgramStep(request) {
  const content = finalizeCandidate(request.content, request.body_outputs, request.sketch_frames, request.scope_resolutions);
  const doc = parsePartDocument(content);
  return { content, reference: programStepReference(request.pending, doc), result: inspectPart(doc) };
}
function savedProgramDocs(args) {
  const query = args.query ?? "", offset = args.offset ?? 0;
  if (typeof query !== "string" || query.length > 200 || typeof offset !== "number" || !Number.isInteger(offset) || offset < 0 || offset > 1e3) throw Error("Use query <= 200 characters and offset 0–1000.");
  const words = query.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);
  const tools = cadAgentTools.filter((tool2) => programToolNames.includes(tool2.name)).filter((tool2) => !words.length || words.some((word) => `${tool2.name} ${tool2.description}`.toLowerCase().includes(word)));
  return {
    runtime: "saved-file-native",
    module: "AetherCAD.AI",
    total: tools.length,
    tools: tools.slice(offset, offset + 5),
    next_offset: offset + 5 < tools.length ? offset + 5 : null,
    execute_with: "cad.part.runprogram",
    verify_with: "cad.part.verify",
    example: { program_json: JSON.stringify(plateProgram), expected_volume_mm3: 4e4 },
    limits: ["Tools are program steps, not separate transport endpoints.", "1–16 steps, 64 KiB program, 512 features, 4 MiB document.", "One returned candidate; Studio owns revision checking and saving. Open editors must reload.", "Native execution only; this does not provide browser-WASM parity or pixel previews."]
  };
}
function exampleAssemblyRecipe(kind = "single", partID) {
  const document = appendSolidPrimitive(null, "box", { ...defaultPrimitiveDimensions, width: 10, length: 10, height: 10 });
  return {
    version: 1,
    parts: [partID ? { key: "block", part_id: partID } : { key: "block", name: "Block", document }],
    instances: kind === "template" ? [] : [{ key: "Block:1", part: "block", position_mm: kind === "circular" ? [30, 0, 0] : [0, 0, 0], grounded: true }],
    ...kind === "single" || kind === "template" ? {} : { patterns: [kind === "linear" ? { key: "Row", source: "Block:1", kind: "linear", count: 4, step_mm: [20, 0, 0] } : { key: "Ring", source: "Block:1", kind: "circular", count: 6, axis_xyz: [0, 0, 1], center_mm: [0, 0, 0], step_degrees: 60, rotate: true }] }
  };
}
try {
  const request = JSON.parse(readFileSync(stdin.fd, "utf8"));
  if (request.phase === "assembly") {
    const projection = request.projection;
    for (const part of projection.part_definitions) if (part.feature_document) {
      part.feature_document = parsePartDocument(JSON.stringify(part.feature_document));
      if (part.feature_document.features.length > 512) throw Error("A Part supports up to 512 features.");
    }
    const used = new Set(projection.instances.filter((i) => !i.suppressed).map((i) => i.definition_id));
    for (const id2 of request.template_ids ?? []) used.add(id2);
    projection.part_definitions = projection.part_definitions.filter((p) => used.has(p.id));
    projection.instances = projection.instances.map((instance) => ({ ...instance, rest_transform: instance.solved_world_transform }));
    stdout.write(JSON.stringify(assemblyJobFor(projection)));
  } else {
    const result = request.phase === "assembly_example" ? exampleAssemblyRecipe("linear", request.part_id ?? void 0) : request.phase === "compare" ? { changed: serializePartDocument(parsePartDocument(request.content)) !== serializePartDocument(parsePartDocument(request.candidate)) } : request.phase === "program_begin" ? beginSavedProgram(request.content, request.program_json) : request.phase === "program_step" ? prepareSavedProgramStep(request.content, request.step, request.references) : request.phase === "program_accept" ? acceptSavedProgramStep(request) : request.command === "cad.part.docs" ? { result: savedProgramDocs(request.arguments) } : request.phase === "finalize" ? { content: finalizeCandidate(request.content, request.body_outputs, request.sketch_frames, request.scope_resolutions) } : prepareCommand(request.command, request.content, request.arguments);
    const encoded = JSON.stringify(result);
    if (Buffer.byteLength(encoded) > 8 * 1024 * 1024) throw Error("CAD result exceeds the automation size limit.");
    stdout.write(encoded);
  }
} catch (error) {
  stdout.write(JSON.stringify({ error: error instanceof Error ? error.message : "CAD command failed." }));
}
