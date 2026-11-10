import { useQuery } from "@tanstack/react-query";
import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { coalesceCalls } from "@/lib/coalesceCalls";

/**
 * Returns the count of maintenance orders that currently have the line marked as stopped
 * AND have not yet been resumed. Engineers, managers, and admins can see this.
 */
export function useStoppedLinesCount() {
  const { role, user } = useAuth();
  const enabled = !!user && (role === "engineer" || (role === "manager" || role === "maintenance_manager") || role === "admin");

  const query = useQuery({
    queryKey: ["stopped_lines_count"],
    queryFn: async () => {
      const { count, error } = await (supabase
        .from("work_orders")
        .select("id", { count: "exact", head: true }) as any)
        .eq("line_stopped", true)
        .is("line_resumed_at", null)
        .not("status", "in", "(closed,finished,completed,force_closed)");
      if (error) throw error;
      return (count as number) ?? 0;
    },
    enabled,
    refetchInterval: 30_000,
  });

  // Realtime: refresh on any work_orders change — once per burst. `refetch()` cancels
  // the count already in flight, so a bulk update used to run one count per row.
  useEffect(() => {
    if (!enabled) return;
    const refresh = coalesceCalls(() => { query.refetch(); }, 500);
    const channel = supabase
      .channel(`stopped_lines_${Math.random().toString(36).slice(2, 8)}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "work_orders" }, () => refresh())
      .subscribe();
    return () => {
      refresh.cancel();
      supabase.removeChannel(channel);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  return query;
}
