import { useCallback, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { fetchAllRows } from "@/lib/fetchAllRows";
import { leadersForShift, observedShifts, type ShiftFilter } from "@/lib/leaderShift";

export interface ActiveLeader { name: string; shift: string | null }

/** Active leaders plus the shifts each was seen opening a line on in the last 90 days. */
export function useLeaderShifts() {
  const leadersQuery = useQuery({
    queryKey: ["line_leaders_active"],
    queryFn: async () => {
      const { data, error } = await supabase.from("line_leaders").select("name, shift").eq("active", true).order("name");
      if (error) throw error;
      return (data ?? []) as ActiveLeader[];
    },
  });

  const sessionsQuery = useQuery({
    queryKey: ["leader_observed_shifts"],
    staleTime: 10 * 60_000,
    queryFn: async () => {
      const since = new Date(Date.now() - 90 * 86_400_000).toISOString().slice(0, 10);
      // The query is rebuilt per page: one builder reused across pages is the
      // unordered-pagination trap `fetchAllRows.ts` warns about.
      return fetchAllRows<{ leader_name: string | null; shift: string | null }>({
        range: (a, b) =>
          supabase.from("production_sessions").select("leader_name, shift")
            .gte("session_date", since).not("leader_name", "is", null)
            .order("id", { ascending: true }).range(a, b),
      });
    },
  });

  const leaders = leadersQuery.data ?? [];
  const sessionRows = sessionsQuery.data ?? [];

  const observed = useMemo(() => observedShifts(sessionRows), [sessionRows]);
  const forShift = useCallback((shift: ShiftFilter) => leadersForShift(leaders, observed, shift), [leaders, observed]);

  // Both lists settled. An empty array and a list that has not arrived are the same
  // value here, and only one of them means "the history is in" — until it is, every
  // leader falls back to the register, which is the thing this filter works around.
  const ready = leadersQuery.isSuccess && sessionsQuery.isSuccess;

  return { leaders, observed, forShift, ready };
}
