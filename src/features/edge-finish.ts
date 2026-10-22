/** Fillet and chamfer share one editor: both are edge finishes differing only
 *  in name and in how Core evaluates them. One definition, two registrations —
 *  a second file would be the same lines with a different string.
 *
 *  Edges come three ways: every edge, every edge in a plane (the saved-document
 *  form), or the edges picked in the viewport (SolidCraft's `edges: [...]`). */
import type { EdgeFinishEdge } from "@aether/core/document";
import { faceIdentity, mountPickedReferences } from "./picked-references";
import type { SolidFaceReference } from "@aether/core/document";
import type { Controls, FeatureEditor, FeatureEditorContext } from "./shared";

const identity = (edge: EdgeFinishEdge) => JSON.stringify(edge.kind === "solid-edge" ? [edge.bodyId, edge.anchor.start.signature, edge.anchor.end.signature] : [edge.bodyId, edge.midpointMillimeters, edge.lengthMillimeters]);

const edgeFinishEditor = (type: "fillet" | "chamfer"): FeatureEditor => ({
  type,

  controls({ field, feature }: FeatureEditorContext): Controls {
    return {
      radius: field("All-edge size (mm)", String(feature?.radiusMillimeters ?? 0.5)),
      // Fillet: a second size makes it variable along the edge. Chamfer: a second
      // distance or an angle makes it asymmetric (the first leg on the face facing up).
      ...(type === "fillet"
        ? { endRadius: field("End size (mm, variable fillet)", feature?.endRadiusMillimeters === undefined ? "" : String(feature.endRadiusMillimeters)) }
        : { secondDistance: field("Second distance (mm)", feature?.secondDistanceMillimeters === undefined ? "" : String(feature.secondDistanceMillimeters)),
            angle: field("Angle (degrees)", feature?.angleDegrees === undefined ? "" : String(feature.angleDegrees)),
            referenceFace: field("Reference face", JSON.stringify(feature?.referenceFace ? [feature.referenceFace] : [])) }),
      edgeScope: field("Edges", feature?.edges ? "picked" : feature?.edgePlane ? "plane" : "all", ["all", "plane", "picked"]),
      edgePlane: field("Edge plane", feature?.edgePlane?.plane ?? "XY", ["XY", "XZ", "YZ"]),
      edgeOffset: field(
        "Edge plane offset (mm)",
        String(feature?.edgePlane?.offsetMillimeters ?? 0),
      ),
      edges: field("Picked edges", JSON.stringify(feature?.edges ?? [])),
      tangentChain: field("Follow tangent chains", feature?.tangentChain ? "yes" : "no", ["no", "yes"]),
    };
  },

  layout(context, controls) {
    if (type === "chamfer") {
      const faces = mountPickedReferences<SolidFaceReference>(context, controls.referenceFace, {
        title: "Reference face (optional)", kind: "face", requestEvent: "aether-offset-faces-request", replyEvent: "aether-offset-faces", replyKey: "faces", identity: faceIdentity,
        note: "The face the first distance lies on, for a second distance or an angle. Default: the adjacent face facing up most.",
        onChange: (picked) => { if (picked.length > 1) faces.update([picked[picked.length - 1]]); },
      });
    }
    mountPickedReferences<EdgeFinishEdge>(context, controls.edges, {
      title: "Edges to finish", kind: "edge", requestEvent: "aether-finish-edges-request", replyEvent: "aether-finish-edges", replyKey: "edges", identity,
      note: "Pick edges in the viewport, or leave the list empty to finish every edge or every edge in a plane.",
      onChange: (edges) => { if (edges.length) { controls.edgeScope.value = "picked"; controls.edgeScope.dispatchEvent(new Event("change")); } },
    });
  },

  validate(controls) {
    if (controls.edgeScope.value === "picked" && !JSON.parse(controls.edges.value).length) return "Pick at least one edge, or choose All edges.";
    if (type === "chamfer" && controls.secondDistance.value.trim() && controls.angle.value.trim()) return "Give a second distance or an angle, not both.";
    return null;
  },

  serialize(values) {
    const optional = (value: string | undefined) => value?.trim() ? Number(value) : undefined;
    return {
      radiusMillimeters: Number(values.radius),
      ...(type === "fillet"
        ? (optional(values.endRadius) !== undefined ? { endRadiusMillimeters: optional(values.endRadius) } : {})
        : { ...(optional(values.secondDistance) !== undefined ? { secondDistanceMillimeters: optional(values.secondDistance) } : {}),
            ...(optional(values.angle) !== undefined ? { angleDegrees: optional(values.angle) } : {}),
            ...((() => { const f = JSON.parse(values.referenceFace || "[]")[0]; if (!f) return {}; delete f.centerMillimeters; return { referenceFace: f }; })()) }),
      // Scoping is optional; "all" leaves both fields off so the stored feature
      // stays the shape Core validates.
      ...(values.edgeScope === "plane"
        ? { edgePlane: { plane: values.edgePlane, offsetMillimeters: Number(values.edgeOffset) } }
        : values.edgeScope === "picked" ? { edges: JSON.parse(values.edges), ...(values.tangentChain === "yes" ? { tangentChain: true } : {}) } : {}),
    };
  },
});

export const filletEditor = edgeFinishEditor("fillet");
export const chamferEditor = edgeFinishEditor("chamfer");
