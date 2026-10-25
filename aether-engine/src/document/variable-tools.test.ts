import { expect, it } from "vitest";
import { createEmptyPartDocument } from "./index";
import { completeExpression, exportVariables, importVariables, moveVariable, setVariableComment, setVariableFavorite, variableGraph, variableUsers } from "./variable-tools";

const doc = () => {
  const d = createEmptyPartDocument("Vars");
  d.variables = [{ name: "width", kind: "length", expression: "40 mm" }, { name: "half", kind: "length", expression: "#width / 2" }, { name: "count", kind: "number", expression: "4" }];
  d.features.push({ id: "s", type: "profile", name: "Sketch 1", plane: "XY", offsetMillimeters: 0, suppressed: false, profile: { type: "drawing", contours: [], constraints: [{ id: "d1", kind: "distance", a: { contour: 0, kind: "point", index: 0 }, value: 10, valueExpression: "#half + 1 mm" }] } });
  return d;
};

it("finds users, builds the graph with cycles and errors, and completes expressions", () => {
  expect(variableUsers(doc(), "width")).toEqual({ parameters: ["half"], features: [] });
  expect(variableUsers(doc(), "half")).toEqual({ parameters: [], features: [{ id: "s", name: "Sketch 1" }] });
  const graph = variableGraph(doc());
  expect(graph.edges).toEqual([["half", "width"], ["Feature:Sketch 1", "half"]]);
  expect(graph.cycles).toEqual([]); expect(graph.errors).toEqual([]);
  const looped = { ...doc(), variables: [{ name: "a", kind: "number" as const, expression: "#b + 1" }, { name: "b", kind: "number" as const, expression: "#a * 2" }, { name: "c", kind: "number" as const, expression: "#ghost" }] };
  const bad = variableGraph(looped);
  expect(bad.cycles.length).toBe(1); expect(bad.errors).toEqual(["#c uses unknown #ghost"]);
  const done = completeExpression(doc(), "2 * #w");
  expect(done.word).toBe("#w"); expect(done.suggestions.map((s) => s.text)).toEqual(["#width"]);
  expect(completeExpression(doc(), "s").suggestions.map((s) => s.text)).toEqual(expect.arrayContaining(["sin(", "sqrt("]));
});

it("comments, favourites, reorders, and round-trips variables through CSV and JSON", () => {
  let d = setVariableComment(doc(), "width", "outer width");
  d = setVariableFavorite(d, "width");
  expect(d.variables?.[0]).toMatchObject({ comment: "outer width", favorite: true });
  d = setVariableFavorite(d, "width", false);
  expect(d.variables?.[0]).not.toHaveProperty("favorite");
  d = moveVariable(d, "count", { before: "width" });
  expect(d.variables?.map((v) => v.name)).toEqual(["count", "width", "half"]);
  const csv = exportVariables(d, "csv");
  expect(csv.split("\n")[0]).toBe("name,expression,kind,comment,favorite");
  const back = importVariables(createEmptyPartDocument("B"), csv);
  expect(back.added).toBe(3); expect(back.document.variables?.[1]).toMatchObject({ name: "width", expression: "40 mm", kind: "length", comment: "outer width" });
  const json = exportVariables(d, "json");
  const again = importVariables(d, json);
  expect(again.replaced).toBe(3); expect(again.added).toBe(0);
  expect(() => moveVariable(d, "nope", { after: "width" })).toThrow(/No variable/);
});
