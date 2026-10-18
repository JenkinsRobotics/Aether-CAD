import {nativePartTransform} from './modeling/transform-reference';
import { blockedSketchGeometry } from '../freecad-engine/browser/fixed-geometry';
import { nativeWireSegments } from '../freecad-engine/browser/wire-geometry';
import { nativePierceChecks } from '../freecad-engine/browser/pierce-native';
import { resolveProfileDrawing } from '@aether/core/document';
import type { SketchContour, SketchDrawing, SketchSegment } from '@aether/core/sketch';
import { sketchFaceRegions } from '../freecad-engine/browser/connected-sketch-regions';
import { matchesProfileRegion, type ProfileRegionReference } from '../freecad-engine/browser/profile-region-reference';
import {nativeExtrusionStart} from './modeling/extrude-start-reference';
import {nativeExtrusionPoint} from './modeling/extrude-point-reference';
import { nativeSketchDirection } from './modeling/extrude-direction-reference';
/** Translate an Aether `PartDocument` into a job for the default engine.
 *
 *  This is the layer the FreeCAD decision actually buys: the geometry is
 *  already implemented, so each feature costs a translation rather than an
 *  implementation. A pure function — no FreeCAD, no network — so it is unit
 *  tested against real documents without the engine installed.
 *
 *  Anything it cannot express is reported, not silently dropped: a caller must
 *  be able to tell the difference between "FreeCAD built your part" and
 *  "FreeCAD built most of your part".
 */
import type { PartDocument, PartFeature, SketchPlane } from "./aether-core";
import { bodyIDForFeature, featureReferenceErrors, featureDependencies } from "@aether/core/document";
import type { FreeCADFeature } from "./freecad-geometry";

/** One closed region of a sketch, as the engine will see it. A sketch with
 *  several regions produces several, and an extrude names the one it wants. */
export interface ProfileRegion {
  /** The id the engine sketch is built under, and that a pad points at. */
  engineId: string;
  /** The contour's own stable id, when it has been given one. */
  contourId?: string;
  /** Where the contour sits in the sketch, for stamping identity on demand. */
  contourIndex: number;
  /** Joined boundaries reference these authored sources; index stays UI-only. */
  sourceContourIndices?: number[];
  sourceContourIds?: string[];
  previewContour?: SketchContour;
  /** What to call it in a picker. */
  label: string;
  feature: FreeCADFeature;
  closed?: boolean;
}

interface ProfileTranslation {
  regions: ProfileRegion[];
  /** Regions left out, with the reason, so a half-built sketch says so. */
  skipped: string[];
}

/** A profile that is one region by construction — a circle, a rectangle. */
const soleRegion = (feature: FreeCADFeature): ProfileTranslation => ({
  regions: [{ engineId: feature.id, contourIndex: 0, label: "Region 1", feature }],
  skipped: [],
});

/** The regions of a sketch that a solid feature can be built on.
 *
 *  The picker and the translator must agree on what counts as a region and on
 *  the order they come in, so both read this one list.
 */
export function sketchRegions(feature: PartFeature, includeOpen = false, history?: readonly PartFeature[]): ProfileRegion[] {
  // External relationships may move an otherwise unchanged saved contour.
  // Region selection and native rebuilding must use the same resolved drawing.
  const resolved = feature.type === 'profile' && history
    ? {...feature, profile: resolveProfileDrawing(history, feature.id)} : feature;
  if (!history && feature.type === 'profile') {
    const drawing=feature.profile.type==='drawing'?feature.profile:feature.profile.type==='projection'?feature.profile.authored:undefined;
    if(drawing?.constraints?.some(c=>c.kind==='pierce'))throw Error('Resolve this sketch in its document before selecting regions.');
  }
  const translated = profileFeature(resolved);
  return typeof translated === "string" ? [] : translated.regions.filter(region => includeOpen ? !region.sourceContourIndices : region.closed !== false);
}

export interface Translation {
  features: FreeCADFeature[];
  /** Features the engine path cannot express yet, with the reason. */
  untranslated: { id: string; name: string; reason: string }[];
  /** True when every unsuppressed feature made it across. */
  complete: boolean;
}

