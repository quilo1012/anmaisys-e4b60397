import { TIME_MOTION, type TimeMotionRow } from "@/lib/timeMotionMatrix";

/** Pack size in kg read from a product name: "375G" → 0.375, "2.4KG" → 2.4. Null when the name carries none. */
export function packSizeKg(name: string | null | undefined): number | null {
  if (!name) return null;
  const m = name.toUpperCase().match(/(\d+(?:[.,]\d+)?)\s*(KG|G)\b/);
  if (!m) return null;
  const n = Number(m[1].replace(",", "."));
  if (!Number.isFinite(n) || n <= 0) return null;
  return Math.round((m[2] === "KG" ? n : n / 1000) * 1000) / 1000;
}

/** The Time & Motion row for this line and pack size, matched exactly (to the gram). */
export function timeMotionFor(line: number, kg: number | null): TimeMotionRow | null {
  if (kg === null) return null;
  return TIME_MOTION[line]?.find((r) => Math.abs(r[0] - kg) < 0.0005) ?? null;
}
