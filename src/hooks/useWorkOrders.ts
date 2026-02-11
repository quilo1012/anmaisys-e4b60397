import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { useEffect } from "react";

export type WOStatus = "open" | "in_progress" | "completed" | "force_closed";

export interface WorkOrder {
  id: string;
  wo_number: number;
  line: string;
  machine: string;
  description: string;
  status: WOStatus;
  operator_id: string;
  engineer_id: string | null;
  closed_by: string | null;
  notified_engineers: string[];
  created_at: string;
  started_at: string | null;
  completed_at: string | null;
  operator?: { name: string };
  engineer?: { name: string };
  closer?: { name: string };
}

export function useWorkOrders(filter?: { operatorOnly?: boolean; statusIn?: WOStatus[] }) {
  const { user } = useAuth();
  const queryClient = useQueryClient();

  const query = useQuery({
    queryKey: ["work_orders", filter],
    queryFn: async () => {
      let q = supabase
        .from("work_orders")
        .select("*, operator:profiles!work_orders_operator_id_fkey(name), engineer:profiles!work_orders_engineer_id_fkey(name), closer:profiles!work_orders_closed_by_fkey(name)")
        .order("created_at", { ascending: false });

      if (filter?.operatorOnly && user) {
        q = q.eq("operator_id", user.id);
      }
      if (filter?.statusIn && filter.statusIn.length > 0) {
        q = q.in("status", filter.statusIn);
      }

      const { data, error } = await q;
      if (error) throw error;
      return data as unknown as WorkOrder[];
    },
    enabled: !!user,
  });

  // Realtime subscription
  useEffect(() => {
    const channel = supabase
      .channel("work_orders_changes")
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, () => {
        queryClient.invalidateQueries({ queryKey: ["work_orders"] });
      })
      .subscribe();

    return () => { supabase.removeChannel(channel); };
  }, [queryClient]);

  return query;
}

export function useCreateWorkOrder() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (wo: { line: string; machine: string; description: string }) => {
      const { data, error } = await supabase
        .from("work_orders")
        .insert({ ...wo, operator_id: user!.id })
        .select()
        .single();
      if (error) throw error;
      return data;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work_orders"] }),
  });
}

export function useStartWorkOrder() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (woId: string) => {
      const { error } = await supabase
        .from("work_orders")
        .update({ status: "in_progress" as WOStatus, engineer_id: user!.id, started_at: new Date().toISOString() })
        .eq("id", woId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work_orders"] }),
  });
}

export function useCompleteWorkOrder() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: async (woId: string) => {
      const { error } = await supabase
        .from("work_orders")
        .update({ status: "completed" as WOStatus, completed_at: new Date().toISOString() })
        .eq("id", woId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work_orders"] }),
  });
}

export function useForceCloseWorkOrder() {
  const queryClient = useQueryClient();
  const { user } = useAuth();

  return useMutation({
    mutationFn: async (woId: string) => {
      const { error } = await supabase
        .from("work_orders")
        .update({ status: "force_closed" as WOStatus, closed_by: user!.id, completed_at: new Date().toISOString() })
        .eq("id", woId);
      if (error) throw error;
    },
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["work_orders"] }),
  });
}

export function useWorkOrderById(id: string) {
  return useQuery({
    queryKey: ["work_orders", id],
    queryFn: async () => {
      const { data, error } = await supabase
        .from("work_orders")
        .select("*, operator:profiles!work_orders_operator_id_fkey(name), engineer:profiles!work_orders_engineer_id_fkey(name), closer:profiles!work_orders_closed_by_fkey(name)")
        .eq("id", id)
        .single();
      if (error) throw error;
      return data as unknown as WorkOrder;
    },
    enabled: !!id,
  });
}
