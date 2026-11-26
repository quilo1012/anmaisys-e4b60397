import * as XLSX from "xlsx";
import ExcelJS from "exceljs";
import { bayColor } from "@/lib/lineBay";
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

function hslHex([h, sat, lum]: readonly number[], mix = 0): string {
  const S = sat / 100, L = lum / 100, a = S * Math.min(L, 1 - L);
  const f = (n: number) => { const k = (n + h / 30) % 12; const c = L - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); return Math.round((c + (1 - c) * mix) * 255).toString(16).padStart(2, "0"); };
  return `FF${f(0)}${f(8)}${f(4)}`.toUpperCase();
}

/** Same layout as the screen: one coloured block per line/machine, three blocks across. */
export async function buildMatrixWorkbook(overrides: FillTimeOverrides): Promise<Blob> {
  return new Blob([await buildMatrixBuffer(overrides)], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
}

export async function buildMatrixBuffer(overrides: FillTimeOverrides): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(SHEET_NAME, { views: [{ showGridLines: false }] });
  ws.getCell("A1").value = "Fill speed matrix";
  ws.getCell("A1").font = { name: "Arial", size: 16, bold: true };
  ws.getCell("A2").value = `Exported ${new Date().toLocaleString("en-GB")} · edit "Fill time (s)" and import back. Units/h and UPM recalculate on import.`;
  ws.getCell("A2").font = { name: "Arial", size: 9, color: { argb: "FF666666" } };
  const groups = new Map<string, Entry[]>();
  for (const e of matrixEntries()) groups.set(e.area, [...(groups.get(e.area) ?? []), e]);
  const WIDTH = 6, PER_ROW = 3; let top = 4, bandHeight = 0, col = 0;
  [...groups.entries()].forEach(([area, entries], i) => {
    if (i > 0 && i % PER_ROW === 0) { top += bandHeight + 2; bandHeight = 0; col = 0; }
    const c0 = 1 + col * WIDTH, bay = bayColor(area), ink = hslHex(bay), wash = hslHex(bay, 0.82);
    const unit = entries[0].unitsPerCycle > 1 ? `Units/h (${entries[0].unitsPerCycle}/cycle)` : area.startsWith("Line") ? "Tubs/h" : "Units/h";
    ws.mergeCells(top, c0, top, c0 + 3);
    const t = ws.getCell(top, c0); t.value = `${area}   ·   ${entries.length} ${entries.length === 1 ? "size" : "sizes"}`;
    for (let c = c0; c < c0 + 4; c++) { const x = ws.getCell(top, c); x.fill = { type: "pattern", pattern: "solid", fgColor: { argb: wash } }; x.border = { top: { style: "thick", color: { argb: ink } } }; }
    t.font = { name: "Arial", bold: true, size: 11 };
    ["Pack", unit, "UPM", "Fill time (s)"].forEach((h, k) => { const x = ws.getCell(top + 1, c0 + k); x.value = h; x.font = { name: "Arial", bold: true, size: 9, color: { argb: "FF666666" } }; x.alignment = { horizontal: k ? "right" : "left" }; x.border = { bottom: { style: "thin", color: { argb: "FFCCCCCC" } } }; });
    entries.forEach((e, r) => {
      const s = overrides[e.key] ?? e.original, m = fillSpeedMetrics(s, e.original, e.originalPerHour, e.unitsPerCycle), row = top + 2 + r;
      const vals: (string | number)[] = [e.pack, Math.round(m.perHour), Math.round(m.perMinute * 10) / 10, s, e.key];
      vals.forEach((v, k) => { const x = ws.getCell(row, c0 + k); x.value = v; x.font = { name: "Arial", size: 10, bold: k === 3, color: k === 4 ? { argb: "FFBBBBBB" } : undefined }; if (k === 1) x.numFmt = "#,##0"; if (k === 2) x.numFmt = "0.0"; if (k < 4) x.border = { bottom: { style: "hair", color: { argb: "FFE0E0E0" } } }; });
      if (m.edited) ws.getCell(row, c0 + 3).fill = { type: "pattern", pattern: "solid", fgColor: { argb: "FFFFF2CC" } };
    });
    bandHeight = Math.max(bandHeight, entries.length + 2);
    [11, 14, 8, 12, 4, 3].forEach((w, k) => (ws.getColumn(c0 + k).width = k === 4 ? 4 : w));
    ws.getColumn(c0 + 4).hidden = true;
    col++;
  });
  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

export async function downloadMatrixWorkbook(overrides: FillTimeOverrides) {
  const blob = await buildMatrixWorkbook(overrides);
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = `fill-speed-matrix-${new Date().toISOString().slice(0, 10)}.xlsx`;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

/** Read the screen-style export: every key cell carries its fill time in the cell to its left. */
export function importGrid(grid: unknown[][]): ImportResult {
  const flat: unknown[][] = [["Key", "Fill time (s)"]];
  for (const row of grid) row?.forEach((v, c) => { if (typeof v === "string" && /^(line|machine):/.test(v) && c > 0) flat.push([v, row[c - 1]]); });
  if (flat.length > 1) return importRows(flat);
  return importRows(grid);
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
  return importGrid(XLSX.utils.sheet_to_json<unknown[]>(ws, { header: 1, raw: false }));
}
