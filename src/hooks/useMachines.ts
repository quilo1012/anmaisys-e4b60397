import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export interface Machine {
  id: string;
  name: string;
  line: string;
  sector: string;
  code: string;
  status: string;
  health_score: number;
  machine_type: string;
  current_location: string;
  last_maintenance_date: string | null;
  created_at: string;
}

export interface MachineLocationLog {
  id: string;
  machine_id: string;
  from_location: string;
  to_location: string;
  moved_by: string | null;
  created_at: string;
}

const MACHINE_TYPES = ["Sealer", "Printer", "Labeler", "Conveyor", "Filler", "Wrapper", "Cutter", "Mixer", "Other"];
const LOCATIONS = ["Line A", "Line B", "Line C", "Storage", "Maintenance Area"];

export { MACHINE_TYPES, LOCATIONS };

export function useMachines() {
  return useQuery({
    queryKey: ["machines"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("machines")
        .select("*")
        .order("name");
      if (error) throw error;
      return data as unknown as Machine[];
    },
  });
}

export function useAddMachine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (machine: { name: string; line?: string; sector?: string; code?: string; status?: string; machine_type?: string; current_location?: string }) => {
      const { data, error } = await supabase.from("machines").insert(machine).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["machines"] }),
  });
}

export function useUpdateMachine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: { id: string; name?: string; line?: string; sector?: string; code?: string; status?: string; machine_type?: string; current_location?: string }) => {
      const { error } = await supabase.from("machines").update(updates).eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["machines"] }),
  });
}

export function useDeleteMachine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (id: string) => {
      const { error } = await supabase.from("machines").delete().eq("id", id);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["machines"] }),
  });
}

export function useMoveMachine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ machineId, fromLocation, toLocation }: { machineId: string; fromLocation: string; toLocation: string }) => {
      // Log the move
      const { error: logError } = await supabase.from("machine_location_log").insert({
        machine_id: machineId,
        from_location: fromLocation,
        to_location: toLocation,
        moved_by: (await supabase.auth.getUser()).data.user?.id,
      } as any);
      if (logError) throw logError;
      // Update machine location
      const { error } = await supabase.from("machines").update({ current_location: toLocation } as any).eq("id", machineId);
      if (error) throw error;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["machines"] });
      queryClient.invalidateQueries({ queryKey: ["machine_location_log"] });
    },
  });
}

export function useMachineLocationLog(machineId?: string) {
  return useQuery({
    queryKey: ["machine_location_log", machineId],
    enabled: !!machineId,
    queryFn: async () => {
      const { data, error } = await supabase
        .from("machine_location_log" as any)
        .select("*")
        .eq("machine_id", machineId!)
        .order("created_at", { ascending: false });
      if (error) throw error;
      return data as unknown as MachineLocationLog[];
    },
  });
}
