import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface MachineEvent {
  id: string;
  machine_id: string | null;
  work_order_id: string | null;
  problem_description: string | null;
  action_taken: string | null;
  part_used: string | null;
  event_type: string;
  engineer_id: string | null;
  engineer_name: string | null;
  created_at: string;
}

export function useMachineEvents(machineId?: string) {
  return useQuery({
    queryKey: ["machine_events", machineId],
    queryFn: async () => {
      let q = supabase
        .from("machine_events")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(50);
      if (machineId) q = q.eq("machine_id", machineId);
      const { data, error } = await q;
      if (error) throw error;
      return data as MachineEvent[];
    },
    enabled: !!machineId || machineId === undefined,
  });
}

export function useRecentMachineEvents() {
  return useQuery({
    queryKey: ["machine_events", "recent_30d"],
    queryFn: async () => {
      const cutoff = new Date(Date.now() - 30 * 86400000).toISOString();
      const { data, error } = await supabase
        .from("machine_events")
        .select("*")
        .gte("created_at", cutoff)
        .order("created_at", { ascending: false })
        .limit(500);
      if (error) throw error;
      return data as MachineEvent[];
    },
  });
}

export function useCreateMachineEvent() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (event: {
      machine_id?: string | null;
      work_order_id?: string | null;
      problem_description?: string;
      action_taken?: string;
      part_used?: string;
      event_type?: string;
      engineer_id?: string | null;
      engineer_name?: string | null;
    }) => {
      const { data, error } = await supabase
        .from("machine_events")
        .insert(event as any)
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["machine_events"] });
    },
  });
}
