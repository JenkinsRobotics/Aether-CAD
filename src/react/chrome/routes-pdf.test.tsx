// @vitest-environment jsdom
import { act, StrictMode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { DrawingWorkspaceRoute } from "./routes";

const fixture = vi.hoisted(() => ({
  built: { document: { name: "Plate", sheets: [{ id: "sheet", views: [], annotations: [] }] } },
  state: { selectedEntityIDs: new Set<string>() },
  pdf: vi.fn(), download: vi.fn(),
}));
vi.mock("@aether/ui", () => ({ Button: (props: React.ButtonHTMLAttributes<HTMLButtonElement>) => <button {...props}/> }));
vi.mock("../../cad-drawing-workspace-store", () => ({ cadDrawingWorkspace: {
  subscribe: () => () => {}, snapshot: () => fixture.state, dispatch: vi.fn(),
} }));
vi.mock("../../drawing/controller", () => ({ drawingEditor: {
  snapshot: () => fixture.built, displayedSheetId: () => "sheet",
  history: () => ({ busy: false, canUndo: false, canRedo: false }), writable: () => false,
} }));
vi.mock("../../drawing/files", () => ({ drawingFiles: {}, downloadDrawingFile: (...args: unknown[]) => fixture.download(...args) }));
vi.mock("../../drawing/pdf-export", () => ({ drawingPDF: (...args: unknown[]) => fixture.pdf(...args) }));
vi.mock("../../drawing/DrawingAuthorDialog", () => ({ DrawingAuthorDialog: () => null }));
vi.mock("../DrawingWorkspace", () => ({ DrawingWorkspace: ({ onCommand }: { onCommand: (id: string) => void }) => <>
  <button onClick={() => onCommand("export-pdf")}>PDF</button>
  <button onClick={() => onCommand("export-pdf-all")}>All sheets</button>
</> }));
let root: Root, container: HTMLDivElement;
let resolve: (bytes: Uint8Array) => void;
const bytes = new Uint8Array([37, 80, 68, 70]);
const render = (active: boolean) => act(() => root.render(<StrictMode><DrawingWorkspaceRoute active={active}/></StrictMode>));
const click = (label: string) => act(() => {
  const button = [...container.querySelectorAll("button")].find(button => button.textContent === label);
  expect(button).toBeDefined(); button!.click();
});
beforeEach(async () => {
  Object.assign(globalThis, { IS_REACT_ACT_ENVIRONMENT: true });
  fixture.pdf.mockImplementation(() => new Promise<Uint8Array>(done => { resolve = done; }));
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container); await render(true);
});
afterEach(async () => { await act(() => root.unmount()); container.remove(); vi.resetAllMocks(); });

it.each([["PDF", "sheet", false], ["All sheets", undefined, true]] as const)("downloads %s in StrictMode, including read-only drawings", async (label, sheet, all) => {
  await click(label);
  expect(fixture.pdf).toHaveBeenCalledWith(fixture.built, sheet, all);
  await act(async () => resolve(bytes));
  expect(fixture.download).toHaveBeenCalledWith("Plate.pdf", bytes, "application/pdf");
});

it.each(["revision", "leave-return", "unmount"])("does not download stale PDF after %s", async change => {
  await click("PDF");
  if (change === "revision") fixture.built = structuredClone(fixture.built);
  if (change === "leave-return") { await render(false); await render(true); }
  if (change === "unmount") await act(() => root.render(null));
  await act(async () => resolve(bytes));
  expect(fixture.download).not.toHaveBeenCalled();
  if (change !== "unmount") expect(container.querySelector('[role="alert"]')?.textContent).toContain("changed during PDF export");
});
