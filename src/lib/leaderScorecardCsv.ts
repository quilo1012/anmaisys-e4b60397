import { format } from "date-fns";
import { displayScore } from "@/lib/leaderScore";
import type { ScorecardPeriod, ScorecardResult } from "@/lib/leaderScorecard";

/**
 * The card as a spreadsheet, for whoever has to keep a copy of it.
 *
 * Shared by the manager's dialog and the leader's own screen so an export taken from
 * either is the same document — which is the point of a record a leader may be asked
 * to sign.
 */
export function scorecardRows(
  leaderName: string | null,
  period: ScorecardPeriod,
  result: ScorecardResult,
  nameOf: (id: string | null) => string,
): string[][] {
  const { quality: q, docs, production: p, score, woRequests } = result;
  return [
    ["Leader", leaderName ?? ""],
    ["Period", `${period.from} → ${period.to}`],
    ["Shift", period.shift === "all" ? "All shifts" : period.shift],
    [],
    ["QUALITY"],
    ["Total actions", String(q.total)], ["Open", String(q.open)], ["Completed", String(q.completed)], ["% closed", `${q.pctClosed}%`],
    ["Avg resolution (days)", q.avgResolution == null ? "—" : q.avgResolution.toFixed(1)],
    ["Final score", score.final === null ? "—" : `${displayScore(score.final)}%`],
    ["  Production component", score.production.value === null ? "—" : `${displayScore(score.production.value)}% (weight ${score.applied.production_pct}%) — ${score.production.basis}`],
    ["  Quality component", score.quality.value === null ? "—" : `${displayScore(score.quality.value)}% (weight ${score.applied.quality_pct}%) — ${score.quality.basis}`],
    ["  Documentation component", `${displayScore(score.documentation.value)}% (weight ${score.applied.documentation_pct}%) — ${score.documentation.basis}`],
    [],
    ["Documentation score", `${docs.score}%`],
    ["Validated Paperwork actions", String(docs.penalised.length)],
    ["Documentation impact", `-${docs.impactPct}%`],
    ["Paperwork under review (not counted)", String(docs.pending.length)],
    ["Paperwork under review, potential impact", `-${docs.pendingImpactPct}%`],
    ["Paperwork rejected (not counted)", String(docs.rejected.length)],
    [],
    ["VALIDATED DOCUMENTATION ERRORS"],
    ["Action", "Line", "Shift", "Raised", "Validated", "Validated by", "Evidence files", "Penalty", "Description"],
    ...docs.penalised.map((a) => [
      a.action_no || a.id.slice(0, 8),
      a.line ?? "", a.shift ?? "",
      format(new Date(a.recorded_at), "dd/MM/yyyy"),
      a.validated_at ? format(new Date(a.validated_at), "dd/MM/yyyy HH:mm") : "",
      nameOf(a.validated_by),
      String(a.attachments?.length ?? 0),
      `-${docs.penaltyPct}%`,
      (a.description ?? "").replace(/"/g, "'"),
    ]),
    [],
    ["Critical", String(q.sev.critical)], ["High", String(q.sev.high)], ["Medium", String(q.sev.medium)], ["Low", String(q.sev.low)],
    [],
    ["PRODUCTION"],
    ["Sessions", String(p.sessions)],
    ["Output (good)", String(p.output)], ["Attainment", p.attainment == null ? "—" : `${p.attainment}%`],
    // These are number | null — strictNullChecks is off in this project, so
    // `.toFixed()` on the null typechecked fine and threw at runtime instead. No
    // session this month reports down_time_min, so the export crashed for every leader.
    ["Run time (h)", p.runtimeH == null ? "—" : p.runtimeH.toFixed(1)],
    [],
    ["MAINTENANCE CALLED BY THIS LEADER"],
    ["WO", "Raised", "Line", "Status", "Line stopped", "Description"],
    ...(woRequests.length
      ? woRequests.map((w) => [
          w.wo_number ? `WO-${new Date(w.created_at).getFullYear()}-${String(w.wo_number).padStart(6, "0")}` : "—",
          format(new Date(w.created_at), "dd/MM/yyyy HH:mm"),
          w.line_at_time ?? "",
          (w.status ?? "").replace(/_/g, " "),
          w.line_stopped ? "Yes" : "No",
          (w.description ?? "").replace(/"/g, "'"),
        ])
      : [["—", "", "", "", "", "No work order raised in this period"]]),
  ];
}

export function downloadScorecardCsv(
  leaderName: string | null,
  period: ScorecardPeriod,
  result: ScorecardResult,
  nameOf: (id: string | null) => string,
) {
  const csv = scorecardRows(leaderName, period, result, nameOf)
    .map((r) => r.map((c) => `"${c}"`).join(","))
    .join("\n");
  const blob = new Blob([csv], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = `leader-${(leaderName ?? "x").replace(/\s+/g, "_")}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}
