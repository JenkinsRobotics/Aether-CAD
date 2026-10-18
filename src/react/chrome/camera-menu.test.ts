import { expect, it, vi } from "vitest";
import { cameraMenuItems,selectCameraMenuItem } from "./camera-menu";
import { cadAppearance,defaultCADAppearance } from "../../cad-appearance-store";
import { cadCameraPresentation } from "../../cad-camera-presentation-store";
import { cadPresentation } from "../../cad-presentation-store";

it("offers Home with three viewpoints and reflects graphics state and section availability",()=>{
  const items=cameraMenuItems(defaultCADAppearance,false);
  expect(items.slice(0,4).map(i=>i.label)).toEqual(["Home","Isometric","Dimetric","Trimetric"]);
  expect(items.find(i=>i.id==="display")!.children!.find(i=>i.checked)?.id).toBe("display:shaded-edges");
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
