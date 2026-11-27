import type { PartDocument } from "../document/part-document";
import { updatePartDocumentVariables } from "../document/update-variables";
import { analyzePart } from "./analysis";

export interface ParameterSweepStep {
  valueExpression: string;
  ok: boolean;
  error?: string;
  totalVolumeMm3?: number;
  totalAreaMm2?: number;
  totalMassKg?: number;
  bodyCount?: number;
}

export interface ParameterSweepResult {
  parameter: string;
  steps: ParameterSweepStep[];
  passedCount: number;
  failedCount: number;
}

/** Sweep one variable across a list of expressions or numeric range (`inspect.parameter_sweep`),
 *  rebuilding and measuring an isolated clone at every step without mutating the source document. */
export async function runParameterSweep(
  document: PartDocument,
  options: {
    parameter: string;
    values?: string[];
    from?: number;
    to?: number;
    steps?: number;
    unit?: string;
  },
): Promise<ParameterSweepResult> {
  const existing = document.variables?.find((v) => v.name === options.parameter);
  if (!existing) throw new Error(`No variable named #${options.parameter} in this document.`);

  const expressions: string[] = [];
  if (options.values?.length) {
    expressions.push(...options.values);
  } else if (options.from !== undefined && options.to !== undefined) {
    const count = options.steps ?? 5;
    if (!Number.isInteger(count) || count < 2 || count > 100)
      throw new Error("Sweep steps must be an integer between 2 and 100.");
    const unit = options.unit ?? (existing.kind === "length" ? "mm" : existing.kind === "angle" ? "deg" : "");
    for (let i = 0; i < count; i++) {
      const val = options.from + ((options.to - options.from) * i) / (count - 1);
      const rounded = Math.round(val * 1e6) / 1e6;
      expressions.push(unit ? `${rounded} ${unit}` : String(rounded));
    }
  } else {
    throw new Error("Provide either values[] or from/to range for parameter sweep.");
  }

  const results: ParameterSweepStep[] = [];
  let passedCount = 0;
  let failedCount = 0;
  for (const expr of expressions) {
    try {
      const nextVars = (document.variables ?? []).map((v) =>
        v.name === options.parameter ? { ...v, expression: expr } : { ...v },
      );
      const updated = await updatePartDocumentVariables(document, nextVars);
      const props = analyzePart(updated, { kind: "properties" });
      const totalVolumeMm3 = props.measurements.reduce((s, m) => s + Number(m.volume_mm3 ?? 0), 0);
      const totalAreaMm2 = props.measurements.reduce((s, m) => s + Number(m.area_mm2 ?? 0), 0);
      const hasMass = props.measurements.length > 0 && props.measurements.every((m) => m.mass_kg !== undefined);
      const totalMassKg = hasMass ? props.measurements.reduce((s, m) => s + Number(m.mass_kg ?? 0), 0) : undefined;
      results.push({
        valueExpression: expr,
        ok: true,
        totalVolumeMm3,
        totalAreaMm2,
        totalMassKg,
        bodyCount: props.measurements.length,
      });
      passedCount++;
    } catch (error) {
      results.push({ valueExpression: expr, ok: false, error: (error as Error).message });
      failedCount++;
    }
  }
  return { parameter: options.parameter, steps: results, passedCount, failedCount };
}

export interface ParameterVariantSpec {
  name: string;
  values: Record<string, string>;
}

export interface ParameterVariantOutcome {
  name: string;
  ok: boolean;
  error?: string;
  totalVolumeMm3?: number;
  totalAreaMm2?: number;
  totalMassKg?: number;
  volumeDeltaMm3?: number;
}

/** Compare named multi-parameter design variants side-by-side (`inspect.parameter_variants`). */
export async function compareParameterVariants(
  document: PartDocument,
  variants: ParameterVariantSpec[],
): Promise<{ baselineVolumeMm3: number; variants: ParameterVariantOutcome[] }> {
  const baseProps = analyzePart(document, { kind: "properties" });
  const baselineVolumeMm3 = baseProps.measurements.reduce((s, m) => s + Number(m.volume_mm3 ?? 0), 0);
  const outcomes: ParameterVariantOutcome[] = [];
  for (const variant of variants) {
    try {
      const nextVars = (document.variables ?? []).map((v) =>
        v.name in variant.values ? { ...v, expression: variant.values[v.name] } : { ...v },
      );
      const updated = await updatePartDocumentVariables(document, nextVars);
      const props = analyzePart(updated, { kind: "properties" });
      const totalVolumeMm3 = props.measurements.reduce((s, m) => s + Number(m.volume_mm3 ?? 0), 0);
      const totalAreaMm2 = props.measurements.reduce((s, m) => s + Number(m.area_mm2 ?? 0), 0);
      const hasMass = props.measurements.length > 0 && props.measurements.every((m) => m.mass_kg !== undefined);
      const totalMassKg = hasMass ? props.measurements.reduce((s, m) => s + Number(m.mass_kg ?? 0), 0) : undefined;
      outcomes.push({
        name: variant.name,
        ok: true,
        totalVolumeMm3,
        totalAreaMm2,
        totalMassKg,
        volumeDeltaMm3: totalVolumeMm3 - baselineVolumeMm3,
      });
    } catch (error) {
      outcomes.push({ name: variant.name, ok: false, error: (error as Error).message });
    }
  }
  return { baselineVolumeMm3, variants: outcomes };
}
