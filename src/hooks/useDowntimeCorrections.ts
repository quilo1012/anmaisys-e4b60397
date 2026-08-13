import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DowntimeCorrection {
  id: string;
  downtime_event_id: string;
  work_order_id: string;
  corrected_by: string | null;
  corrected_by_name: string;
  corrected_at: string;
  prev_stopped_at: string;
  prev_resumed_at: string | null;
  prev_duration_minutes: number | null;
  new_stopped_at: string;
  new_resumed_at: string | null;
  new_duration_minutes: number | null;
  reason: string;
}

/** Every correction made to this order's stoppages, oldest → newest. */
export function useDowntimeCorrections(workOrderId: string | undefined) {
  return useQuery({
    queryKey: ["downtime_corrections", workOrderId],
    queryFn: async () => {
      if (!workOrderId) return [] as DowntimeCorrection[];
      const { data, error } = await (supabase as any)
        .from("downtime_corrections")
        .select("*")
        .eq("work_order_id", workOrderId)
        .order("corrected_at", { ascending: true });
      if (error) throw error;
      return (data || []) as DowntimeCorrection[];
    },
    enabled: !!workOrderId,
  });
}

export interface CorrectDowntimeArgs {
  eventId: string;
  workOrderId: string;
  stoppedAt: string;
  resumedAt: string | null;
  minutes: number | null;
  reason: string;
}

/**
 * Correct a recorded stoppage. All validation lives in the RPC; the dialog only
 * pre-checks so the button can be disabled before a round trip.
 */
export function useCorrectDowntime() {
  const qc = useQueryClient();

  return useMutation({
    mutationFn: async (args: CorrectDowntimeArgs) => {
      const { data, error } = await (supabase as any).rpc("correct_downtime_event", {
        _event_id: args.eventId,
        _stopped_at: args.stoppedAt,
        _resumed_at: args.resumedAt,
        _minutes: args.minutes,
        _reason: args.reason,
      });
      if (error) throw error;
      return data as {
        wo_number: string | null;
        prev_minutes: number | null;
        new_minutes: number | null;
        corrected_by_name: string;
      };
    },
    onSuccess: (_data, args) => {
      // Everything that reads a downtime figure, so the Production Impact card and
      // the boards stop disagreeing with the history table the moment it changes.
      const keys = [
        ["downtime_events", args.workOrderId],
        ["downtime_corrections", args.workOrderId],
        ["downtime_totals"],
        ["downtime-events"],
        ["downtime"],
        ["shift-downtime"],
        ["wo-metrics"],
        ["wo_metrics", args.workOrderId],
        ["work_orders"],
        ["report-summary"],
      ];
      for (const key of keys) qc.invalidateQueries({ queryKey: key });
    },
  });
}

export interface DowntimeCorrectionRow extends DowntimeCorrection {
  /** Current start of the stoppage on record (downtime_events), if it still exists. */
  stopped_at: string | null;
  wo_number: string | null;
  machine: string | null;
  line_at_time: string | null;
  line_name: string | null;
}

/**
 * Every correction whose STOPPAGE started inside [from, to] — filed under the day
 * the line stopped, not the day someone typed the correction. Range filtering and
 * the line filter live in `src/lib/downtimeCorrectionsRange.ts`; this hook only
 * fetches a generous window and hands the rows over.
 */
export function useDowntimeCorrectionsInRange(from: Date, to: Date) {
  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  return useQuery({
    queryKey: ["downtime_corrections_range", fromIso, toIso],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("downtime_corrections")
        .select(
          "*, work_order:work_orders!downtime_corrections_work_order_id_fkey(wo_number, machine, line_at_time, line:lines!work_orders_line_id_fkey(name)), event:downtime_events!downtime_corrections_downtime_event_id_fkey(stopped_at)",
        )
        .order("corrected_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return ((data || []) as any[]).map((r) => ({
        ...r,
        stopped_at: r.event?.stopped_at ?? r.new_stopped_at ?? null,
        wo_number: r.work_order?.wo_number ?? null,
        machine: r.work_order?.machine ?? null,
        line_at_time: r.work_order?.line_at_time ?? null,
        line_name: r.work_order?.line?.name ?? null,
      })) as DowntimeCorrectionRow[];
    },
  });
}
