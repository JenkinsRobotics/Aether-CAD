/** Structural Frame editors (`framing-frame`, `framing-trim`, `framing-end-cap`):
 *  sweeps standard EN/ISO structural profiles along sketch or 3D curve paths with miter/butt
 *  corner trimming, weld gaps, and welded end caps. */
import { availableBodies, FRAME_PROFILE_LIBRARY } from "@aether/core/document";
import { rowIn, unitSuffix, type Controls, type FeatureEditor, type FeatureEditorContext } from "./shared";
import { bodiesControls, bodiesLayout } from "./surface";

const PROFILE_IDS = FRAME_PROFILE_LIBRARY.map((p) => p.id);

export const frameMemberEditor: FeatureEditor = {
  type: "frame-member",
  controls({ field, reference, feature }: FeatureEditorContext): Controls {
    return {
      pathFeatureId: reference("Path sketch or 3D curve", ["profile", "curve3d"], feature?.pathFeatureId),
      profileId: field("Standard profile", feature?.profileId ?? PROFILE_IDS[2], PROFILE_IDS),
      trimMode: field("Corner trim", feature?.trimMode ?? "miter", ["none", "miter", "butt"]),
      rotationDegrees: field("Profile rotation (degrees)", String(feature?.rotationDegrees ?? 0)),
      offsetXMillimeters: field("Offset X (mm)", String(feature?.offsetXMillimeters ?? 0)),
      offsetYMillimeters: field("Offset Y (mm)", String(feature?.offsetYMillimeters ?? 0)),
      weldGapMillimeters: field("Weld gap (mm)", String(feature?.weldGapMillimeters ?? 0)),
    };
  },
  layout(context, controls) {
    const { win, form, lengthUnitLabel, angleUnitLabel } = context;
    const row = (label: string, control: Controls[string], unit?: string) => {
      control.closest("label")?.remove();
      control.setAttribute("form", form.id);
      win.body.append(unit ? rowIn(label, control, unitSuffix(unit)) : rowIn(label, control));
    };
    row("Path", controls.pathFeatureId);
    row("Profile", controls.profileId);
    row("Corner trim", controls.trimMode);
    row("Rotation", controls.rotationDegrees, angleUnitLabel);
    row("Offset X", controls.offsetXMillimeters, lengthUnitLabel);
    row("Offset Y", controls.offsetYMillimeters, lengthUnitLabel);
    row("Weld gap", controls.weldGapMillimeters, lengthUnitLabel);
  },
  validate(controls) {
    if (!controls.pathFeatureId.value) return "Choose a sketch or 3D curve path for the frame.";
    if (!PROFILE_IDS.includes(controls.profileId.value)) return "Choose a valid structural profile.";
    const gap = Number(controls.weldGapMillimeters.value);
    if (!Number.isFinite(gap) || gap < 0 || gap > 50) return "Weld gap must be between 0 and 50 mm.";
    return null;
  },
  serialize(values) {
    const rot = Number(values.rotationDegrees);
    const ox = Number(values.offsetXMillimeters);
    const oy = Number(values.offsetYMillimeters);
    const gap = Number(values.weldGapMillimeters);
    return {
      operation: "new",
      pathFeatureId: values.pathFeatureId,
      profileId: values.profileId,
      trimMode: values.trimMode,
      ...(Number.isFinite(rot) && Math.abs(rot) > 1e-9 ? { rotationDegrees: rot } : {}),
      ...(Number.isFinite(ox) && Math.abs(ox) > 1e-9 ? { offsetXMillimeters: ox } : {}),
      ...(Number.isFinite(oy) && Math.abs(oy) > 1e-9 ? { offsetYMillimeters: oy } : {}),
      ...(Number.isFinite(gap) && gap > 0 ? { weldGapMillimeters: gap } : {}),
    };
  },
};

export const frameEndCapEditor: FeatureEditor = {
  type: "frame-end-cap",
  controls({ field, reference, feature }: FeatureEditorContext): Controls {
    return {
      frameFeatureId: reference("Frame member", ["frame-member"], feature?.frameFeatureId),
      end: field("Member ends", feature?.end ?? "both", ["both", "start", "end"]),
      thicknessMillimeters: field("Cap thickness (mm)", String(feature?.thicknessMillimeters ?? 3)),
      insetMillimeters: field("Inset (mm)", String(feature?.insetMillimeters ?? 0)),
      operation: field("Operation", feature?.operation ?? "add", ["add", "new"]),
    };
  },
  layout(context, controls) {
    const { win, form, lengthUnitLabel } = context;
    const row = (label: string, control: Controls[string], unit?: string) => {
      control.closest("label")?.remove();
      control.setAttribute("form", form.id);
      win.body.append(unit ? rowIn(label, control, unitSuffix(unit)) : rowIn(label, control));
    };
    row("Frame member", controls.frameFeatureId);
    row("Ends", controls.end);
    row("Thickness", controls.thicknessMillimeters, lengthUnitLabel);
    row("Inset", controls.insetMillimeters, lengthUnitLabel);
    row("Operation", controls.operation);
  },
  validate(controls) {
    if (!controls.frameFeatureId.value) return "Choose an earlier Frame member feature.";
    if (!(Number(controls.thicknessMillimeters.value) > 0)) return "End cap thickness must be positive.";
    const inset = Number(controls.insetMillimeters.value);
    if (!Number.isFinite(inset) || inset < 0) return "Inset must be zero or positive.";
    return null;
  },
  serialize(values) {
    const inset = Number(values.insetMillimeters);
    return {
      frameFeatureId: values.frameFeatureId,
      end: values.end,
      thicknessMillimeters: Number(values.thicknessMillimeters),
      operation: values.operation,
      ...(Number.isFinite(inset) && inset > 0 ? { insetMillimeters: inset } : {}),
    };
  },
};

