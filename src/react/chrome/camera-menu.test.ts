import { expect, it, vi } from "vitest";
import { cameraMenuItems,selectCameraMenuItem } from "./camera-menu";
import { cadCameraPresentation } from "../../cad-camera-presentation-store";
import { cadPresentation } from "../../cad-presentation-store";

it("offers camera views and projection without duplicating environment commands", () => {
  const items = cameraMenuItems();
  expect(items.slice(0,4).map(i => i.label)).toEqual(["Home", "Isometric", "Dimetric", "Trimetric"]);
  expect(items.some(i => ["grid", "floor", "edges", "display"].includes(i.id))).toBe(false);
});
it("routes Home/view/fit actions and real graphics controls to their owners",()=>{
  const camera=vi.fn(),presentation=vi.fn();
  const release=cadCameraPresentation.registerActionHandler(camera),unlisten=cadPresentation.registerActionHandler(presentation);
  try {
    for(const id of ["home","dimetric","trimetric","zoom-to-fit"])selectCameraMenuItem(id);
    expect(camera.mock.calls.map(c=>c[0])).toEqual([{type:"fit-isometric"},{type:"select-view",view:"dimetric"},{type:"select-view",view:"trimetric"},{type:"zoom-to-fit"}]);
    selectCameraMenuItem("graphics");expect(presentation).toHaveBeenCalledWith({type:"show-start-dialog",dialog:"graphics-preferences"});
  } finally {release();unlisten();}
});
it("reflects the actual projection and routes both camera modes without changing geometry",()=>{
  const items=cameraMenuItems("orthographic");
  expect(items.find(item=>item.id==="projection:orthographic")?.checked).toBe(true);
  expect(items.find(item=>item.id==="projection:perspective")?.checked).toBe(false);
  const handle=vi.fn(),release=cadCameraPresentation.registerActionHandler(handle);
  try {
    selectCameraMenuItem("projection:perspective");selectCameraMenuItem("projection:orthographic");
    expect(handle.mock.calls.map(call=>call[0])).toEqual([{type:"set-projection",projection:"perspective"},{type:"set-projection",projection:"orthographic"}]);
  } finally {release();}
});
