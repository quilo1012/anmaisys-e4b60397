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
}

export function useDowntime() {
  return useQuery({
    queryKey: ["downtime"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("downtime" as any)
        .select("*")
        .order("started_at", { ascending: false });
      if (error) throw error;
      return data as unknown as DowntimeRecord[];
    },
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
