import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { MyBoardMark } from "@/lib/myAttendance";

// `my_board_marks` is newer than the generated types until they are regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * The fields of the signed-in person's own board rows that decide the hours the board
 * draws: "went home at", "came in at", and whether the row is the overtime bridge's.
 *
 * `null` while the function does not exist yet (PGRST202, BLOCO 153 not pasted): My
 * Attendance then keeps each ask's own hours rather than guess at the board's. As with
 * `my_attendance`, whose rows these are is decided by the database from the session.
 * Under the "my_attendance" key, so whatever refreshes that refreshes this.
 */
export function useMyBoardMarks(from: string, to: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my_attendance", "board-marks", user?.id, from, to],
    enabled: !!user && !!from && !!to,
    meta: { schemaOptional: true },
    queryFn: async (): Promise<MyBoardMark[] | null> => {
      const { data, error } = await db.rpc("my_board_marks", { p_from: from, p_to: to });
      if (error) {
        if ((error as { code?: string }).code === "PGRST202") return null;
        throw error;
      }
      return (data ?? []) as MyBoardMark[];
    },
  });
}
