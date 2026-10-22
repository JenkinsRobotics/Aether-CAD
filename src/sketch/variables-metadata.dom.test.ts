// @vitest-environment jsdom
import { expect, it, vi } from "vitest";
import { mountSketchVariables } from "./variables";
import type { SketchDrawing } from "@aether/core/sketch";
import type { DocumentVariable } from "@aether/core/document";

it("keeps a comment and a favourite per variable, lists favourites first, counts users and offers completions", async () => {
  const drawing: SketchDrawing = { type: "drawing", contours: [] };
  let variables: DocumentVariable[] = [{ name: "width", kind: "length", expression: "40 mm" }, { name: "half", kind: "length", expression: "#width / 2", favorite: true }];
  const commit = vi.fn((_d: SketchDrawing, v: DocumentVariable[]) => { variables = v; });
  const host = document.createElement("div"); document.body.append(host);
  const panel = mountSketchVariables(host, () => ({ drawing, variables }), commit);
  panel.sync?.();
  const names = [...host.querySelectorAll('[aria-label="Variable name"]')].map((el) => (el as HTMLInputElement).value);
  expect(names).toEqual(["half", "width"]); // the favourite first
  const stars = [...host.querySelectorAll('[aria-label="Favourite variable"]')] as HTMLInputElement[];
  expect(stars.map((s) => s.checked)).toEqual([true, false]);
  const users = [...host.querySelectorAll(".sketch-variable-users")].map((el) => el.textContent);
  expect(users).toEqual(["0 users", "1 users"]); // nothing uses half; half uses width
  const comments = [...host.querySelectorAll('[aria-label="Variable comment"]')] as HTMLInputElement[];
  comments[1].value = "outer width"; comments[1].dispatchEvent(new Event("input"));
  stars[1].checked = true; stars[1].dispatchEvent(new Event("change"));
  expect(host.querySelector("datalist")!.querySelectorAll("option").length).toBeGreaterThan(10);
  ([...host.querySelectorAll("button")].find((b) => b.textContent === "Apply variables to sketch") as HTMLButtonElement).click();
  for (let i = 0; i < 50 && !commit.mock.calls.length; i++) await new Promise((r) => setTimeout(r, 10));
  expect(commit, host.querySelector('[role="status"]')?.textContent ?? "").toHaveBeenCalled();
  expect(variables.find((v) => v.name === "width")).toMatchObject({ comment: "outer width", favorite: true });
});
