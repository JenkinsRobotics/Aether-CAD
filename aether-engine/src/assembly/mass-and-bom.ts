/** Assembly mass properties (parallel-axis 3×3 inertia tensor + rigid-group totals)
 *  and structured/flattened BOM management with BOM types (`normal`, `phantom`, `reference`,
 *  `purchased`, `inseparable`), item locking, and renumbering. */

export type BomType = "normal" | "phantom" | "reference" | "purchased" | "inseparable";

export interface AssemblyOccurrenceMass {
  instanceId: string;
  partId: string;
  partNumber?: string;
  name: string;
  revision?: string;
  material?: string;
  bomType?: BomType;
  parentInstanceId?: string;
  rigidGroupId?: string;
  massKg: number;
  volumeMm3: number;
  /** Local center of mass relative to occurrence origin (mm). */
  centerOfMassLocalMm: readonly [number, number, number];
  /** Local inertia tensor about local COM: [Ixx, Iyy, Izz, Ixy, Ixz, Iyz] in kg·mm². */
  inertiaLocalKgMm2?: readonly [number, number, number, number, number, number];
  /** World placement (mm) & unit quaternion [x, y, z, w]. */
  placementMm: readonly [number, number, number];
  rotation: readonly [number, number, number, number];
}

export interface InertiaTensor3x3 {
  ixx: number; iyy: number; izz: number;
  ixy: number; ixz: number; iyz: number;
}

export interface AssemblyMassReport {
  totalMassKg: number;
  totalVolumeMm3: number;
  centerOfMassWorldMm: [number, number, number];
  inertiaWorldKgMm2: InertiaTensor3x3;
  includedCount: number;
  excludedReferenceCount: number;
  occurrences: {
    instanceId: string;
    name: string;
    massKg: number;
    volumeMm3: number;
    centerOfMassWorldMm: [number, number, number];
    excluded: boolean;
  }[];
  rigidGroups: Record<string, { massKg: number; centerOfMassWorldMm: [number, number, number]; memberIds: string[] }>;
}

function quatToMatrix3(q: readonly [number, number, number, number]): [number, number, number, number, number, number, number, number, number] {
  const l = Math.hypot(q[0], q[1], q[2], q[3]) || 1;
  const x = q[0] / l, y = q[1] / l, z = q[2] / l, w = q[3] / l;
  return [
    1 - 2 * (y * y + z * z), 2 * (x * y - z * w), 2 * (x * z + y * w),
    2 * (x * y + z * w), 1 - 2 * (x * x + z * z), 2 * (y * z - x * w),
    2 * (x * z - y * w), 2 * (y * z + x * w), 1 - 2 * (x * x + y * y),
  ];
}

function mulMatVec(m: readonly number[], v: readonly [number, number, number]): [number, number, number] {
  return [
    m[0] * v[0] + m[1] * v[1] + m[2] * v[2],
    m[3] * v[0] + m[4] * v[1] + m[5] * v[2],
    m[6] * v[0] + m[7] * v[1] + m[8] * v[2],
  ];
}

function rotateInertia(R: readonly number[], local: readonly [number, number, number, number, number, number]): InertiaTensor3x3 {
  const [ixx, iyy, izz, ixy, ixz, iyz] = local;
  const I = [
    ixx, ixy, ixz,
    ixy, iyy, iyz,
    ixz, iyz, izz,
  ];
  // Compute R * I * R^T
  const RI = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) RI[r * 3 + c] += R[r * 3 + k] * I[k * 3 + c];
  const out = new Array<number>(9).fill(0);
  for (let r = 0; r < 3; r++)
    for (let c = 0; c < 3; c++)
      for (let k = 0; k < 3; k++) out[r * 3 + c] += RI[r * 3 + k] * R[c * 3 + k];
  return { ixx: out[0], iyy: out[4], izz: out[8], ixy: out[1], ixz: out[2], iyz: out[5] };
}

/** Compute world-space combined mass, volume, center of mass, and parallel-axis 3×3 inertia
 *  tensor across an assembly, honoring `bomType === "reference"` exclusions and rigid groups. */