export const frameTrimEditor: FeatureEditor = {
  type: "frame-trim",
  controls(context: FeatureEditorContext): Controls {
    const { field, feature, doc } = context;
    const end = feature ? doc.features.findIndex((f) => f.id === feature.id) : doc.rollbackIndex ?? doc.features.length;
    const allBodies = availableBodies({ ...doc, features: doc.features.slice(0, end), rollbackIndex: undefined });
    const toolBody = field("Trimming body", feature?.toolBodyId ?? "", ["", ...allBodies.map((b) => b.id)]);
    Array.from((toolBody as HTMLSelectElement).options).forEach((o) => {
      o.textContent = o.value ? (allBodies.find((b) => b.id === o.value)?.name ?? o.value) : "Auto (mutual miter)";
    });
    return {
      ...bodiesControls(context, "targetBodyIds"),
      mode: field("Trim mode", feature?.mode ?? "cope", ["cope", "butt", "miter"]),
      toolBody,
      weldGap: field("Weld gap (mm)", String(feature?.weldGapMillimeters ?? 0)),
    };
  },
  layout(context, controls) {
    bodiesLayout(context, controls, "Target member bodies");
  },
  validate(controls) {
    const ids: string[] = JSON.parse(controls.bodies.value || "[]");
    if (!ids.length) return "Choose at least one frame member body to trim.";
    if (!controls.toolBody.value && !(controls.mode.value === "miter" && ids.length >= 2)) {
      return "Choose a trimming body, or pick two bodies for mutual miter.";
    }
    const gap = Number(controls.weldGap.value);
    if (!Number.isFinite(gap) || gap < 0) return "Weld gap must be zero or positive.";
    return null;
  },
  serialize(values) {
    const gap = Number(values.weldGap);
    return {
      targetBodyIds: JSON.parse(values.bodies),
      mode: values.mode,
      ...(values.toolBody ? { toolBodyId: values.toolBody } : {}),
      ...(Number.isFinite(gap) && gap > 0 ? { weldGapMillimeters: gap } : {}),
    };
  },
};

export const frameGussetEditor: FeatureEditor = {
  type: "frame-gusset",
  controls({ field, feature }: FeatureEditorContext): Controls {
    return {
      origin: field("Corner origin (x,y,z mm)", (feature?.originMillimeters ?? [0, 0, 0]).join(",")),
      axisA: field("Leg A direction (x,y,z)", (feature?.axisA ?? [1, 0, 0]).join(",")),
      axisB: field("Leg B direction (x,y,z)", (feature?.axisB ?? [0, 1, 0]).join(",")),
      legA: field("Leg A (mm)", String(feature?.legAMillimeters ?? 40)),
      legB: field("Leg B (mm)", String(feature?.legBMillimeters ?? 40)),
      thickness: field("Thickness (mm)", String(feature?.thicknessMillimeters ?? 5)),
      chamfer: field("Corner weld chamfer (mm)", String(feature?.chamferMillimeters ?? 0)),
      shape: field("Profile", feature?.shape ?? "triangle", ["triangle", "polygon"]),
      operation: field("Operation", feature?.operation ?? "new", ["new", "add"]),
    };
  },
  validate(controls) {
    const vec3 = (raw: string) => raw.split(",").map((s) => Number(s.trim()));
    for (const [k, label] of [["origin", "Origin"], ["axisA", "Axis A"], ["axisB", "Axis B"]] as const) {
      const v = vec3(controls[k].value);
      if (v.length !== 3 || v.some((n) => !Number.isFinite(n))) return `${label} must be x,y,z.`;
    }
    if (!(Number(controls.legA.value) > 0) || !(Number(controls.legB.value) > 0) || !(Number(controls.thickness.value) > 0)) {
      return "Legs and thickness must be positive.";
    }
    const ch = Number(controls.chamfer.value);
    if (!Number.isFinite(ch) || ch < 0) return "Corner chamfer must be zero or positive.";
    return null;
  },
  serialize(values) {
    const vec3 = (raw: string) => raw.split(",").map((s) => Number(s.trim()));
    const ch = Number(values.chamfer);
    return {
      operation: values.operation,
      originMillimeters: vec3(values.origin),
      axisA: vec3(values.axisA),
      axisB: vec3(values.axisB),
      legAMillimeters: Number(values.legA),
      legBMillimeters: Number(values.legB),
      thicknessMillimeters: Number(values.thickness),
      shape: values.shape,
      ...(Number.isFinite(ch) && ch > 0 ? { chamferMillimeters: ch } : {}),
    };
  },
};
