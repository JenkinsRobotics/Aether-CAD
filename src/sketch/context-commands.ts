import { cadCommands } from "../cad-command-registry";

/** Both viewport menus project the same live, validated sketch commands. */
export function sketchContextCommands() {
  const commands = cadCommands.snapshot();
  return ([
    ["sketch-finish-spline", "Confirm spline"],
    ["sketch-remove-spline-point", "Remove last spline point"],
    ["sketch-unfix", "Unfix selected geometry"],
  ] as const).filter(([id]) => commands[id]?.registered && commands[id]?.enabled).map(([id, label]) => ({
    id, label, run: () => { cadCommands.execute(id); },
  }));
}