export function computeAssemblyMassProperties(occurrences: readonly AssemblyOccurrenceMass[]): AssemblyMassReport {
  let totalMassKg = 0;
  let totalVolumeMm3 = 0;
  let wx = 0, wy = 0, wz = 0;
  let includedCount = 0, excludedReferenceCount = 0;

  const worldEntries: { occ: AssemblyOccurrenceMass; comW: [number, number, number]; rotI: InertiaTensor3x3; excluded: boolean }[] = [];
  for (const occ of occurrences) {
    const R = quatToMatrix3(occ.rotation);
    const localRot = mulMatVec(R, occ.centerOfMassLocalMm);
    const comW: [number, number, number] = [
      occ.placementMm[0] + localRot[0],
      occ.placementMm[1] + localRot[1],
      occ.placementMm[2] + localRot[2],
    ];
    const excluded = occ.bomType === "reference";
    const rotI = occ.inertiaLocalKgMm2
      ? rotateInertia(R, occ.inertiaLocalKgMm2)
      : { ixx: 0, iyy: 0, izz: 0, ixy: 0, ixz: 0, iyz: 0 };
    worldEntries.push({ occ, comW, rotI, excluded });
    if (excluded) {
      excludedReferenceCount++;
      continue;
    }
    includedCount++;
    totalMassKg += occ.massKg;
    totalVolumeMm3 += occ.volumeMm3;
    wx += occ.massKg * comW[0];
    wy += occ.massKg * comW[1];
    wz += occ.massKg * comW[2];
  }

  const comTotal: [number, number, number] = totalMassKg > 1e-12 ? [wx / totalMassKg, wy / totalMassKg, wz / totalMassKg] : [0, 0, 0];
  const inertia: InertiaTensor3x3 = { ixx: 0, iyy: 0, izz: 0, ixy: 0, ixz: 0, iyz: 0 };
  const rigidGroups: AssemblyMassReport["rigidGroups"] = {};

  for (const { occ, comW, rotI, excluded } of worldEntries) {
    if (excluded) continue;
    const dx = comW[0] - comTotal[0], dy = comW[1] - comTotal[1], dz = comW[2] - comTotal[2];
    const m = occ.massKg;
    // Parallel-axis theorem: I_total += I_com + m * (|r|^2 * E - r * r^T)
    inertia.ixx += rotI.ixx + m * (dy * dy + dz * dz);
    inertia.iyy += rotI.iyy + m * (dx * dx + dz * dz);
    inertia.izz += rotI.izz + m * (dx * dx + dy * dy);
    inertia.ixy += rotI.ixy - m * dx * dy;
    inertia.ixz += rotI.ixz - m * dx * dz;
    inertia.iyz += rotI.iyz - m * dy * dz;

    if (occ.rigidGroupId) {
      const g = rigidGroups[occ.rigidGroupId] ?? { massKg: 0, centerOfMassWorldMm: [0, 0, 0], memberIds: [] };
      const prevM = g.massKg;
      const newM = prevM + m;
      if (newM > 1e-12) {
        g.centerOfMassWorldMm = [
          (g.centerOfMassWorldMm[0] * prevM + comW[0] * m) / newM,
          (g.centerOfMassWorldMm[1] * prevM + comW[1] * m) / newM,
          (g.centerOfMassWorldMm[2] * prevM + comW[2] * m) / newM,
        ];
      }
      g.massKg = newM;
      g.memberIds.push(occ.instanceId);
      rigidGroups[occ.rigidGroupId] = g;
    }
  }

  return {
    totalMassKg,
    totalVolumeMm3,
    centerOfMassWorldMm: comTotal,
    inertiaWorldKgMm2: inertia,
    includedCount,
    excludedReferenceCount,
    occurrences: worldEntries.map(({ occ, comW, excluded }) => ({
      instanceId: occ.instanceId,
      name: occ.name,
      massKg: occ.massKg,
      volumeMm3: occ.volumeMm3,
      centerOfMassWorldMm: comW,
      excluded,
    })),
    rigidGroups,
  };
}

export interface BomRow {
  itemNumber: string;
  locked?: boolean;
  partNumber: string;
  name: string;
  revision: string;
  bomType: BomType;
  quantity: number;
  material: string;
  unitMassKg: number;
  totalMassKg: number;
  children?: BomRow[];
}

/** Build a flattened or hierarchical BOM honoring `reference` (excluded), `phantom` (transparent),
 *  `inseparable` (leaf unit), `purchased`, and `normal` BOM types. */
