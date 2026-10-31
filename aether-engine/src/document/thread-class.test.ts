import { expect, it } from "vitest";
import { validateHole, type HoleFeature } from "./hole";
import { validateThread, type ThreadFeature } from "./thread";

const earlier = new Map([["c", "profile"], ["e", "extrude"]]);
const hole = (thread: HoleFeature["thread"]): HoleFeature => ({ id: "h", type: "hole", name: "Hole", suppressed: false, profileFeatureId: "c", diameterMillimeters: 5, depthMillimeters: 12, depthType: "blind", cutType: "plain", thread });
const run = (feature: HoleFeature) => { try { validateHole(feature, earlier, () => false); return undefined; } catch (error) { return (error as Error).message; } };
const face: ThreadFeature["face"] = { sourceFeatureId: "e", bodyId: "e", label: "wall", surfaceType: "cylinder" };
const cosmetic = (feature: Partial<ThreadFeature>) => { try { validateThread({ id: "t", type: "thread", name: "Thread", suppressed: false, face, designation: "M8", ...feature }, earlier, () => false); return undefined; } catch (error) { return (error as Error).message; } };

it("records a thread class on tapped holes and refuses classes the standard lacks", () => {
  expect(run(hole({ standard: "iso-metric-coarse", designation: "M8", tapped: true, threadClass: "6G" }))).toBeUndefined();
  expect(run(hole({ standard: "unc", designation: "1/4-20", tapped: true, threadClass: "2B" }))).toBeUndefined();
  expect(run(hole({ standard: "iso-metric-coarse", designation: "M8", tapped: true, threadClass: "2B" }))).toMatch(/Thread class must be one of/);
  expect(run(hole({ standard: "npt", designation: "1/2-14", tapped: true, threadClass: "6H" }))).toMatch(/none for a pipe thread/);
});

it("cosmetic threads take any hole standard's size and a class, keeping typed metric designations", () => {
  expect(cosmetic({})).toBeUndefined();
  expect(cosmetic({ designation: "M8x1", threadClass: "6G" })).toBeUndefined();
  expect(cosmetic({ standard: "unf", designation: "3/8-24", threadClass: "3B" })).toBeUndefined();
  expect(cosmetic({ standard: "bsp", designation: "G1/2" })).toBeUndefined();
  expect(cosmetic({ standard: "unc", designation: "M8" })).toMatch(/Unknown unc thread size/);
  expect(cosmetic({ designation: "1/4-20" })).toMatch(/ISO metric/);
  expect(cosmetic({ standard: "unc", designation: "1/4-20", threadClass: "6H" })).toMatch(/Unknown thread class/);
});
