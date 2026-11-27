/**
 * Fill-time standard from completed production batches: each batch's running time
 * (start → finish, minus recorded stops inside it) ÷ units made. Only batches with
 * both timestamps count; the standard is the median after dropping outliers.
 */
import { fillKey } from "@/lib/approvedFillTimes";

export interface BatchRun { line: string; sku: string; name: string | null; batch: string | null; date: string; startedAt: string; finishedAt: string; quantity: number }
export interface StopWindow { line: string; date?: string; startedAt: string | null; endedAt: string | null; durationMinutes?: number }
export interface BatchSample { batch: string | null; date: string; quantity: number; runMinutes: number; secondsPerUnit: number; outlier: boolean }
export interface BatchStandard { key: string; line: string; sku: string; name: string | null; samples: BatchSample[]; used: number; standardSeconds: number | null; unitsPerHour: number | null; spread: number | null; ready: boolean }

export const MIN_BATCHES = 3;
const MIN_RUN_MINUTES = 5;

const median = (xs: number[]) => { const s = [...xs].sort((a, b) => a - b); const m = Math.floor(s.length / 2); return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const quantile = (s: number[], q: number) => { const p = (s.length - 1) * q; const lo = Math.floor(p); return s[lo] + (s[Math.ceil(p)] - s[lo]) * (p - lo); };
const lineKey = (l: string) => fillKey(l, "").split("|")[0];

export function batchRunMinutes(b: BatchRun, stops: StopWindow[]): number | null {
  const a = Date.parse(b.startedAt), z = Date.parse(b.finishedAt);
  if (!Number.isFinite(a) || !Number.isFinite(z) || z <= a) return null;
  // Merge overlapping stops clipped to the batch so a minute is never removed twice.
  const lk = lineKey(b.line);
  // A positive stop without a usable window cannot be assigned to a batch safely.
  if (stops.some((s) => lineKey(s.line) === lk && (!s.date || s.date === b.date)
    && (s.durationMinutes ?? 0) > 0
    && (!s.startedAt || !s.endedAt || !Number.isFinite(Date.parse(s.startedAt)) || !Number.isFinite(Date.parse(s.endedAt)) || Date.parse(s.endedAt) <= Date.parse(s.startedAt)))) return null;
  const parts = stops.filter((s) => lineKey(s.line) === lk)
    .map((s) => [Math.max(a, Date.parse(s.startedAt ?? "")), Math.min(z, Date.parse(s.endedAt ?? ""))] as [number, number])
    .filter(([s, e]) => Number.isFinite(s) && Number.isFinite(e) && e > s).sort((x, y) => x[0] - y[0]);
  let stopped = 0, end = -Infinity;
  for (const [s, e] of parts) { const from = Math.max(s, end); if (e > from) stopped += e - from; end = Math.max(end, e); }
  return (z - a - stopped) / 60000;
}

export function batchFillStandards(batches: BatchRun[], stops: StopWindow[]): BatchStandard[] {
  const groups = new Map<string, { line: string; sku: string; name: string | null; samples: BatchSample[] }>();
  const overlapped = new Set<BatchRun>();
  const byLine = new Map<string, BatchRun[]>();
  for (const b of batches) {
    const list = byLine.get(lineKey(b.line)) ?? [];
    list.push(b); byLine.set(lineKey(b.line), list);
  }
  for (const list of byLine.values()) {
    const sorted = list.filter((b) => Number.isFinite(Date.parse(b.startedAt)) && Date.parse(b.finishedAt) > Date.parse(b.startedAt)).sort((a, b) => Date.parse(a.startedAt) - Date.parse(b.startedAt));
    let furthest: BatchRun | undefined;
    for (const b of sorted) {
      if (furthest && Date.parse(b.startedAt) < Date.parse(furthest.finishedAt)) { overlapped.add(b); overlapped.add(furthest); }
      if (!furthest || Date.parse(b.finishedAt) > Date.parse(furthest.finishedAt)) furthest = b;
    }
  }
  for (const b of batches) {
    if (!b.line || !b.sku || !Number.isFinite(b.quantity) || !(b.quantity > 0) || overlapped.has(b)) continue;
    const run = batchRunMinutes(b, stops);
    if (run === null || run < MIN_RUN_MINUTES) continue;
    const spu = (run * 60) / b.quantity;
    if (!Number.isFinite(spu) || spu <= 0) continue;
    const k = fillKey(b.line, b.sku);
    const g = groups.get(k) ?? { line: b.line, sku: b.sku, name: b.name, samples: [] };
    g.samples.push({ batch: b.batch, date: b.date, quantity: b.quantity, runMinutes: Math.round(run), secondsPerUnit: spu, outlier: false });
    groups.set(k, g);
  }
  return [...groups.entries()].map(([key, g]) => {
    const sorted = g.samples.map((s) => s.secondsPerUnit).sort((a, b) => a - b);
    if (sorted.length >= 4) {
      const q1 = quantile(sorted, 0.25), q3 = quantile(sorted, 0.75), iqr = q3 - q1;
      for (const s of g.samples) s.outlier = s.secondsPerUnit < q1 - 1.5 * iqr || s.secondsPerUnit > q3 + 1.5 * iqr;
    }
    const kept = g.samples.filter((s) => !s.outlier).map((s) => s.secondsPerUnit);
    const std = kept.length ? median(kept) : null;
    const spread = std && kept.length > 1 ? (Math.max(...kept) - Math.min(...kept)) / std : null;
    g.samples.sort((a, b) => b.date.localeCompare(a.date));
    return { key, line: g.line, sku: g.sku, name: g.name, samples: g.samples, used: kept.length, standardSeconds: std, unitsPerHour: std ? 3600 / std : null, spread, ready: kept.length >= MIN_BATCHES };
  }).sort((a, b) => a.line.localeCompare(b.line, undefined, { numeric: true }) || a.sku.localeCompare(b.sku));
}
