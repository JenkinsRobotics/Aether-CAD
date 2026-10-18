import { expect, test } from "vitest";
import { localRequestProblem } from "../../scripts/test-window-runtime";
import { testWindowConnectionError } from "./connection";

test("accepts only same-origin loopback JSON computation requests", () => {
  const request = { method: "POST", headers: { host: "127.0.0.1:5174", origin: "http://127.0.0.1:5174", "content-type": "application/json" } };
  expect(localRequestProblem(request)).toBeNull();
  expect(localRequestProblem({ ...request, headers: { ...request.headers, host: "localhost:5174", origin: "http://localhost:5174" } })).toBeNull();
  expect(localRequestProblem({ ...request, headers: { ...request.headers, origin: "https://unrelated.example" } })?.status).toBe(403);
  expect(localRequestProblem({ ...request, headers: { ...request.headers, host: "unrelated.example:5174", origin: "http://unrelated.example:5174" } })?.status).toBe(403);
  expect(localRequestProblem({ ...request, headers: { ...request.headers, "sec-fetch-site": "cross-site" } })?.status).toBe(403);
  expect(localRequestProblem({ ...request, method: "GET" })?.status).toBe(405);
  expect(localRequestProblem({ ...request, headers: { ...request.headers, "content-type": "text/plain" } })?.status).toBe(415);
});

test("network errors explain recovery without hiding engine or authentication errors", () => {
  for (const error of ["Failed to fetch", "TypeError: Load failed", "NetworkError when attempting to fetch resource."]) {
    expect(testWindowConnectionError(error, true)).toContain("npm run dev:test-window");
    expect(testWindowConnectionError(error, false)).toContain("CAD server could not be reached");
  }
  expect(testWindowConnectionError("Sign in again.", false)).toBe("Sign in again.");
  expect(testWindowConnectionError("Chamfer failed on edge 5.", true)).toBe("Chamfer failed on edge 5.");
});
