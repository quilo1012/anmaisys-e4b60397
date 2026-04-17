import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Returns the count of work orders that currently have the line marked as stopped
 * AND have not yet been resumed. Engineers, managers, and admins can see this.
 */
export function useStoppedLinesCount() {
  const { role, user } = useAuth();
  const enabled = !!user && (role === "engineer" || role === "manager" || role === "admin");

  const query = useQuery({
    queryKey: ["stopped_lines_count"],
    queryFn: async () => {
      const { count, error } = await supabase
        .from("work_orders")
        .select("id", { count: "exact", head: true })
        .eq("line_stopped" as any, true)
        .is("line_resumed_at" as any, null);
      if (error) throw error;
      return count ?? 0;
    },
    enabled,
    refetchInterval: 30_000,
  });

  // Realtime: refresh on any work_orders change
  useEffect(() => {
    if (!enabled) return;
    const channel = supabase
      .channel(`stopped_lines_${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, () => {
        query.refetch();
      })
      .subscribe();
    return () => {
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return query;
}
