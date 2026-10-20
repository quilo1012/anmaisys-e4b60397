import { computeHeatmap, type HeatmapRecord, type Shift } from "@/lib/downtimeHeatmap";
import { isNoPlannedShift } from "@/lib/downtimeBuckets";
import { formatMinutes } from "@/lib/formatDuration";

export interface PatternReportRecord extends HeatmapRecord {
  reason?: string | null;
  category?: string | null;
  machine?: string | null;
}

export interface PatternReportScope {
  fromMs: number;
  toMs: number;
  lineFilter: string;
  shiftFilter: "all" | Shift;
}

// Test membership with the matrix itself: a stop may span more than one shift,
// and exclusions may split it into several pieces of the same source row.
export function patternReportRecords(records: PatternReportRecord[], scope: PatternReportScope) {
  return records.filter((r) => !isNoPlannedShift(r.reason, r.category)
    && computeHeatmap([r], scope.fromMs, scope.toMs, scope.lineFilter, scope.shiftFilter).grandTotalMinutes > 0);
}

const text = (value?: string | null) => (value ?? "").trim().replace(/\s+/g, " ");
const date = (ms: number) => new Date(ms).toLocaleString("en-GB", {
  timeZone: "Europe/London", day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit",
});

export function buildPatternWhatsAppReport(records: PatternReportRecord[], scope: PatternReportScope,
  selectedLines: string[], selectedCategories: string[]) {
  const eligible = patternReportRecords(records, scope).filter((r) => selectedLines.includes(r.line || "—")
    && selectedCategories.includes(text(r.category) || "Unspecified category"));
  if (!eligible.length) return "";
  const hm = computeHeatmap(eligible, scope.fromMs, scope.toMs, scope.lineFilter, scope.shiftFilter);
  const output = ["*PATTERN MATRIX – DOWNTIME REPORT*", `${date(scope.fromMs)} – ${date(scope.toMs)} (London)`,
    `Shift: ${scope.shiftFilter === "all" ? "Day & Night" : scope.shiftFilter}`,
    `Total downtime (wall-clock): ${formatMinutes(hm.grandTotalMinutes)}`];

  const categories = [...new Set(eligible.map((r) => text(r.category) || "Unspecified category"))].sort();
  for (const category of categories) {
    output.push("", `*${category}*`);
    for (const line of hm.lines) {
      const rows = eligible.filter((r) => (r.line || "—") === line && (text(r.category) || "Unspecified category") === category);
      if (!rows.length) continue;
      output.push("", `*${line}*`);
      const sources = new Map<string, PatternReportRecord[]>();
      rows.forEach((r, i) => {
        const key = String(r.source_row_id ?? r.id ?? `row-${i}`);
        sources.set(key, [...(sources.get(key) ?? []), r]);
      });
      for (const pieces of sources.values()) {
        const r = pieces[0];
        if (!r) continue;
        const duration = computeHeatmap(pieces, scope.fromMs, scope.toMs, scope.lineFilter, scope.shiftFilter).grandTotalMinutes;
        output.push(`• ${text(r.machine) ? `${text(r.machine)} — ` : ""}${text(r.reason) || "Problem description not recorded"} (${formatMinutes(duration)})`);
        if (text(r.notes)) output.push(`  Notes: ${text(r.notes)}`);
      }
    }
  }
  if (hm.grandSystemMinutes > 0) output.push("", "Includes automatically closed stop time; this is not evidence that the issue was resolved.");
  return output.join("\n");
}