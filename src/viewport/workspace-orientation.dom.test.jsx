import { createRequire } from "node:module";
import React, { act } from "react";
import { createRoot } from "react-dom/client";
import { beforeAll, afterAll, afterEach, expect, it, vi } from "vitest";
const require = createRequire(import.meta.url);
const { JSDOM } = require("jsdom");
let dom;
beforeAll(()=>{
  dom=new JSDOM("<html><body></body></html>",{url:"http://localhost"});
  for(const key of ["window","document","navigator","HTMLElement","Element","Node","Event","Storage","localStorage"]) vi.stubGlobal(key,dom.window[key]);
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT",true);
});
afterAll(()=>{dom.window.close();vi.unstubAllGlobals();});
import { WorkspaceOrientationSettings } from "../react/chrome/WorkspaceOrientationSettings";
import { cadCameraPresentation } from "../cad-camera-presentation-store";
import { readWorkspaceUpAxis, saveWorkspaceUpAxis } from "./workspace-orientation";

afterEach(()=>{ localStorage.clear(); cadCameraPresentation.setUpAxis("z"); vi.restoreAllMocks(); });
it("defaults to Z-up and reloads either stored workspace choice",()=>{
  expect(readWorkspaceUpAxis()).toBe("z");
  for (const axis of ["y", "z"]) { saveWorkspaceUpAxis(axis); expect(readWorkspaceUpAxis()).toBe(axis); }
});
it("keeps working when browser storage is blocked",()=>{
  vi.spyOn(Storage.prototype,"getItem").mockImplementation(()=>{throw new Error("blocked");});
  vi.spyOn(Storage.prototype,"setItem").mockImplementation(()=>{throw new Error("blocked");});
  expect(readWorkspaceUpAxis()).toBe("z");
  expect(()=>saveWorkspaceUpAxis("y")).not.toThrow();
});
it("the workspace selector forwards a choice and reflects the applied setting",()=>{
  const handler=vi.fn(action=>cadCameraPresentation.setUpAxis(action.upAxis));
  const release=cadCameraPresentation.registerActionHandler(handler);
  try {
    const container=document.createElement("div"); document.body.append(container);
    const root=createRoot(container);
    act(()=>root.render(<WorkspaceOrientationSettings/>));
    const select=container.querySelector('select');
    expect(select.value).toBe("z");
    act(()=>{select.value="y";select.dispatchEvent(new Event("change",{bubbles:true}));});
    expect(handler).toHaveBeenCalledWith({type:"set-up-axis",upAxis:"y"});
    expect(select.value).toBe("y");
    act(()=>root.unmount()); container.remove();
  } finally {release();}
});
