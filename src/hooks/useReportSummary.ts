import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { shiftDateFetchRange, shiftSessionDate } from "@/lib/shifts";

export interface ReportSummary {
  production: { plan: number; actual: number; efficiencyPct: number | null; days: number };
  downtime: { minutes: number; stops: number; worstLine: string | null; worstMinutes: number };
  maintenance: { raised: number; closed: number; avgResponseMin: number | null; avgRepairMin: number | null };
  quality: { total: number; open: number; critical: number };
}

const avg = (xs: number[]) => (xs.length ? Math.round(xs.reduce((a, b) => a + b, 0) / xs.length / 60) : null);

/**
 * The four questions a period report answers, from one place.
 *
 * Production, downtime, maintenance and quality each had a screen that could export
 * its own corner of the week, and nowhere put them side by side — so "how did last
 * month go" meant opening four screens, setting four date ranges and hoping they
 * agreed. They did not always: until today each screen remembered its own period.
 *
 * Every figure here comes from the same source its own screen uses, deliberately.
 * A summary that computed its own numbers would be a fifth opinion, and the first
 * time it disagreed with the detail screen behind it nobody would trust either.
 */
export function useReportSummary(from: string, to: string, shift: "ALL" | "DAY" | "NIGHT") {
  return useQuery<ReportSummary>({
    queryKey: ["report-summary", from, to, shift],
    queryFn: async () => {
      const db = supabase as any;
      const window = shiftDateFetchRange(from, to);
      const inShift = (s: string | null) => shift === "ALL" || (s ?? "").toUpperCase() === shift;

      const [rag, wos, quality] = await Promise.all([
        // Plan and actual come from RAG Weekly, which is where the plan is agreed —
        // not from per-item targets, matching what Performance shows.
        db.from("rag_weekly_entries").select("entry_date, line, shift, plan_qty, actual_qty")
          .gte("entry_date", from).lte("entry_date", to),
        db.from("work_orders")
          .select("id, wo_number, status, created_at, closed_at, line_stopped_at, line_at_time, line:lines!work_orders_line_id_fkey(name)")
          .neq("wo_type", "warehouse_service")
          .gte("created_at", window.gte).lte("created_at", window.lte).limit(2000),
        db.from("quality_actions").select("id, severity, closed_at, recorded_at, shift")
          .gte("recorded_at", window.gte).lte("recorded_at", window.lte).limit(2000),
      ]);
      if (rag.error) throw rag.error;
      if (wos.error) throw wos.error;
      if (quality.error) throw quality.error;

      const ragRows = (rag.data ?? []).filter((r: any) => inShift(r.shift));
      const plan = ragRows.reduce((s: number, r: any) => s + Number(r.plan_qty ?? 0), 0);
      const actual = ragRows.reduce((s: number, r: any) => s + Number(r.actual_qty ?? 0), 0);

      // Orders are filed under the shift the line went down in, not when the order was
      // typed — the rule the rest of the factory uses.
      const woRows = (wos.data ?? []).filter((w: any) => {
        const anchor = w.line_stopped_at ?? w.created_at;
        const hour = Number(new Intl.DateTimeFormat("en-GB", {
          timeZone: "Europe/London", hour: "2-digit", hour12: false,
        }).format(new Date(anchor)));
        const s = hour >= 6 && hour < 18 ? "DAY" : "NIGHT";
        const day = shiftSessionDate(anchor, s);
        return day >= from && day <= to && inShift(s);
      });

      const ids = woRows.map((w: any) => w.id);
      const [totals, metrics] = ids.length
        ? await Promise.all([
            db.from("v_wo_downtime_total").select("work_order_id, total_minutes, stop_count").in("work_order_id", ids),
            db.from("v_wo_metrics").select("id, response_time_sec, active_repair_sec, status").in("id", ids),
          ])
        : [{ data: [], error: null }, { data: [], error: null }];

      // The three reads above throw on error. These two did not, and a failed read and
      // a quiet period are the same empty array — so a downtime view that could not be
      // read was reported as a period with no downtime in it: zero minutes, zero
      // stoppages, no worst line, a dash for the average response. Underneath, the page
      // promised that a dash means nothing was recorded, which is the one thing it did
      // not mean. Zero is an answer, and it has to be earned.
      if (totals.error) throw new Error(`v_wo_downtime_total: ${totals.error.message}`);
      if (metrics.error) throw new Error(`v_wo_metrics: ${metrics.error.message}`);

      const lineOf = new Map<string, string>(
        woRows.map((w: any) => [w.id, (w.line?.name ?? w.line_at_time ?? "—").trim()]),
      );
      const perLine = new Map<string, number>();
      let minutes = 0, stops = 0;
      for (const t of (totals.data ?? []) as any[]) {
        minutes += Number(t.total_minutes ?? 0);
        stops += Number(t.stop_count ?? 0);
        const line = lineOf.get(t.work_order_id) ?? "—";
        perLine.set(line, (perLine.get(line) ?? 0) + Number(t.total_minutes ?? 0));
      }
      const worst = [...perLine.entries()].sort((a, b) => b[1] - a[1])[0];

      // force_closed is excluded from the averages here for the same reason the
      // maintenance KPIs exclude it: nobody responded, so there is no response to time.
      const live = ((metrics.data ?? []) as any[]).filter((m) => m.status !== "force_closed");

      const qRows = ((quality.data ?? []) as any[]).filter((q) => {
        const day = shiftSessionDate(q.recorded_at, q.shift);
        return day >= from && day <= to && inShift(q.shift);
      });

      const days = new Set(ragRows.map((r: any) => r.entry_date)).size;

      return {
        production: {
          plan, actual,
          efficiencyPct: plan > 0 ? Math.round((actual / plan) * 100) : null,
          days,
        },
        downtime: {
          minutes, stops,
          worstLine: worst?.[0] ?? null,
          worstMinutes: worst?.[1] ?? 0,
        },
        maintenance: {
          raised: woRows.length,
          closed: woRows.filter((w: any) => ["closed", "completed", "finished"].includes(w.status)).length,
          avgResponseMin: avg(live.map((m) => m.response_time_sec).filter((n: number) => n != null && n >= 0)),
          avgRepairMin: avg(live.map((m) => m.active_repair_sec).filter((n: number) => n != null && n > 0)),
        },
        quality: {
          total: qRows.length,
          open: qRows.filter((q) => !q.closed_at).length,
          critical: qRows.filter((q) => (q.severity ?? "").toLowerCase() === "critical").length,
        },
      };
    },
    // No placeholder here, deliberately.
    //
    // It used to hand back a report of zeros while the reads were still in flight, and
    // a placeholder puts the query in `success` from the very first render — so the
    // page could not tell "still loading" from "a period in which nothing happened",
    // and neither could the person reading it. A summary showing zero downtime,
    // zero orders and zero quality actions is a strong claim about a week. It should
    // not be made before the answer has arrived.
  });
}
