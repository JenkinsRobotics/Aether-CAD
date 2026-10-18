import { describe, expect, it, vi } from "vitest";
import { cadCommands } from "../cad-command-registry";
import { cadAppearance } from "../cad-appearance-store";
import { cadSelection } from "../cad-selection-store";
import { registerViewCommands, viewCommandIDs } from "./view-commands";

const host = () => ({
  setCameraView: vi.fn(),
  frameAll: vi.fn(),
  setStatus: vi.fn(),
});

describe("registering the view commands", () => {
  it("registers every command it claims to own", () => {
    // Moving sixty near-identical register() calls out of main.ts is exactly
    // the kind of edit that silently drops one. This is the check.
    registerViewCommands(host());
    const states = cadCommands.snapshot();
    for (const id of viewCommandIDs)
      expect(states[id]?.registered, `${id} was not registered`).toBe(true);
  });

  it("covers every camera view, display style, lighting and ground mode", () => {
    // Counted rather than listed, so adding one without registering it fails.
    expect(viewCommandIDs.filter((id) => id.startsWith("view-"))).toHaveLength(7);
    expect(viewCommandIDs.filter((id) => id.startsWith("display-"))).toHaveLength(5);
    expect(viewCommandIDs.filter((id) => id.startsWith("lighting-"))).toHaveLength(4);
    expect(viewCommandIDs.filter((id) => id.startsWith("background-"))).toHaveLength(4);
    expect(viewCommandIDs.filter((id) => id.startsWith("finish-"))).toHaveLength(3);
    expect(viewCommandIDs.filter((id) => id.startsWith("ground-"))).toHaveLength(4);
    expect(new Set(viewCommandIDs).size).toBe(viewCommandIDs.length);
  });

  it("drives the camera through the host rather than reaching for a viewer", () => {
    const target = host();
    registerViewCommands(target);
    cadCommands.execute("view-front");
    expect(target.setCameraView).toHaveBeenCalledWith("front");
    cadCommands.execute("fit-view");
    expect(target.frameAll).toHaveBeenCalled();
  });

  it("changes the appearance store, which is what actually repaints", () => {
    registerViewCommands(host());
    cadCommands.execute("display-wireframe");
    expect(cadAppearance.snapshot().displayStyle).toBe("wireframe");
    cadCommands.execute("lighting-daylight");
    expect(cadAppearance.snapshot().lightingPreset).toBe("daylight");
    cadCommands.execute("background-blueprint");
    expect(cadAppearance.snapshot().background).toBe("blueprint");
    cadCommands.execute("finish-gloss");
    expect(cadAppearance.snapshot().materialFinish).toBe("gloss");
    cadCommands.execute("reset-appearance");
    expect(cadAppearance.snapshot().displayStyle).not.toBe("wireframe");
  });

  it("toggles rather than sets, so the same command turns a thing back off", () => {
    registerViewCommands(host());
    const before = cadAppearance.snapshot().edgesVisible;
    cadCommands.execute("toggle-feature-edges");
    expect(cadAppearance.snapshot().edgesVisible).toBe(!before);
    cadCommands.execute("toggle-feature-edges");
    expect(cadAppearance.snapshot().edgesVisible).toBe(before);
  });

  it("cycles the selection filter and says which one it landed on", () => {
    const target = host();
    registerViewCommands(target);
    cadSelection.dispatch({ type: "set-filter", filter: "auto" });
    cadCommands.execute("selection-next-filter");
    const filter = cadSelection.snapshot().filter;
    expect(filter).not.toBe("auto");
    expect(target.setStatus).toHaveBeenCalledWith(`Selection filter: ${filter}.`);
  });

  it("wraps round the end of the filter list rather than sticking", () => {
    registerViewCommands(host());
    cadSelection.dispatch({ type: "set-filter", filter: "vertex" });
    cadCommands.execute("selection-next-filter");
    expect(cadSelection.snapshot().filter).toBe("auto");
  });
});


it("selection commands drive the live store and clear selected items", () => {
  registerViewCommands(host());
  cadCommands.execute("selection-window");
  expect(cadSelection.snapshot().dragMode).toBe("window");
  expect(cadCommands.snapshot()["selection-window"].active).toBe(true);
  cadCommands.execute("selection-crossing");
  expect(cadSelection.snapshot().dragMode).toBe("crossing");
  expect(cadCommands.snapshot()["selection-window"].active).toBe(false);
  cadSelection.dispatch({type:"replace",items:[{id:"body:a",partId:"a",kind:"body",label:"A"}]});
  cadCommands.execute("selection-clear");
  expect(cadSelection.snapshot().items).toEqual([]);
  cadCommands.execute("selection-directional");
});
