import { expect, it, vi } from "vitest";
import { CADCommandRegistry } from "../cad-command-registry";
import { registerSketchToolCommands } from "./tool-commands";

it("makes Include and related tools available only during sketch editing", () => {
  const registry = new CADCommandRegistry();
  const run = vi.fn();
  const commands = registerSketchToolCommands(registry, run);
  const ids = [
    "sketch-include-edges", "sketch-intersect", "sketch-fit-section",
    "sketch-spun-profile", "sketch-two-tangent-circle", "sketch-three-tangent-circle",
    "sketch-line", "sketch-control-spline",
  ] as const;
  for (const id of ids) expect(registry.execute(id)).toBe(false);
  commands.setEditing(true);
  for (const id of ids) {
    expect(registry.execute(id)).toBe(true);
    expect(run).toHaveBeenLastCalledWith(id.slice("sketch-".length));
  }
  commands.setEditing(false);
  for (const id of ids) expect(registry.execute(id)).toBe(false);
  commands.dispose();
  commands.setEditing(true);
  for (const id of ids) expect(registry.execute(id)).toBe(false);
});
