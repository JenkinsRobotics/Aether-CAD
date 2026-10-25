// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { installAssemblyHistoryShortcuts } from "./assembly-history";
let uninstall: (() => void) | undefined;
afterEach(() => { uninstall?.(); document.body.innerHTML = ""; });
const press = (target: EventTarget = window, modifiers: KeyboardEventInit = {ctrlKey:true}) => {
  const event = new KeyboardEvent("keydown", {key:"z", bubbles:true, cancelable:true, ...modifiers});
  target.dispatchEvent(event); return event;
};
it("routes both platform keys, serializes restoration, and reports failures", async () => {
  let finish!:()=>void;
  const step=vi.fn<(_: -1|1) => Promise<void>>(()=>new Promise(resolve=>{finish=resolve;})), error=vi.fn();
  uninstall=installAssemblyHistoryShortcuts({active:()=>true,canStep:()=>true,step,onError:error});
  expect(press().defaultPrevented).toBe(true); press(); expect(step).toHaveBeenCalledTimes(1);
  finish(); await vi.waitFor(()=>expect(step).toHaveResolved());
  step.mockRejectedValueOnce(Error("Restore refused"));
  press(window,{metaKey:true,shiftKey:true}); await vi.waitFor(()=>expect(error).toHaveBeenCalled());
  expect(step).toHaveBeenLastCalledWith(1);
});
it("leaves typing, modals, unavailable history and other workspaces alone", () => {
  const step=vi.fn(async()=>{}); let active=true, available=true;
  uninstall=installAssemblyHistoryShortcuts({active:()=>active,canStep:()=>available,step,onError:vi.fn()});
  for (const tag of ["input","textarea","select"]) {
    const input=document.createElement(tag);document.body.append(input);expect(press(input).defaultPrevented).toBe(false);input.remove();
  }
  const dialog=document.createElement("div");dialog.setAttribute("role","dialog");document.body.append(dialog);
  expect(press().defaultPrevented).toBe(false);dialog.remove();
  active=false;expect(press().defaultPrevented).toBe(false);active=true;available=false;
  expect(press().defaultPrevented).toBe(false);available=true;
  expect(press(window,{}).defaultPrevented).toBe(false);expect(press(window,{ctrlKey:true,altKey:true}).defaultPrevented).toBe(false);
  expect(step).not.toHaveBeenCalled();
});
