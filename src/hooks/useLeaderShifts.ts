import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { leadersForShift, observedShifts, type ShiftFilter } from "@/lib/leaderShift";

export interface ActiveLeader { name: string; shift: string | null }

/** Active leaders plus the shifts each was seen opening a line on in the last 90 days. */
export function useLeaderShifts() {
  const { data: leaders = [] } = useQuery({
    queryKey: ["line_leaders_active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("line_leaders").select("name, shift").eq("active", true).order("name");
      if (error) throw error;
      return (data ?? []) as ActiveLeader[];
    },
  });

  const { data: sessionRows = [] } = useQuery({
    queryKey: ["leader_observed_shifts"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
      return fetchAllRows(
        supabase.from("production_sessions").select("leader_name, shift")
          .gte("session_date", since).not("leader_name", "is", null).order("id"),
      );
    },
  });

  const observed = useMemo(() => observedShifts(sessionRows), [sessionRows]);
  const forShift = useCallback((shift: ShiftFilter) => leadersForShift(leaders, observed, shift), [leaders, observed]);

  return { leaders, observed, forShift };
}
