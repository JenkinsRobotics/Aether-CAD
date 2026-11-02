/** "x y z; x y z" (commas allowed) into points. */
export function parsePoints3D(text: string): [number, number, number][] {
  return text.split(";").map((s) => s.trim()).filter(Boolean).map((s) => {
    const parts = s.split(/[\s,]+/).filter(Boolean).map(Number);
    if (parts.length !== 3 || parts.some((n) => !Number.isFinite(n))) throw new Error(`"${s}" is not x y z.`);
    return parts as [number, number, number];
  });
}