export function buildAssemblyBom(
  occurrences: readonly AssemblyOccurrenceMass[],
  mode: "flattened" | "hierarchical" = "flattened",
): BomRow[] {
  const byId = new Map(occurrences.map((o) => [o.instanceId, o]));
  const isExcludedAncestor = (occ: AssemblyOccurrenceMass): boolean => {
    let cur: AssemblyOccurrenceMass | undefined = occ;
    while (cur) {
      if (cur.bomType === "reference") return true;
      const parent: AssemblyOccurrenceMass | undefined = cur.parentInstanceId ? byId.get(cur.parentInstanceId) : undefined;
      if (parent && parent.bomType === "inseparable" && cur !== parent) return true;
      cur = parent;
    }
    return false;
  };

  if (mode === "flattened") {
    const grouped = new Map<string, BomRow>();
    for (const occ of occurrences) {
      const bType = occ.bomType ?? "normal";
      if (bType === "reference" || bType === "phantom" || isExcludedAncestor(occ)) continue;
      const pn = occ.partNumber ?? occ.partId;
      const existing = grouped.get(pn);
      if (existing) {
        existing.quantity += 1;
        existing.totalMassKg = existing.unitMassKg * existing.quantity;
      } else {
        grouped.set(pn, {
          itemNumber: String(grouped.size + 1),
          partNumber: pn,
          name: occ.name,
          revision: occ.revision ?? "A",
          bomType: bType,
          quantity: 1,
          material: occ.material ?? "",
          unitMassKg: occ.massKg,
          totalMassKg: occ.massKg,
        });
      }
    }
    return [...grouped.values()];
  }

  // Hierarchical BOM: promote children of `phantom` containers directly into their parent.
  const effectiveParent = (occ: AssemblyOccurrenceMass): string | undefined => {
    let pId = occ.parentInstanceId;
    while (pId) {
      const p = byId.get(pId);
      if (!p) return undefined;
      if (p.bomType !== "phantom") return pId;
      pId = p.parentInstanceId;
    }
    return undefined;
  };

  const buildLevel = (parentId: string | undefined, prefix: string): BomRow[] => {
    const direct = occurrences.filter((o) => (o.bomType ?? "normal") !== "reference" && (o.bomType ?? "normal") !== "phantom" && !isExcludedAncestor(o) && effectiveParent(o) === parentId);
    const grouped = new Map<string, { row: BomRow; firstId: string }>();
    for (const occ of direct) {
      const pn = occ.partNumber ?? occ.partId;
      const entry = grouped.get(pn);
      if (entry) {
        entry.row.quantity += 1;
        entry.row.totalMassKg = entry.row.unitMassKg * entry.row.quantity;
      } else {
        const itemNumber = prefix ? `${prefix}.${grouped.size + 1}` : String(grouped.size + 1);
        const children = (occ.bomType ?? "normal") === "inseparable" ? [] : buildLevel(occ.instanceId, itemNumber);
        grouped.set(pn, {
          firstId: occ.instanceId,
          row: {
            itemNumber,
            partNumber: pn,
            name: occ.name,
            revision: occ.revision ?? "A",
            bomType: occ.bomType ?? "normal",
            quantity: 1,
            material: occ.material ?? "",
            unitMassKg: occ.massKg,
            totalMassKg: occ.massKg,
            ...(children.length ? { children } : {}),
          },
        });
      }
    }
    return [...grouped.values()].map((e) => e.row);
  };
  return buildLevel(undefined, "");
}

/** Renumber BOM item numbers cleanly while optionally preserving locked rows (`bom.renumber`). */
export function renumberBomItems(
  rows: readonly BomRow[],
  options?: { start?: number; step?: number; preserveLocked?: boolean },
): BomRow[] {
  const start = options?.start ?? 1;
  const step = options?.step ?? 1;
  const preserveLocked = options?.preserveLocked ?? true;
  const next = structuredClone(rows) as BomRow[];
  const used = new Set(preserveLocked ? next.filter((r) => r.locked).map((r) => r.itemNumber) : []);
  let cursor = start;
  for (const row of next) {
    if (preserveLocked && row.locked) continue;
    while (used.has(String(cursor))) cursor += step;
    row.itemNumber = String(cursor);
    used.add(row.itemNumber);
    cursor += step;
  }
  return next;
}

/** Set and optionally lock a specific BOM row's item number (`bom.set_item_number`), refusing duplicates. */
export function setBomItemNumber(rows: readonly BomRow[], partNumber: string, itemNumber: string, lock = true): BomRow[] {
  const trimmed = itemNumber.trim();
  if (!trimmed) throw new Error("BOM item number cannot be empty.");
  const next = structuredClone(rows) as BomRow[];
  const target = next.find((r) => r.partNumber === partNumber);
  if (!target) throw new Error(`Part "${partNumber}" not found in BOM.`);
  if (next.some((r) => r !== target && r.itemNumber === trimmed)) {
    throw new Error(`BOM item number "${trimmed}" is already in use.`);
  }
  target.itemNumber = trimmed;
  target.locked = lock;
  return next;
}

export function bomToCSV(rows: readonly BomRow[]): string {
  const esc = (s: string) => (/[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s);
  const lines = ["Item,Part Number,Name,Rev,BOM Type,Qty,Material,Unit Mass (kg),Total Mass (kg)"];
  const emit = (list: readonly BomRow[]) => {
    for (const r of list) {
      lines.push([r.itemNumber, r.partNumber, r.name, r.revision, r.bomType, String(r.quantity), r.material, r.unitMassKg.toFixed(4), r.totalMassKg.toFixed(4)].map(esc).join(","));
      if (r.children?.length) emit(r.children);
    }
  };
  emit(rows);
  return lines.join("\n") + "\n";
}
