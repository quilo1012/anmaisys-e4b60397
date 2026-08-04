import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { severityPoints } from "@/lib/qualityConstants";
import { shiftDateFetchRange, shiftSessionDate } from "@/lib/shifts";
import { cn } from "@/lib/utils";

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- columns newer than the generated types
const db = supabase as any;

export interface LineRow {
  line: string;
  target: number;
  actual: number;
  eff: number;
}

/**
 * The indicators a line is actually measured on, and the ones nobody measures yet.
 *
 * A factory scorecard usually runs on seven or eight numbers: output against plan,
 * quality, scrap, rework, absence, safety, OEE. This shows the ones this system holds
 * and names the ones it does not, rather than filling the gaps with something
 * plausible. What is missing is the useful half of the picture — it is the list of
 * what to start recording.
 */
export function LineIndicators({
  lines, from, to, shift,
}: {
  lines: LineRow[];
  /** ISO dates, inclusive. */
  from: string;
  to: string;
  shift?: "ALL" | "DAY" | "NIGHT";
}) {
  const { data: quality = [] } = useQuery({
    queryKey: ["line-ind-quality", from, to, shift],
    queryFn: async () => {
      const window = shiftDateFetchRange(from, to);
      let q = db.from("quality_actions")
        .select("line, severity, validation_status, closed_at, labels, shift, recorded_at")
        .gte("recorded_at", window.gte).lte("recorded_at", window.lte);
      if (shift && shift !== "ALL") q = q.eq("shift", shift);
      const { data, error } = await q;
      if (error) throw error;
      return ((data ?? []) as Array<{ line: string | null; severity: string | null; validation_status: string | null; closed_at: string | null; shift: string | null; recorded_at: string }>)
        .filter((a) => {
          const day = shiftSessionDate(a.recorded_at, a.shift);
          return day >= from && day <= to;
        });
    },
  });

  const { data: items = [] } = useQuery({
    queryKey: ["line-ind-scrap", from, to, shift],
    queryFn: async () => {
      let q = db.from("production_items")
        .select("actual_qty, scrap_qty, production_sessions!inner(line, session_date, shift, staff_actual)")
        .gte("production_sessions.session_date", from)
        .lte("production_sessions.session_date", to);
      if (shift && shift !== "ALL") q = q.eq("production_sessions.shift", shift);
      const { data, error } = await q;
      if (error) throw error;
      return (data ?? []) as Array<{
        actual_qty: number | null; scrap_qty: number | null;
        production_sessions: { line: string | null; staff_actual: number | null } | null;
      }>;
    },
  });

  const rows = useMemo(() => {
    const byLine = new Map<string, {
      qualityPoints: number; openActions: number;
      scrap: number; scrapRecorded: number; itemsTotal: number; produced: number;
      staff: number[];
    }>();
    const seed = (l: string) => {
      if (!byLine.has(l)) byLine.set(l, { qualityPoints: 0, openActions: 0, scrap: 0, scrapRecorded: 0, itemsTotal: 0, produced: 0, staff: [] });
      return byLine.get(l)!;
    };

    for (const a of quality) {
      const l = (a.line ?? "").trim();
      if (!l) continue;
      // Rejected costs nothing, same rule as the leader's score.
      if (a.validation_status === "rejected") continue;
      const e = seed(l);
      e.qualityPoints += severityPoints(a.severity);
      if (!a.closed_at) e.openActions += 1;
    }

    for (const it of items) {
      const l = (it.production_sessions?.line ?? "").trim();
      if (!l) continue;
      const e = seed(l);
      e.itemsTotal += 1;
      e.produced += Number(it.actual_qty ?? 0);
      if (it.scrap_qty != null) { e.scrapRecorded += 1; e.scrap += Number(it.scrap_qty); }
      const staff = it.production_sessions?.staff_actual;
      if (staff != null) e.staff.push(Number(staff));
    }

    return lines.map((l) => {
      const e = byLine.get(l.line.trim());
      const scrapPct = e && e.produced > 0 && e.scrapRecorded > 0 ? (e.scrap / e.produced) * 100 : null;
      return {
        ...l,
        qualityPoints: e?.qualityPoints ?? 0,
        openActions: e?.openActions ?? 0,
        scrapPct,
        scrapCoverage: e ? `${e.scrapRecorded}/${e.itemsTotal}` : "0/0",
        staff: e && e.staff.length ? Math.round(e.staff.reduce((s, n) => s + n, 0) / e.staff.length) : null,
      };
    });
  }, [lines, quality, items]);

  const anyScrap = rows.some((r) => r.scrapPct !== null);

  return (
    <Card className="break-inside-avoid">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">Line indicators</CardTitle>
        <CardDescription>
          Everything this system measures per line, for the period above. What it does not measure is
          listed underneath — that list is the work, not an omission.
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead>
              <tr className="border-b text-2xs font-bold uppercase text-muted-foreground">
                <th className="py-2 pr-2">Line</th>
                <th className="py-2 px-2 text-right">Plan</th>
                <th className="py-2 px-2 text-right">Produced</th>
                <th className="py-2 px-2 text-right">Attainment</th>
                <th className="py-2 px-2 text-right">Scrap</th>
                <th className="py-2 px-2 text-right">Quality pts</th>
                <th className="py-2 px-2 text-right">Open actions</th>
                <th className="py-2 pl-2 text-right">Team size</th>
              </tr>
            </thead>
            <tbody className="divide-y font-medium">
              {rows.map((r) => (
                <tr key={r.line}>
                  <td className="py-2 pr-2 font-semibold">{r.line}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">{r.target.toLocaleString()}</td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">{r.actual.toLocaleString()}</td>
                  <td className={cn("py-2 px-2 text-right font-mono font-bold tabular-nums",
                    r.eff >= 100 ? "text-success-strong" : r.eff >= 80 ? "text-warning-strong" : "text-destructive-strong")}>
                    {r.target > 0 ? `${Math.round(r.eff)}%` : "—"}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">
                    {r.scrapPct === null
                      ? <span className="font-sans text-muted-foreground" title={`Recorded on ${r.scrapCoverage} items`}>not recorded</span>
                      : <span className={cn(r.scrapPct > 2 && "text-destructive-strong")}>{r.scrapPct.toFixed(1)}%</span>}
                  </td>
                  <td className="py-2 px-2 text-right font-mono tabular-nums">{r.qualityPoints}</td>
                  <td className={cn("py-2 px-2 text-right font-mono tabular-nums", r.openActions && "text-warning-strong font-bold")}>
                    {r.openActions}
                  </td>
                  <td className="py-2 pl-2 text-right font-mono tabular-nums">
                    {r.staff ?? <span className="font-sans text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Nothing planned or logged in this period.</td></tr>
              )}
            </tbody>
          </table>
        </div>

        {/* Named, not hidden. A director asking "do we have the data" deserves the
            honest half of the answer as much as the flattering half. */}
        <div className="rounded-lg border bg-muted/30 p-3">
          <p className="text-2xs font-bold uppercase tracking-wide text-muted-foreground">Not measured yet</p>
          <ul className="mt-1 space-y-0.5 text-xs text-muted-foreground">
            <li>
              <b>OEE, availability and speed</b> — no production session carries them. iTouching reports
              0% on its own screens, so there is nothing to read.
            </li>
            <li><b>Rework</b> — the system has no concept of a piece being remade.</li>
            <li><b>Safety</b> — no accidents, near misses or checks are recorded anywhere.</li>
            <li><b>Absence</b> — attendance is captured per person per day, but the workforce module is
              switched off; turning it on makes this column real.</li>
            {!anyScrap && (
              <li><b>Scrap</b> — the field went live today. It fills as shifts record it.</li>
            )}
          </ul>
        </div>
      </CardContent>
    </Card>
  );
}

export default LineIndicators;
