import { expect, it } from "vitest";
import { createHash } from "node:crypto";
import { sha256Hex } from "./sha256";
it("matches Node's SHA-256 for the strings FreeCAD hashes", () => {
  for (const text of ['["sa"]', "", "abc", '["s#0","s#1"]', "a".repeat(55), "b".repeat(56), "c".repeat(64), "é".repeat(100)])
    expect(sha256Hex(text)).toBe(createHash("sha256").update(text).digest("hex"));
  expect(sha256Hex('["sa"]').slice(0, 24)).toBe("54e6c68d6bd7137d2b0e3f6b");
});
