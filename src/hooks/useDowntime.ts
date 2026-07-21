import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface DowntimeRecord {
  id: string;
  line: string;
  machine: string | null;
  reason: string;
  category: string;
  started_at: string;
  ended_at: string | null;
  reported_by: string | null;
  work_order_id: string | null;
  notes: string | null;
  created_at: string;
  source?: "manual" | "wo_event";
  source_event_id?: string;
}

export function useDowntime() {
  return useQuery({
    queryKey: ["downtime"],
    queryFn: async () => {
      // Cap history at last 90 days — table grows indefinitely otherwise.
      const since = new Date(Date.now() - 90 * 24 * 3600 * 1000).toISOString();
      const [
        { data: manualData, error: manualError },
        { data: eventData, error: eventError },
        { data: woData, error: woError },
      ] = await Promise.all([
        supabase.from("downtime" as any).select("*").gte("started_at", since).order("started_at", { ascending: false }),
        (supabase as any)
          .from("downtime_events")
          .select("*, work_order:work_orders!inner(wo_number, wo_type, machine, line_at_time, line:lines!work_orders_line_id_fkey(name))")
          .neq("work_order.wo_type", "warehouse_service")
          .gte("stopped_at", since)
          .order("stopped_at", { ascending: false }),
        (supabase as any)
          .from("work_orders")
          .select("id, wo_type, machine, line_at_time, line_stopped_at, line_stopped_by, line_resumed_at, line_resumed_by, created_at, description, line:lines!work_orders_line_id_fkey(name)")
          .neq("wo_type", "warehouse_service")
          .not("line_stopped_at", "is", null)
          .gte("line_stopped_at", since)
          .order("line_stopped_at", { ascending: false }),
      ]);
      if (manualError) throw manualError;
      if (eventError) throw eventError;
      if (woError) throw woError;

      const prettifyLine = (raw: unknown): string => {
        const v = (raw ?? "").toString().trim();
        if (!v) return "— (line deleted)";
        if (/^removed$/i.test(v)) return "— (line deleted)";
        return v;
      };

      const manualRecords = (manualData || []).map((r: any) => ({
        ...r,
        line: prettifyLine(r.line),
        source: "manual" as const,
      })) as DowntimeRecord[];

      const eventRecords = (eventData || []).map((event: any) => {
        const wo = event.work_order;
        const liveName = wo?.line?.name as string | undefined;
        const snapshot = wo?.line_at_time as string | undefined;
        return {
          id: `event-${event.id}`,
          source_event_id: event.id,
          source: "wo_event" as const,
          line: liveName?.trim() || prettifyLine(snapshot),
          machine: wo?.machine || null,
          reason: event.stopped_reason || (event.is_recurrence ? "Recurring failure" : "Line stopped"),
          category: event.is_recurrence ? "Maintenance" : "Machine",
          started_at: event.stopped_at,
          ended_at: event.resumed_at,
          reported_by: event.stopped_by,
          work_order_id: event.work_order_id,
          notes: event.resumed_note || null,
          created_at: event.created_at,
        } as DowntimeRecord;
      });

      // Fallback: WOs that have line_stopped_at populated but no event row.
      // The downtime_events trigger isn't always firing — surface the WO row
      // directly so today's stoppages still appear in Downtime Records.
      const woIdsWithEvents = new Set(
        (eventData || []).map((e: any) => e.work_order_id),
      );
      const woRecords: DowntimeRecord[] = (woData || [])
        .filter((w: any) => !woIdsWithEvents.has(w.id))
        .map((w: any) => ({
          id: `wo-${w.id}`,
          source: "wo_event" as const,
          line: w.line?.name?.trim() || prettifyLine(w.line_at_time),
          machine: w.machine || null,
          reason: w.description || "Line stopped",
          category: "Machine",
          started_at: w.line_stopped_at,
          ended_at: w.line_resumed_at,
          reported_by: w.line_stopped_by,
          work_order_id: w.id,
          notes: null,
          created_at: w.created_at,
        }));

      return [...eventRecords, ...woRecords, ...manualRecords].sort(
        (a, b) => new Date(b.started_at).getTime() - new Date(a.started_at).getTime(),
      );
    },
    refetchInterval: 30_000,
  });
}

export function useCreateDowntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (record: Omit<DowntimeRecord, "id" | "created_at">) => {
      const { error } = await supabase.from("downtime" as any).insert(record as any);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downtime"] }),
  });
}

export function useUpdateDowntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: Partial<DowntimeRecord> & { id: string }) => {
      const { error } = await supabase.from("downtime" as any).update(updates as any).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downtime"] }),
  });
}

export function useDeleteDowntime() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("downtime" as any).delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => qc.invalidateQueries({ queryKey: ["downtime"] }),
  });
}
