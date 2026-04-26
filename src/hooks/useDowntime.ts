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
      const [{ data: manualData, error: manualError }, { data: eventData, error: eventError }] = await Promise.all([
        supabase.from("downtime" as any).select("*").order("started_at", { ascending: false }),
        (supabase as any)
          .from("downtime_events")
          .select("*, work_order:work_orders(wo_number, machine, line_at_time, line:lines(name))")
          .order("stopped_at", { ascending: false }),
      ]);
      if (manualError) throw manualError;
      if (eventError) throw eventError;

      const manualRecords = (manualData || []).map((r: any) => ({
        ...r,
        source: "manual" as const,
      })) as DowntimeRecord[];

      const eventRecords = (eventData || []).map((event: any) => {
        const wo = event.work_order;
        return {
          id: `event-${event.id}`,
          source_event_id: event.id,
          source: "wo_event" as const,
          line: wo?.line?.name || wo?.line_at_time || "Work order line",
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

      return [...eventRecords, ...manualRecords].sort(
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
