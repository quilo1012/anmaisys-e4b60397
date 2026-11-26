import * as XLSX from "xlsx";
import { TIME_MOTION, OTHER_MACHINES } from "@/lib/timeMotionMatrix";
import { fillSpeedMetrics, lineFillTimeKey, machineFillTimeKey, parseFillTime, type FillTimeOverrides } from "@/lib/fillSpeedMatrixEditor";

export const SHEET_NAME = "Fill speed matrix";
const HEADERS = ["Key", "Line / machine", "Pack", "Units per cycle", "Sheet fill time (s)", "Fill time (s)", "Per hour", "Per minute"] as const;

interface Entry { key: string; area: string; pack: string; unitsPerCycle: number; original: number; originalPerHour: number }

export function matrixEntries(): Entry[] {
  const out: Entry[] = [];
  for (const [l, rows] of Object.entries(TIME_MOTION)) for (const [kg, perHour, s] of rows)
    out.push({ key: lineFillTimeKey(Number(l), kg), area: `Line ${l}`, pack: kg < 1 ? `${Math.round(kg * 1000)} g` : `${kg} kg`, unitsPerCycle: 1, original: s, originalPerHour: perHour });
  for (const m of OTHER_MACHINES) for (const r of m.rows)
    out.push({ key: machineFillTimeKey(m.name, r.pack), area: m.name, pack: r.pack, unitsPerCycle: r.fillsPerCycle ?? 1, original: r.seconds, originalPerHour: r.perHour });
  return out;
}

export function exportRows(overrides: FillTimeOverrides): (string | number)[][] {
  return [HEADERS as unknown as string[], ...matrixEntries().map((e) => {
    const s = overrides[e.key] ?? e.original;
    const m = fillSpeedMetrics(s, e.original, e.originalPerHour, e.unitsPerCycle);
    return [e.key, e.area, e.pack, e.unitsPerCycle, e.original, s, Math.round(m.perHour), Math.round(m.perMinute * 10) / 10];
  })];
}

export function downloadMatrixWorkbook(overrides: FillTimeOverrides) {
  const ws = XLSX.utils.aoa_to_sheet(exportRows(overrides));
  ws["!cols"] = [{ wch: 28 }, { wch: 20 }, { wch: 12 }, { wch: 14 }, { wch: 18 }, { wch: 14 }, { wch: 12 }, { wch: 12 }];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, SHEET_NAME);
  XLSX.writeFile(wb, `fill-speed-matrix-${new Date().toISOString().slice(0, 10)}.xlsx`);
}

export interface ImportResult { overrides: FillTimeOverrides; updated: number; skipped: string[] }

/** Read the Key and Fill time (s) columns back; unknown keys and invalid times are skipped, never guessed. */
export function importRows(rows: unknown[][]): ImportResult {
  const header = (rows[0] ?? []).map((c) => String(c ?? "").trim());
  const ki = header.indexOf("Key"), si = header.indexOf("Fill time (s)");
  if (ki < 0 || si < 0) throw new Error('The sheet needs the "Key" and "Fill time (s)" columns from the export.');
  const known = new Map(matrixEntries().map((e) => [e.key, e]));
  const overrides: FillTimeOverrides = {}; const skipped: string[] = []; let updated = 0;
  rows.slice(1).forEach((r, i) => {
    const key = String(r[ki] ?? "").trim(); if (!key) return;
    const e = known.get(key); const s = parseFillTime(String(r[si] ?? ""));
    if (!e || s === null) { skipped.push(`Row ${i + 2}: ${!e ? `unknown key "${key}"` : "invalid fill time"}`); return; }
    if (Math.abs(s - e.original) > 0.000001) overrides[key] = s;
    updated++;
  });
  return { overrides, updated, skipped };
}

export async function readMatrixWorkbook(file: File): Promise<ImportResult> {
  const wb = XLSX.read(await file.arrayBuffer());
  const ws = wb.Sheets[SHEET_NAME] ?? wb.Sheets[wb.SheetNames[0]];
  return importRows(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false }));
}
