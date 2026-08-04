import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { shiftSessionDate } from "@/lib/shifts";

export interface DayIssue {
  woNumber: number | null;
  problem: string;
  /** Seconds the line was down for this order, exclusions already applied. */
  downtimeSec: number | null;
  /** Seconds of active repair — pauses excluded. Same figure the MTTR average uses. */
  repairSec: number | null;
}

export interface DayShiftIssues {
  day: DayIssue[];
  night: DayIssue[];
}

/**
 * What actually happened on a line, on a day, split by shift.
 *
 * This is the raw material for the RAG daily comment. It reads `v_wo_metrics` rather
 * than measuring anything itself, because that view is what Avg Response and Avg MTTR
 * are built from — a second definition of "how long the repair took" would give the
 * comment box one number and the dashboard another, and whichever a manager saw last
 * would be the one they quoted.
 *
 * A stoppage is filed under the shift that was running when the line went down, not
 * when the order was raised or closed. A fault at 02:00 belongs to the night that
 * started the evening before, the same rule the rest of the factory uses.
 */
export function useDailyIssueSummary(from: string, to: string) {
  const { data = [], isLoading } = useQuery({
    queryKey: ["daily-issue-summary", from, to],
    queryFn: async () => {
      // A day either side: an order raised late on the last night is still the last
      // night's, and one raised just before midnight can belong to the day after.
      const pad = (iso: string, days: number) => {
        const d = new Date(`${iso}T00:00:00Z`);
        d.setUTCDate(d.getUTCDate() + days);
        return d.toISOString().slice(0, 10);
      };

      const { data: wos, error } = await (supabase as any)
        .from("work_orders")
        .select("id, wo_number, description, line_at_time, line_stopped_at, created_at, line:lines!work_orders_line_id_fkey(name)")
        .neq("wo_type", "warehouse_service")
        .gte("created_at", `${pad(from, -1)}T00:00:00.000Z`)
        .lte("created_at", `${pad(to, 1)}T23:59:59.999Z`)
        .limit(1000);
      if (error) throw error;

      const ids = (wos ?? []).map((w: any) => w.id);
      if (ids.length === 0) return [];

      // Downtime and repair come from different views on purpose.
      //
      // `v_wo_metrics.line_downtime_sec` is `line_resumed_at - line_stopped_at`, and
      // both are null on almost every order — it reads NULL for all but a handful, so
      // a summary built on it would print "down —" against every issue. The figure
      // the WO timeline shows is `v_wo_downtime_total`, which sums the actual
      // stoppages and subtracts the excluded overlap. That is the one people already
      // see on the order, so it is the one that belongs in the comment.
      const [{ data: metrics, error: mErr }, { data: totals, error: tErr }] = await Promise.all([
        (supabase as any).from("v_wo_metrics").select("id, active_repair_sec").in("id", ids),
        (supabase as any).from("v_wo_downtime_total").select("work_order_id, total_minutes").in("work_order_id", ids),
      ]);
      if (mErr) throw mErr;
      if (tErr) throw tErr;

      const byId = new Map<string, any>((metrics ?? []).map((m: any) => [m.id, m]));
      const downById = new Map<string, number>(
        (totals ?? []).map((t: any) => [t.work_order_id, t.total_minutes]),
      );

      return (wos ?? []).map((w: any) => {
        // The line went down before anyone raised an order, so the stop time is the
        // honest anchor. Orders with no line stop fall back to when they were raised.
        const anchor: string = w.line_stopped_at ?? w.created_at;
        const hour = Number(
          new Intl.DateTimeFormat("en-GB", {
            timeZone: "Europe/London", hour: "2-digit", hour12: false,
          }).format(new Date(anchor)),
        );
        const shift = hour >= 6 && hour < 18 ? "DAY" : "NIGHT";
        const m = byId.get(w.id);
        const downMin = downById.get(w.id);
        return {
          line: (w.line?.name ?? w.line_at_time ?? "").trim(),
          date: shiftSessionDate(anchor, shift),
          shift,
          woNumber: w.wo_number ?? null,
          problem: (w.description ?? "").trim() || "Not recorded",
          downtimeSec: downMin == null ? null : downMin * 60,
          repairSec: m?.active_repair_sec ?? null,
        };
      });
    },
  });

  /** Keyed `line|yyyy-mm-dd`. */
  const byLineDay = useMemo(() => {
    const map = new Map<string, DayShiftIssues>();
    for (const r of data as any[]) {
      if (!r.line || !r.date) continue;
      const key = `${r.line}|${r.date}`;
      if (!map.has(key)) map.set(key, { day: [], night: [] });
      const bucket = map.get(key)!;
      const issue: DayIssue = {
        woNumber: r.woNumber, problem: r.problem,
        downtimeSec: r.downtimeSec, repairSec: r.repairSec,
      };
      (r.shift === "NIGHT" ? bucket.night : bucket.day).push(issue);
    }
    return map;
  }, [data]);

  return { byLineDay, isLoading };
}

/** `1h 20m`, `45m`, or a dash when the clock never ran. */
export function formatDuration(sec: number | null | undefined): string {
  if (sec == null || sec < 0) return "—";
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.floor(mins / 60)}h ${String(mins % 60).padStart(2, "0")}m`;
}

/**
 * The summary as a single block of text, for the admin who would rather start from
 * it than retype it. Deliberately plain: it goes into a free-text field that ends up
 * in a weekly report, and formatting that survives a copy-paste is worth more than
 * formatting that looks good in one place.
 */
export function summaryToText(issues: DayShiftIssues): string {
  const section = (label: string, list: DayIssue[]) => {
    if (list.length === 0) return `${label}: no issues`;
    const lines = list.map(
      (i) => `  • ${i.problem} — down ${formatDuration(i.downtimeSec)}, repair ${formatDuration(i.repairSec)}` +
             (i.woNumber ? ` (WO-${i.woNumber})` : ""),
    );
    return `${label}:\n${lines.join("\n")}`;
  };
  return `${section("Day", issues.day)}\n${section("Night", issues.night)}`;
}
