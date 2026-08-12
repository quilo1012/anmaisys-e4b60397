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
  lines, from, to, shift, leader,
}: {
  lines: LineRow[];
  /** ISO dates, inclusive. */
  from: string;
  to: string;
  shift?: "ALL" | "DAY" | "NIGHT";
  /**
   * Narrows every column to one leader's work. Null is the whole factory.
   *
   * It has to reach all of them or none: `lines` already arrives filtered by the
   * screen above, so leaving the queries here open put a leader's output next to
   * the factory's scrap in the same row, with nothing saying which was which.
   */
  leader?: string | null;
}) {
  const { data: quality = [] } = useQuery({
    queryKey: ["line-ind-quality", from, to, shift, leader],
    queryFn: async () => {
      const window = shiftDateFetchRange(from, to);
      let q = db.from("quality_actions")
        .select("line, severity, validation_status, closed_at, labels, shift, recorded_at")
        .gte("recorded_at", window.gte).lte("recorded_at", window.lte);
      if (shift && shift !== "ALL") q = q.eq("shift", shift);
      if (leader) q = q.eq("leader_name", leader);
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
    queryKey: ["line-ind-scrap", from, to, shift, leader],
    queryFn: async () => {
      let q = db.from("production_items")
        .select("actual_qty, scrap_qty, production_sessions!inner(line, session_date, shift, staff_actual)")
        .gte("production_sessions.session_date", from)
        .lte("production_sessions.session_date", to);
      if (shift && shift !== "ALL") q = q.eq("production_sessions.shift", shift);
      if (leader) q = q.eq("production_sessions.leader_name", leader);
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

  /**
   * O somatório, ao fundo.
   *
   * Um livro de fábrica fecha sempre as colunas: sem ele, quem quer saber o que a
   * fábrica planeou e o que fez tem de somar oito linhas de cabeça, e é essa a
   * primeira pergunta que se faz a uma tabela por linha. A atingimento é a razão dos
   * totais e não a média das razões — nove linhas pequenas não valem tanto como uma
   * linha grande, e uma média simples diria que sim.
   */
  const totals = useMemo(() => {
    const target = rows.reduce((a, r) => a + r.target, 0);
    const actual = rows.reduce((a, r) => a + r.actual, 0);
    return {
      target, actual,
      eff: target > 0 ? (actual / target) * 100 : 0,
      qualityPoints: rows.reduce((a, r) => a + r.qualityPoints, 0),
      openActions: rows.reduce((a, r) => a + r.openActions, 0),
    };
  }, [rows]);

  return (
    <Card className="break-inside-avoid">
      <CardHeader className="pb-3">
        <CardTitle className="text-base">
          Line indicators
          {leader && <span className="ml-2 text-sm font-normal text-muted-foreground">· {leader} only</span>}
        </CardTitle>
        <CardDescription>
          Everything this system measures per line, for the period above. What it does not measure is
          listed underneath — that list is the work, not an omission.
          {/* Said out loud because the numbers look factory-wide until you know they are not. */}
          {leader && ` Every figure below counts only the shifts ${leader} led.`}
        </CardDescription>
      </CardHeader>
      <CardContent className="space-y-3">
        <div className="overflow-x-auto">
          {/* O livro da fábrica: chapas em caixa alta, algarismos tabulares, e as
              colunas fechadas no fim. A face de algarismos é a mesma dos cartões — as
              colunas só se comparam de relance se os dígitos tiverem todos a mesma
              largura. */}
          <table className="w-full min-w-[46rem] text-left text-xs">
            <thead>
              <tr className="border-b border-border">
                {["Line", "Plan", "Produced", "Attainment", "Scrap", "Quality pts", "Open actions", "Team size"].map((h, i) => (
                  <th
                    key={h}
                    className={cn(
                      "py-2.5 font-display text-2xs font-bold uppercase tracking-[0.1em] text-muted-foreground",
                      i === 0 ? "pr-2" : "px-2 text-right",
                      i === 7 && "pl-2 pr-0",
                    )}
                  >
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-border/60">
              {rows.map((r) => (
                <tr key={r.line} className="transition-colors hover:bg-muted/40">
                  <td className="py-2.5 pr-2 font-display font-bold uppercase tracking-[0.02em] text-foreground">{r.line}</td>
                  <td className="px-2 py-2.5 text-right font-figure text-muted-foreground">{r.target.toLocaleString()}</td>
                  <td className="px-2 py-2.5 text-right font-figure font-bold text-foreground">{r.actual.toLocaleString()}</td>
                  <td className={cn("px-2 py-2.5 text-right font-figure font-bold",
                    r.target === 0 ? "text-muted-foreground"
                      : r.eff >= 100 ? "text-success-strong" : r.eff >= 80 ? "text-warning-strong" : "text-destructive-strong")}>
                    {r.target > 0 ? `${Math.round(r.eff)}%` : "—"}
                  </td>
                  <td className="px-2 py-2.5 text-right font-figure">
                    {r.scrapPct === null
                      ? <span className="font-sans text-muted-foreground" title={`Recorded on ${r.scrapCoverage} items`}>not recorded</span>
                      : <span className={cn(r.scrapPct > 2 && "font-bold text-destructive-strong")}>{r.scrapPct.toFixed(1)}%</span>}
                  </td>
                  <td className="px-2 py-2.5 text-right font-figure">{r.qualityPoints}</td>
                  <td className={cn("px-2 py-2.5 text-right font-figure", r.openActions && "font-bold text-warning-strong")}>
                    {r.openActions}
                  </td>
                  <td className="py-2.5 pl-2 text-right font-figure">
                    {r.staff ?? <span className="font-sans text-muted-foreground">—</span>}
                  </td>
                </tr>
              ))}
              {rows.length === 0 && (
                <tr><td colSpan={8} className="py-6 text-center text-muted-foreground">Nothing planned or logged in this period.</td></tr>
              )}
            </tbody>
            {rows.length > 0 && (
              <tfoot>
                <tr className="border-t-2 border-border">
                  <td className="py-2.5 pr-2 font-display text-2xs font-bold uppercase tracking-[0.1em] text-muted-foreground">All lines</td>
                  <td className="px-2 py-2.5 text-right font-figure text-muted-foreground">{totals.target.toLocaleString()}</td>
                  <td className="px-2 py-2.5 text-right font-figure font-bold text-foreground">{totals.actual.toLocaleString()}</td>
                  <td className={cn("px-2 py-2.5 text-right font-figure font-bold",
                    totals.target === 0 ? "text-muted-foreground"
                      : totals.eff >= 100 ? "text-success-strong" : totals.eff >= 80 ? "text-warning-strong" : "text-destructive-strong")}>
                    {totals.target > 0 ? `${Math.round(totals.eff)}%` : "—"}
                  </td>
                  {/* Sucata não fecha: sem ela registada em todos os artigos, uma soma
                      seria uma percentagem de uma produção que não foi toda medida. */}
                  <td className="px-2 py-2.5 text-right font-sans text-muted-foreground">—</td>
                  <td className="px-2 py-2.5 text-right font-figure font-bold text-foreground">{totals.qualityPoints}</td>
                  <td className={cn("px-2 py-2.5 text-right font-figure font-bold", totals.openActions ? "text-warning-strong" : "text-foreground")}>
                    {totals.openActions}
                  </td>
                  <td className="py-2.5 pl-2 text-right font-sans text-muted-foreground">—</td>
                </tr>
              </tfoot>
            )}
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