const regionKey = (region: ProfileRegion, fallback: string): string => region.sourceContourIndices
  ? `connected:${JSON.stringify([...(region.sourceContourIds ?? region.sourceContourIndices)].sort())}`
  : region.contourId ?? fallback;

const planeName = (plane: SketchPlane | undefined): string =>
  typeof plane === "string" ? plane : "XY";

/** Rectangle sketches are stored as a revisable centre/width/height profile in
 *  some documents and as an explicit polygon in others; both become a polygon
 *  for the engine, which is the shape FreeCAD's Sketcher wants either way. */
function profileFeature(feature: PartFeature, pierceChecks:Map<number,Record<string,unknown>[]>=new Map()): ProfileTranslation | string {
  if (feature.type !== "profile" && feature.type !== "sketch")
    return `a ${feature.type} feature is not a profile`;
  const profile = (feature as { profile?: Record<string, unknown> }).profile;
  if (!profile || typeof profile !== "object") return "the sketch has no profile";
  const plane = planeName((feature as { plane?: SketchPlane }).plane);
  const offset_mm = (feature as { offsetMillimeters?: number }).offsetMillimeters ?? 0;
  const frame = "frame" in feature ? feature.frame : undefined;
  const placement = { plane, offset_mm, ...(frame ? { frame } : {}), ...(feature.type === "profile" && feature.support ? { support: feature.support, source_profile_id: feature.id } : {}) };

  if (profile.type === "circle") {
    const radius = Number(profile.radiusMillimeters);
    const center = (profile.centerMillimeters as [number, number]) ?? [0, 0];
    if (!Number.isFinite(radius) || radius <= 0) return "the circle has no positive radius";
    return soleRegion({
      id: feature.id,
      kind: "sketch-circle",
      parameters: { radius_mm: radius, center_mm: center, ...placement },
    });
  }

  if (profile.type === "center-rectangle") {
    // What the app's own rectangle sketch stores: a centre plus width and
    // height. FreeCAD wants the corners.
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
          [x - halfWidth, y + halfHeight],
        ],
        ...placement,
      },
    });
  }

  if (profile.type === "polygon") {
    const points = (profile.pointsMillimeters as [number, number][]) ?? [];
    if (points.length < 3) return "the polygon has fewer than three points";
    return soleRegion({
      id: feature.id,
      kind: "sketch-polygon",
      parameters: { points_mm: points, ...placement },
    });
  }

  if (profile.type === "drawing") {
    // A drawn sketch holds any number of contours. Each closed one is a region
    // the user can extrude on its own, so each becomes its own engine sketch
    // rather than the whole sketch being refused because it holds more than
    // one. Exact arc, ellipse and spline spans become native Sketcher geometry.
    const contours = (profile.contours as Record<string, unknown>[]) ?? [];
    const regions: ProfileRegion[] = [];
    const skipped: string[] = [];
    contours.forEach((contour, index) => {
      if (contour.construction) return;
      const blocked = blockedSketchGeometry(profile as unknown as SketchDrawing, index);
      const checks=pierceChecks.get(index);
      const fixed = {...(blocked.length ? { blocked_geometry: blocked } : {}),...(checks?{pierce_checks:checks}:{})};
      const contourId = typeof contour.id === "string" ? contour.id : undefined;
      const engineId = contours.length === 1 ? feature.id : `${feature.id}#${index}`;
      const label = `Region ${index + 1}`;
      if (contour.type === "circle") {
        const radius = Number(contour.radius);
        const center = (contour.center as [number, number]) ?? [0, 0];
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
            parameters: { radius_mm: radius, center_mm: center, ...placement, ...fixed },
          },
        });
        return;
      }
      const points = polygonFromStraightContour(contour);
      const segments = (contour.segments as Record<string, unknown>[]) ?? [];
      const start = contour.start as [number, number] | undefined;
      if (contour.type !== "path" || !start || !segments.length) return;
      const end = segments.at(-1)!.end as [number, number];
      const closed = Math.hypot(end[0] - start[0], end[1] - start[1]) < 1e-6;
      if (!segments.every(segment => ["line", "arc", "bezier", "ellipse", "conic"].includes(String(segment.type)))) {
        skipped.push(`${label} contains an unsupported curve`);
        return;
      }
      if (segments.some(segment => segment.type === "arc" && !Array.isArray(segment.middle))) {
        skipped.push(`${label} has an arc without its middle point`);
        return;
      }
      regions.push({
        engineId, contourId, contourIndex: index,
        label: points ? `${label} · ${points.length} sides` : `${label} · ${closed ? "curved" : "open path"}`,
        closed,
        feature: points && !blocked.length && !checks
          ? { id: engineId, kind: "sketch-polygon", parameters: { points_mm: points, ...placement } }
          : { id: engineId, kind: "sketch-wire", parameters: { start_mm: start, segments: nativeWireSegments(start, segments as unknown as SketchSegment[]), ...placement, ...fixed } },
      });
    });
    for (const boundary of sketchFaceRegions(profile as unknown as SketchDrawing)) {
      if (boundary.sourceContourIndices.length < 2) continue;
      const sources = boundary.sourceContourIndices.map(index => regions.find(region => region.contourIndex === index && !region.sourceContourIndices));
      if (sources.some(source => !source || source.closed !== false)) continue;
      const engineId = `${feature.id}#joined#${boundary.contourIndex}`;
      regions.push({ engineId, contourIndex: boundary.contourIndex,
        sourceContourIndices: boundary.sourceContourIndices, sourceContourIds: boundary.sourceContourIds,
        previewContour: boundary.contour, closed: true,
        label: `Region ${boundary.contourIndex + 1} · ${sources.length} connected curves`,
        feature: { id: engineId, kind: 'sketch-region', parameters: { profiles: sources.map(source => source!.engineId) } },
      });
    }
    if (!regions.length && skipped.length) return skipped[0];
    return { regions, skipped };
  }

  if (profile.type === "projection") return "projected sketches are not translated yet";
  return `a ${String(profile.type)} profile is not translated yet`;
}

