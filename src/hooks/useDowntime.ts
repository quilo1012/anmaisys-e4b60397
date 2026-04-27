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

      const prettifyLineManual = (raw: unknown): string => {
        const v = (raw ?? "").toString().trim();
        if (!v) return "— (line deleted)";
        if (/^removed$/i.test(v)) return "— (line deleted)";
        return v;
      };

      const manualRecords = (manualData || []).map((r: any) => ({
        ...r,
        line: prettifyLineManual(r.line),
        source: "manual" as const,
      })) as DowntimeRecord[];

      // Map legacy/placeholder values to a friendly label so deleted lines
      // are not surfaced as the literal token "Removed".
      const prettifyLine = (raw: unknown): string => {
        const v = (raw ?? "").toString().trim();
        if (!v) return "— (line deleted)";
        if (/^removed$/i.test(v)) return "— (line deleted)";
        return v;
      };

      const eventRecords = (eventData || []).map((event: any) => {
        const wo = event.work_order;
        // Prefer the live line name, fall back to the snapshot taken at WO
        // creation, and finally to a friendly "deleted" placeholder.
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
