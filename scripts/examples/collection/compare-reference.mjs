import assert from "node:assert/strict";

export function compareReference(model, proofs) {
  if (!model.reference && !model.checks) return null;
  const comparisons = [];
  for (const expected of (model.checks ?? model.reference.checks)) {
    const proof = proofs.find((p) => p.key === expected.part);
    assert.ok(proof, `Missing measurement for ${expected.part}`);
    const measure = proof.verification.measurements[0];
    for (const field of ["volume", "holeRemoval"])
      if (expected[field] !== undefined) {
        const actual =
          field === "volume"
            ? measure.volume_mm3
            : proof.holeChecks.reduce((n, c) => n + c.removedMm3, 0);
        const absoluteError = Math.abs(actual - expected[field]);
        const tolerance = Math.max(1, expected[field]) * 1e-6;
        assert.ok(
          absoluteError < tolerance,
          `${model.id}/${expected.part} ${field}: ${actual} != ${expected[field]}`,
        );
        comparisons.push({
          part: expected.part,
          field,
          units: "mm³",
          expected: expected[field],
          actual,
          absoluteError,
          relativeError: absoluteError / expected[field],
          tolerance,
          passed: true,
        });
      }
    if (expected.bounds)
      expected.bounds.forEach((value, i) => {
        const actual = measure.bounds_mm[i],
          absoluteError = Math.abs(actual - value);
        assert.ok(absoluteError < 0.02);
        comparisons.push({
          part: expected.part,
          field: `bounds ${["X", "Y", "Z"][i]}`,
          units: "mm",
          expected: value,
          actual,
          absoluteError,
          tolerance: 0.02,
          passed: true,
        });
      });
  }
  return {
    ...model.reference,
    method:
      "Independent analytic expectations compared with native OpenCASCADE measurements; not a run of another CAD engine.",
    comparisons,
  };
}
