import { expect, it, vi } from "vitest";
import { cameraMenuItems,selectCameraMenuItem } from "./camera-menu";
import { cadAppearance,defaultCADAppearance } from "../../cad-appearance-store";
import { cadCameraPresentation } from "../../cad-camera-presentation-store";
import { cadPresentation } from "../../cad-presentation-store";

it("offers Home with three viewpoints and reflects graphics state and section availability",()=>{
  const items=cameraMenuItems(defaultCADAppearance,false);
  expect(items.slice(0,4).map(i=>i.label)).toEqual(["Home","Isometric","Dimetric","Trimetric"]);
  expect(items.find(i=>i.id==="display")!.children!.find(i=>i.checked)?.id).toBe("display:shaded");
  expect(items.find(i=>i.id==="section")!.disabled).toBe(true);
  expect(cameraMenuItems(defaultCADAppearance,true).find(i=>i.id==="section")!.disabled).toBe(false);
});
it("routes Home/view/fit actions and real graphics controls to their owners",()=>{
  const camera=vi.fn(),presentation=vi.fn();
  const release=cadCameraPresentation.registerActionHandler(camera),unlisten=cadPresentation.registerActionHandler(presentation);
  const before=cadAppearance.snapshot();
  try {
    for(const id of ["home","dimetric","trimetric","zoom-to-fit"])selectCameraMenuItem(id);
    expect(camera.mock.calls.map(c=>c[0])).toEqual([{type:"fit-isometric"},{type:"select-view",view:"dimetric"},{type:"select-view",view:"trimetric"},{type:"zoom-to-fit"}]);
    selectCameraMenuItem("graphics");expect(presentation).toHaveBeenCalledWith({type:"show-start-dialog",dialog:"graphics-preferences"});
    selectCameraMenuItem("display:wireframe");expect(cadAppearance.snapshot().displayStyle).toBe("wireframe");
    selectCameraMenuItem("ground:grid");expect(cadAppearance.snapshot().floorMode).toBe("grid");
  } finally {release();unlisten();cadAppearance.dispatch({type:"set-display-style",style:before.displayStyle});cadAppearance.dispatch({type:"set-floor-mode",mode:before.floorMode});}
});
it("reflects the actual projection and routes both camera modes without changing geometry",()=>{
  const items=cameraMenuItems(defaultCADAppearance,false,"orthographic");
  expect(items.find(item=>item.id==="projection:orthographic")?.checked).toBe(true);
  expect(items.find(item=>item.id==="projection:perspective")?.checked).toBe(false);
  const handle=vi.fn(),release=cadCameraPresentation.registerActionHandler(handle);
  try {
    selectCameraMenuItem("projection:perspective");selectCameraMenuItem("projection:orthographic");
    expect(handle.mock.calls.map(call=>call[0])).toEqual([{type:"set-projection",projection:"perspective"},{type:"set-projection",projection:"orthographic"}]);
  } finally {release();}
});

it("labels every display style the appearance store accepts, so a new style cannot blank the shell", async () => {
  const { cameraMenuItems } = await import("./camera-menu");
  const { cadAppearance } = await import("../../cad-appearance-store");
  const base = cadAppearance.snapshot();
  for (const style of ["shaded", "shaded-edges", "wireframe", "hidden-line", "ghost", "zebra", "draft-analysis"] as const) {
    const display = cameraMenuItems({ ...base, displayStyle: style }, true).find((item) => item.id === "display")!;
    expect(display.label).not.toBe("Display");
    expect(display.children?.some((child) => child.id === `display:${style}` && child.checked)).toBe(true);
  }
});
