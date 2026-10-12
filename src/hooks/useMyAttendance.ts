import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { MyAttendanceData } from "@/lib/myAttendance";

// `my_attendance` is newer than the generated types until they are regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type MyAttendanceResult =
  | { state: "ready"; data: MyAttendanceData }
  /** The login is not linked to an employee record yet. */
  | { state: "unlinked" }
  /** BLOCO 90 has not been pasted: the function does not exist yet. */
  | { state: "notSetUp" };

/**
 * The signed-in person's own attendance between two dates.
 *
 * No employee id is sent: whose record this is is decided by the database from the
 * session (`my_employee_id()`), so nothing in a URL or a request can point it at
 * somebody else. The user id is in the key only so that two people on one tablet
 * never share a cache entry — `useForgetPreviousUser` clears it on a change as well.
 */
export function useMyAttendance(from: string, to: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["my_attendance", user?.id, from, to],
    enabled: !!user && !!from && !!to,
    meta: { schemaOptional: true },
    // Keep last range's figures up while the next one loads — but never across people:
    // a placeholder from another login's key would be exactly the leak this page exists
    // to prevent.
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === user?.id ? prev : undefined),
    queryFn: async (): Promise<MyAttendanceResult> => {
      const { data, error } = await db.rpc("my_attendance", { p_from: from, p_to: to });
      if (error) {
        if ((error as { code?: string }).code === "PGRST202") return { state: "notSetUp" };
        throw error;
      }
      return data ? { state: "ready", data: data as MyAttendanceData } : { state: "unlinked" };
    },
  });
}
