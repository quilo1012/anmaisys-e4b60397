import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * The team standing on a line right now, for the tablet logged into that line.
 *
 * The headcount board itself is staff-only, so this goes through the
 * `line_team_board` function: it checks the caller's login is bound to the
 * line being asked about, works out the running shift on the factory clock
 * (Day 06:00–18:00 London; before 06:00 is still last night), and returns
 * only names and statuses for that one column of today's board.
 */
export type LineTeamMember = {
  employee_name: string;
  status: string;
  is_leader: boolean;
  half_day: boolean;
  note: string | null;
  shift: string;
  on_date: string;
};

export function useLineTeamBoard(lineId: string | null | undefined) {
  return useQuery({
    queryKey: ["line-team-board", lineId],
    enabled: !!lineId,
    refetchInterval: 60_000,
    queryFn: async (): Promise<LineTeamMember[]> => {
      const { data, error } = await (supabase as any).rpc("line_team_board", {
        p_line_id: lineId,
      });
      if (error) throw error;
      return (data ?? []) as LineTeamMember[];
    },
  });
}