/** Straight-line closed contour → polygon points, or null if it curves. */
function polygonFromStraightContour(
  contour: Record<string, unknown>,
): [number, number][] | null {
  if (contour.type !== "path") return null;
  const start = contour.start as [number, number] | undefined;
  const segments = (contour.segments as Record<string, unknown>[]) ?? [];
  if (!start || !segments.length) return null;
  if (!segments.every((segment) => segment.type === "line")) return null;
  const points: [number, number][] = [start];
  for (const segment of segments) {
    const end = segment.end as [number, number];
    points.push(end);
  }
  // A closed path repeats its start; the engine closes the polygon itself.
  const last = points[points.length - 1];
  if (Math.hypot(last[0] - start[0], last[1] - start[1]) >= 1e-6) return null;
  points.pop();
  return points.length >= 3 ? points : null;
}

export function translateDocument(document: PartDocument): Translation {
  const features: FreeCADFeature[] = [];
  const untranslated: Translation["untranslated"] = [];
  /** Regions each translated sketch offers, so a solid can name the one it wants. */
  const profileRegions = new Map<string, ProfileRegion[]>();
  /** Solid features that made it across, so a mirror can check its source. */
  const solids = new Set<string>();
  const paths = new Map<string, ProfileRegion[]>();
  let lastBody: string | undefined;
  const bodyParameters = (feature: PartFeature) => {
    const operation = "operation" in feature ? feature.operation : undefined;
    if(feature.type==="extrude"&&feature.scopeMode==="all")return {operation,scope_mode:"all"};
    if (operation === "new") {
      const bodyId = bodyIDForFeature(document, feature);
      lastBody = feature.type === "extrude" && feature.separateBodies && feature.bodyOutputs ? feature.bodyOutputs.at(-1) : bodyId;
      return { body_id: bodyId, operation };
    }
    const bodyId = "targetBodyId" in feature && feature.targetBodyId ? feature.targetBodyId : lastBody;
    return { body_id: bodyId, operation };
  };

  /** The region a solid feature should build on, or why it cannot be chosen. */
  const pickRegion = (
    profileFeatureId: string,
    contourId: string | undefined,
    curves = false,
    connected?: ProfileRegionReference,
  ): ProfileRegion | string => {
    const regions = (curves ? paths : profileRegions).get(profileFeatureId);
    if (connected) {
      if (curves) return 'Choose individual sketch curves for this operation.';
      return regions?.find(region => matchesProfileRegion({profileRegion: connected}, region))
        ?? 'The referenced curves no longer form the same closed region. Repair the sketch or reselect the region.';
    }
    if (!regions?.length) return "its sketch was not translated";
    if (contourId !== undefined) {
      const named = regions.find((region) => region.contourId === contourId);
      return named ?? "the region it was built on is no longer in its sketch";
    }
    // One region needs no choosing. Several do, and guessing would quietly
    // build the wrong one.
    if (regions.length > 1)
      return `its sketch has ${regions.length} regions — choose which one to use`;
    return regions[0];
  };
  const referenceErrors = featureReferenceErrors(document);
  const dependencies = featureDependencies(document);
  const rollback = document.rollbackIndex ?? document.features.length;

  document.features.slice(0, rollback).forEach((feature) => {
    if (feature.suppressed) return;
    const note = (reason: string) =>
      untranslated.push({ id: feature.id, name: feature.name, reason });

    const referenceError = referenceErrors.get(feature.id);
    if (referenceError) return note(referenceError);
    if (dependencies.get(feature.id)?.some(id => untranslated.some(item => item.id === id))) return note("A referenced feature could not be built. Repair it first.");
    if (feature.type === "profile" || feature.type === "sketch") {
      let mapped:ProfileTranslation|string;
      try {
        if(feature.type==='profile') {
          const drawing=resolveProfileDrawing(document.features,feature.id);
          const pierce=nativePierceChecks(document.features,feature,drawing);
          mapped=profileFeature({...feature,profile:drawing},pierce.checks);
          if(typeof mapped!=='string') {
            features.push(...pierce.sources);
            for(const [index,target] of pierce.targets)if(!mapped.regions.some(r=>r.contourIndex===index))features.push(target);
          }
        } else mapped=profileFeature(feature);
      } catch(error) {return note((error as Error).message);}
      if (typeof mapped === "string") return note(mapped);
      mapped.regions.forEach((region) => features.push(region.feature));
      profileRegions.set(feature.id, mapped.regions.filter(region => region.closed !== false));
      paths.set(feature.id, mapped.regions.filter(region => !region.sourceContourIndices));
      // A sketch that half-translated has to say which part of it did not.
      mapped.skipped.forEach(note);
      return;
    }
    if (feature.type === "import-step" || feature.type === "import-cad") {
      features.push({ id: feature.id, kind: feature.type, parameters: {
        ...bodyParameters(feature), data_base64: feature.dataBase64,
        ...(feature.type === "import-cad" ? {format:feature.format,mesh_mode:feature.meshMode,mesh_units:feature.meshUnits} : {}),
      }});
      if (feature.type === "import-step" || feature.meshMode !== "reference") solids.add(feature.id);
      return;
    }
    if (feature.type === "plane") return;
    if (feature.type === "extrude") {
      const extrude = feature as {
        id: string;
        profileFeatureId: string;
        profileContourId?: string;
        distanceMillimeters: number;
        reversed?: boolean;
        operation: "new" | "add" | "cut" | "intersect";
      };
      const selectionGroups = new Map<string, ProfileRegion[]>();
      for (const selection of feature.profileSelections ?? []) {
        const r = pickRegion(selection.profileFeatureId, selection.profileContourId, !!feature.thin, selection.profileRegion);
        if (typeof r === "string") return note(r);
        const group = selectionGroups.get(selection.profileFeatureId) ?? [];
        group.push(r); selectionGroups.set(selection.profileFeatureId, group);
      }
      const picked = feature.profileContourIds?.map(id => pickRegion(extrude.profileFeatureId, id, !!feature.thin));
      if (picked?.some(region => typeof region === "string")) return note("A selected region is no longer in its sketch.");
      const region = selectionGroups.values().next().value?.[0] ?? picked?.[0] ?? pickRegion(extrude.profileFeatureId, extrude.profileContourId, !!feature.thin, feature.profileRegion);
      if (typeof region === "string") return note(region);
      if (!(extrude.distanceMillimeters > 0))
        return note("the extrude distance is not positive");
      // "new" and "add" both add material; FreeCAD's Body fuses them in order.
      // "cut" removes it, which is a Pocket.
      const secondEnd = feature.secondEnd;
      let directionReference, pointReference, oppositePointReference, startingReference;
      try {
        if(feature.startingReference)startingReference=nativeExtrusionStart(document,feature.startingReference,feature.id);
        if(feature.endType==='up-to-vertex'&&feature.endPointReference)pointReference=nativeExtrusionPoint(document,feature.endPointReference,feature.id);
        if(secondEnd?.endType==='up-to-vertex'&&secondEnd.endPointReference)oppositePointReference=nativeExtrusionPoint(document,secondEnd.endPointReference,feature.id);
        if (feature.directionReference) directionReference = nativeSketchDirection(document, feature.directionReference, feature.id); }
      catch (error) { return note((error as Error).message); }
      const sources = feature.thin ? paths : profileRegions;
      const thin = feature.thin ? {thin:{thickness_1_mm:feature.thin.thickness1Millimeters,thickness_2_mm:feature.thin.thickness2Millimeters,midplane:feature.thin.midplane??false,midplane_thickness_mm:feature.thin.midplaneThicknessMillimeters,flipped:feature.thin.flipped??false}} : {};
      const body = { ...bodyParameters(feature), ...thin, ...(startingReference?{starting_reference:startingReference}:{}), ...(pointReference?{end_point_reference:pointReference}:{}), ...(directionReference ? {direction_reference:directionReference}:{}), ...(feature.directionVector ? {direction_vector:feature.directionVector}:{}), ...(secondEnd ? {second_end:{...(oppositePointReference?{end_point_reference:oppositePointReference}:{}),end_type:secondEnd.endType, distance_mm:secondEnd.distanceMillimeters, end_offset_mm:secondEnd.endOffsetMillimeters ?? 0, draft_angle_deg:secondEnd.draftAngleDegrees ?? 0, ...(secondEnd.endType === "up-to-part" ? {end_part_id:secondEnd.endPartId}:{}), ...(secondEnd.endType === "up-to-face" ? {end_reference:secondEnd.endReference}: {})}} : {}), ...(feature.targetBodyIds ? {target_body_ids:feature.targetBodyIds}:{}), end_type: feature.endType ?? "blind", ...(feature.endType === "up-to-part" ? {end_part_id:feature.endPartId}:{}), ...(feature.endType === "up-to-face" ? {end_reference:feature.endReference}:{}), starting_offset_mm: feature.startingOffsetMillimeters ?? 0, end_offset_mm: feature.endOffsetMillimeters ?? 0, second_distance_mm: feature.secondDistanceMillimeters, draft_angle_deg: feature.draftAngleDegrees ?? 0, ...((feature.profileRegion || feature.scopeMode || feature.startingReference || feature.thin || feature.directionReference || feature.directionVector || feature.secondEnd || feature.draftAngleDegrees || feature.targetBodyIds || feature.operation === "intersect" || feature.profileSelections || feature.separateBodies || feature.regionMode === "faces" || feature.endType || feature.startingOffsetMillimeters || feature.secondDistanceMillimeters) ? {
        region_mode: true,
        ...(feature.profileSelections ? { profile_groups: [...selectionGroups].map(([sourceId, choices]) => ({profiles: choices.map(r => r.engineId), profile_regions: sources.get(sourceId)!.map(r=>r.engineId), profile_keys: Object.fromEntries(sources.get(sourceId)!.map(r=>[r.engineId,sourceId===feature.profileFeatureId ? regionKey(r, sourceId) : `${sourceId}:${regionKey(r, sourceId)}`]))})) } : {}),
        separate_bodies: feature.separateBodies === true && feature.operation === "new",
        profile_keys: Object.fromEntries(sources.get(extrude.profileFeatureId)!.map(r => [r.engineId, regionKey(r, extrude.profileFeatureId)])),
        profiles: (picked as ProfileRegion[] | undefined ?? [region]).map(r => r.engineId),
        profile_regions: feature.regionMode === "faces" ? sources.get(extrude.profileFeatureId)!.map(r => r.engineId) : [region.engineId],
      } : {}) };
      features.push(
        extrude.operation === "cut"
          ? {
              id: feature.id,
              kind: "pocket",
              parameters: {
                ...body,
                reversed: extrude.reversed ?? false,
                profile: region.engineId,
                depth_mm: extrude.distanceMillimeters,
              },
            }
          : {
              id: feature.id,
              kind: "pad",
              parameters: {
                ...body,
                reversed: extrude.reversed ?? false,
                profile: region.engineId,
                distance_mm: extrude.distanceMillimeters,
              },
            },
      );
      solids.add(feature.id);
      if(feature.scopeMode==="all")lastBody=feature.scopeResolution?.groups.at(-1)?.bodyId??lastBody;
      if (feature.operation === "add" && (feature.targetBodyIds?.length ?? 0) > 1) lastBody = feature.targetBodyId;
      return;
    }
    if (feature.type === "revolve") {
      const revolve = feature as {
        profileFeatureId: string;
        profileContourId?: string;
        axis: "X" | "Y" | "Z";
        angleDegrees: number;
        operation: "new" | "add" | "cut";
      };
      const spun = pickRegion(revolve.profileFeatureId, revolve.profileContourId, false, feature.profileRegion);
      if (typeof spun === "string") return note(spun);
      if (!(revolve.angleDegrees > 0 && revolve.angleDegrees <= 360))
        return note("the revolve angle is not between 0 and 360 degrees");
      // "new" and "add" both add material, as with extrude; "cut" is a Groove.
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
          cut: revolve.operation === "cut",
        },
      });
      solids.add(feature.id);
      return;
    }
    if (feature.type === "mirror") {
      const mirror = feature as {
        sourceFeatureId: string;
        plane: SketchPlane;
        offsetMillimeters: number;
        operation: "add" | "cut";
      };
      if (!solids.has(mirror.sourceFeatureId))
        return note("the feature it mirrors was not translated");
      // FreeCAD's Mirrored repeats the source feature, so it inherits whether
      // that feature added or cut. Mirroring an additive feature as a cut is a
      // different operation, and saying so beats quietly adding material.
      if (mirror.operation !== "add")
        return note("a mirror that cuts is not translated yet");
      features.push({
        id: feature.id,
        kind: "mirror",
        parameters: {
          ...bodyParameters(feature),
          source: mirror.sourceFeatureId,
          plane: planeName(mirror.plane),
          offset_mm: mirror.offsetMillimeters,
        },
      });
      solids.add(feature.id);
      return;
    }
    if (feature.type === "fillet" || feature.type === "chamfer") {
      const finish = feature as {
        radiusMillimeters: number;
        edgePlane?: { plane: SketchPlane; offsetMillimeters: number };
      };
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
          ...(finish.edgePlane
            ? {
                plane: planeName(finish.edgePlane.plane),
                offset_mm: finish.edgePlane.offsetMillimeters,
              }
            : {}),
        },
      });
      return;
    }
    if (feature.type === "sweep") {
      const sweep = feature;
      const profile = pickRegion(sweep.profileFeatureId, sweep.profileContourId, false, sweep.profileRegion);
      if (typeof profile === "string") return note(profile);
      const path = paths.get(sweep.pathFeatureId);
      const chosenPath = sweep.pathContourId ? path?.find(region => region.contourId === sweep.pathContourId) : path?.length === 1 ? path[0] : undefined;
      if (!chosenPath) return note("Choose one sweep path contour.");
      features.push({
        id: feature.id,
        kind: "sweep",
        parameters: {
          ...bodyParameters(feature),
          profile: profile.engineId,
          path: chosenPath.engineId,
          cut: sweep.operation === "cut",
        },
      });
      return;
    }
    if (feature.type === "boolean") {
      features.push({id:feature.id,kind:"boolean",parameters:{
        body_id:feature.targetBodyId, boolean_operation:feature.operation,
        tool_body_ids:[...feature.toolBodyIds], keep_tools:feature.keepTools,
      }});
      if (!feature.keepTools) lastBody = feature.targetBodyId;
      solids.add(feature.id);
      return;
    }
    if (feature.type === "pattern") {
      if (!solids.has(feature.sourceFeatureId)) return note("The source feature could not be built.");
      features.push({id: feature.id, kind: "pattern", parameters: {
        ...bodyParameters(feature), source: feature.sourceFeatureId, pattern_type: feature.patternType,
        axis: feature.axis, count: feature.count, reversed: feature.reversed,
        ...(feature.patternType === "linear" ? {spacing_mm: feature.spacingMillimeters} : {angle_deg: feature.angleDegrees}),
      }});
      solids.add(feature.id);
      return;
    }
    if (feature.type === "draft") {
      features.push({id: feature.id, kind: "draft", parameters: {
        ...bodyParameters(feature), angle_deg: feature.angleDegrees, reversed: feature.reversed,
        face_plane: feature.facePlane.plane, face_offset_mm: feature.facePlane.offsetMillimeters,
        neutral_plane: feature.neutralPlane.plane, neutral_offset_mm: feature.neutralPlane.offsetMillimeters,
      }});
      solids.add(feature.id);
      return;
    }
    if (feature.type === "loft") {
      const sections = feature.sections.map(section => pickRegion(section.profileFeatureId, section.profileContourId, false, section.profileRegion));
      const invalid = sections.find(section => typeof section === "string");
      if (typeof invalid === "string") return note(invalid);
      if (sections.length < 2) return note("Choose at least two loft sections.");
      features.push({id: feature.id, kind: "loft", parameters: {
        ...bodyParameters(feature), sections: (sections as ProfileRegion[]).map(section => section.engineId), ruled: feature.ruled,
      }});
      solids.add(feature.id);
      return;
    }
    if (feature.type === "hole") {
      const region = pickRegion(feature.profileFeatureId, feature.profileContourId);
      if (typeof region === "string") return note(region);
      if (region.feature.kind !== "sketch-circle") return note("Choose a circular sketch region for the hole center.");
      features.push({id: feature.id, kind: "hole", parameters: {
        ...bodyParameters(feature), operation: "cut", profile: region.engineId,
        diameter_mm: feature.diameterMillimeters, depth_mm: feature.depthMillimeters,
        depth_type: feature.depthType, cut_type: feature.cutType,
        counter_diameter_mm: feature.counterDiameterMillimeters,
        counter_depth_mm: feature.counterDepthMillimeters,
        countersink_angle_deg: feature.countersinkAngleDegrees,
        reversed: feature.reversed ?? false,
      }});
      solids.add(feature.id);
      return;
    }
    if (feature.type === "transform") {
      let transform;try{transform=nativePartTransform(document,feature.transform,feature.id);}catch(error){return note((error as Error).message);}
      features.push({id:feature.id,kind:'transform',parameters:{body_ids:feature.bodyIds,transform,...(feature.copyBodyIds?{copy_body_ids:feature.copyBodyIds}:{})}});
      if(feature.copyBodyIds)lastBody=feature.copyBodyIds[feature.bodyIds.at(-1)!];
      solids.add(feature.id);return;
    }
    if (feature.type === "offset-face") {
      let motion;try{motion=feature.transform?{transform:nativePartTransform(document,feature.transform,feature.id)}:{distance_mm:feature.distanceMillimeters};}catch(error){return note((error as Error).message);}
      features.push({id:feature.id,kind:"offset-face",parameters:{faces:feature.faces,...motion}});
      solids.add(feature.id);
      return;
    }
    if (feature.type === "face-extrude") {
      features.push({id:feature.id,kind:"face-extrude",parameters:{...bodyParameters(feature),operation:feature.distanceMillimeters>0?"add":"cut",source_feature_id:feature.sourceFeatureId,normal:feature.normal,...(feature.faceAnchor?{face_anchor:feature.faceAnchor}:{}),distance_mm:feature.distanceMillimeters}});
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
          ...(shell.removedFaces && shell.removedFaces.length > 0
            ? {
                removed_plane: planeName(shell.removedFaces[0].plane),
                removed_offset_mm: shell.removedFaces[0].offsetMillimeters,
              }
            : {}),
        },
      });
      return;
    }
    note(`Unsupported feature type ${(feature as { type: string }).type}.`);
  });

  return { features, untranslated, complete: untranslated.length === 0 };
}
