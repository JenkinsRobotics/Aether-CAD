import type { MenuItem } from "@aether/ui";
import { cadCameraPresentation } from "../../cad-camera-presentation-store";
import { cadPresentation } from "../../cad-presentation-store";

const views = ["isometric", "dimetric", "trimetric"] as const;

export function cameraMenuItems(projection: "perspective" | "orthographic" = "perspective"): MenuItem[] {
  return [
    { id: "home", label: "Home" },
    ...views.map(view => ({ id: view, label: view[0].toUpperCase() + view.slice(1) })),
    { id: "zoom-to-fit", label: "Zoom to fit" },
    { id: "projection:perspective", label: "Perspective", kind: "radio", checked: projection === "perspective", separatorBefore: true },
    { id: "projection:orthographic", label: "Orthographic", kind: "radio", checked: projection === "orthographic" },
    { id: "graphics", label: "Graphics preferences…", separatorBefore: true },
  ];
}

export function selectCameraMenuItem(id: string): void {
  if (id === "home") { cadCameraPresentation.dispatch({ type: "fit-isometric" }); return; }
  if (id === "projection:perspective" || id === "projection:orthographic") {
    cadCameraPresentation.dispatch({ type: "set-projection", projection: id === "projection:perspective" ? "perspective" : "orthographic" }); return;
  }
  const view = views.find(view => view === id);
  if (view) { cadCameraPresentation.dispatch({ type: "select-view", view }); return; }
  if (id === "zoom-to-fit") { cadCameraPresentation.dispatch({ type: "zoom-to-fit" }); return; }
  if (id === "graphics") cadPresentation.dispatch({ type: "show-start-dialog", dialog: "graphics-preferences" });
}
