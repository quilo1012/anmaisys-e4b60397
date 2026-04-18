import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

export type MachineSide = "A" | "B" | "common";

export interface Machine {
  id: string;
  name: string;
  line: string;
  line_id: string | null;
  side: MachineSide;
  sector: string;
  code: string;
  status: string;
  health_score: number;
  machine_type: string;
  current_location: string;
  last_maintenance_date: string | null;
  created_at: string;
}

export interface Line {
  id: string;
  name: string;
  has_sides: boolean;
  display_order: number;
}

export interface MachineLocationLog {
  id: string;
  machine_id: string;
  from_location: string;
  to_location: string;
  moved_by: string | null;
  created_at: string;
}

const DEFAULT_MACHINE_TYPES = [
  "Blender", "Mixer", "Conveyor", "Filler", "Capper", "Labeler",
  "Palletizer", "Packer", "Sealer", "Printer", "Cutter", "Compressor",
  "Pump", "Oven", "Cooler", "Wrapper", "Other",
];
const DEFAULT_LOCATIONS = ["Line A", "Line B", "Line C", "Storage", "Maintenance Area"];
const STATUS_OPTIONS = [
  { value: "active", label: "Active" },
  { value: "in_use", label: "In Use" },
  { value: "maintenance", label: "Maintenance" },
  { value: "idle", label: "Idle" },
];

const SIDE_OPTIONS: { value: MachineSide; label: string; short: string }[] = [
  { value: "A", label: "Side A", short: "A" },
  { value: "B", label: "Side B", short: "B" },
  { value: "common", label: "Shared (A & B)", short: "—" },
];

export { DEFAULT_MACHINE_TYPES, DEFAULT_LOCATIONS, STATUS_OPTIONS, SIDE_OPTIONS };

export function useLines() {
  return useQuery({
    queryKey: ["lines"],
    queryFn: async () => {
      const { data, error } = await (supabase as any)
        .from("lines")
        .select("*")
        .order("display_order");
      if (error) throw error;
      return data as Line[];
    },
  });
}

export function useDistinctMachineValues() {
  return useQuery({
    queryKey: ["machines_distinct_values"],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("machines")
        .select("machine_type, current_location");
      if (error) throw error;
      const types = new Set(DEFAULT_MACHINE_TYPES);
      const locations = new Set(DEFAULT_LOCATIONS);
      (data || []).forEach((m: any) => {
        if (m.machine_type?.trim()) types.add(m.machine_type.trim());
        if (m.current_location?.trim()) locations.add(m.current_location.trim());
      });
      return {
        machineTypes: Array.from(types).sort(),
        locations: Array.from(locations).sort(),
      };
    },
  });
}

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

type MachineInput = {
  name: string;
  line?: string;
  line_id?: string | null;
  side?: MachineSide;
  sector?: string;
  code?: string;
  status?: string;
  machine_type?: string;
  current_location?: string;
};

export function useAddMachine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async (machine: MachineInput) => {
      const { data, error } = await (supabase.from("machines") as any).insert(machine).select().single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["machines"] }),
  });
}

export function useUpdateMachine() {
  const queryClient = useQueryClient();
  return useMutation({
    mutationFn: async ({ id, ...updates }: MachineInput & { id: string }) => {
      const { error } = await (supabase.from("machines") as any).update(updates).eq("id", id);
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
      const { error: logError } = await supabase.from("machine_location_log").insert({
        machine_id: machineId,
        from_location: fromLocation,
        to_location: toLocation,
        moved_by: (await supabase.auth.getUser()).data.user?.id,
      } as any);
      if (logError) throw logError;
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

// Backward-compat: legacy LINES constant (some screens may still import it)
export const LINES = ["Line 1", "Line 2", "Line 3", "Line 4", "Line 5", "Line 6"];
