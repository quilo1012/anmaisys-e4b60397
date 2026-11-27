import { batchRunMinutes, type BatchRun, type StopWindow } from "@/lib/batchFillStandards";
import { fillKey } from "@/lib/approvedFillTimes";

export type Shift = "Day" | "Night";
export interface ShiftHours { dayStart: number; dayEnd: number }
export const DEFAULT_SHIFT_HOURS: ShiftHours = { dayStart: 6, dayEnd: 18 };
const londonHour = (iso: string) => {
  const p = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(new Date(iso));
  return Number(p.find((x) => x.type === "hour")?.value) + Number(p.find((x) => x.type === "minute")?.value) / 60;
};
/** Day = batch started (London time) inside [dayStart, dayEnd), otherwise Night. */
export function shiftOfStart(iso: string, hours: ShiftHours = DEFAULT_SHIFT_HOURS): Shift {
  const h = londonHour(iso);
  return h >= hours.dayStart && h < hours.dayEnd ? "Day" : "Night";
}

export interface BatchRow { run: BatchRun; shift: Shift; totalMinutes: number; stopMinutes: number | null; runMinutes: number | null; secondsPerUnit: number | null }

export function reviewBatches(runs: BatchRun[], stops: StopWindow[], hours: ShiftHours = DEFAULT_SHIFT_HOURS): BatchRow[] {
  return runs.filter((r) => Date.parse(r.startedAt) && Date.parse(r.finishedAt) > Date.parse(r.startedAt)).map((run) => {
    const total = (Date.parse(run.finishedAt) - Date.parse(run.startedAt)) / 60000;
    const rm = batchRunMinutes(run, stops);
    return { run, shift: shiftOfStart(run.startedAt, hours), totalMinutes: total, runMinutes: rm, stopMinutes: rm == null ? null : total - rm, secondsPerUnit: rm != null && rm > 0 && run.quantity > 0 ? (rm * 60) / run.quantity : null };
  }).sort((a, b) => b.run.startedAt.localeCompare(a.run.startedAt));
}

/** Percent the real time is slower (+) or faster (−) than the standard. */
export function deviationPct(standard: number | null | undefined, real: number | null | undefined): number | null {
  if (!standard || !real || standard <= 0 || real <= 0) return null;
  return Math.round(((real - standard) / standard) * 1000) / 10;
}

export interface ShiftStandard { key: string; line: string; sku: string; name: string | null; shift: Shift; batches: number; medianSeconds: number }

/** Median real seconds per unit per line, SKU and shift. */
export function shiftStandards(rows: BatchRow[]): ShiftStandard[] {
  const g = new Map<string, { r: BatchRow; v: number[] }>();
  for (const r of rows) {
    if (r.secondsPerUnit == null || (r.runMinutes ?? 0) < 5) continue;
    const k = `${fillKey(r.run.line, r.run.sku)}|${r.shift}`;
    const e = g.get(k) ?? { r, v: [] };
    e.v.push(r.secondsPerUnit); g.set(k, e);
  }
  return [...g.entries()].map(([k, { r, v }]) => {
    const s = [...v].sort((a, b) => a - b), m = Math.floor(s.length / 2);
    return { key: k, line: r.run.line, sku: r.run.sku, name: r.run.name, shift: r.shift, batches: s.length, medianSeconds: Math.round((s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2) * 100) / 100 };
  }).sort((a, b) => a.line.localeCompare(b.line) || a.sku.localeCompare(b.sku) || a.shift.localeCompare(b.shift));
}
