import type { ReactNode } from "react";
import { AetherIcon } from "@aether/ui";
import type { SketchPlane } from "./part-document";

export type ReferenceGeometryId = "origin" | "axes" | "top-plane" | "front-plane" | "right-plane";

export interface ReferenceGeometryDefinition {
  id: ReferenceGeometryId;
  label: string;
  icon: ReactNode;
  /** Listed but not toggleable yet (awaiting the camera/display tool). */
  unavailableReason?: string;
}

export const referenceGeometry: readonly ReferenceGeometryDefinition[] = [
  { id: "origin", label: "Origin", icon: <AetherIcon name="concentric" /> },
  {
    id: "axes",
    label: "Axes",
    icon: <AetherIcon name="plus" />,
    unavailableReason: "Axis display moves to the camera and display tool.",
  },
  { id: "top-plane", label: "Top Plane", icon: <AetherIcon name="rectangle" /> },
  { id: "front-plane", label: "Front Plane", icon: <AetherIcon name="cube" /> },
  { id: "right-plane", label: "Right Plane", icon: <AetherIcon name="rectangle-portrait" /> },
] as const;

export function sketchPlaneForReference(
  id: ReferenceGeometryId,
): SketchPlane | null {
  if (id === "top-plane") return "XY";
  if (id === "front-plane") return "XZ";
  if (id === "right-plane") return "YZ";
  return null;
}

/** Reference-geometry show/hide is a workspace preference that must survive a
 * reload. Unknown ids and non-boolean values are dropped rather than trusted —
 * stored JSON is user-editable and may predate an id change. */
export function parseReferenceVisibility(
  value: string | null,
): Partial<Record<ReferenceGeometryId, boolean>> {
  const known = new Set(referenceGeometry.map((item) => item.id));
  try {
    const parsed: unknown = JSON.parse(value ?? "null");
    if (!parsed || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed as Record<string, unknown>).filter(
        ([id, shown]) => known.has(id as ReferenceGeometryId) && typeof shown === "boolean",
      ),
    );
  } catch {
    return {};
  }
}
