import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { MyOvertimeShiftRecord } from "@/lib/myAttendance";

// The embedded select below is not in the generated types' shape.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

/**
 * The overtime shifts this person was booked on between two dates, with what the
 * supervisor recorded about each — for My Attendance, beside the clock's figure.
 *
 * Filtered on `employee_id` here and not only by policy: `overtime_responses_read`
 * lets an admin read everybody's answers, and an admin's own My Attendance must still
 * be theirs alone. Cancelled asks are left out, as everywhere on the floor's screens.
 *
 * Under the "overtime_responses" key, so every answer, cancellation and outcome the
 * overtime mutations refresh reaches this too.
 */
export function useMyOvertimeShifts(employeeId: string | null | undefined, from: string, to: string) {
  const { user } = useAuth();
  return useQuery({
    queryKey: ["overtime_responses", "my-shifts", user?.id, employeeId, from, to],
    enabled: !!user && !!employeeId && !!from && !!to,
    queryFn: async (): Promise<MyOvertimeShiftRecord[]> => {
      const { data, error } = await db
        .from("overtime_responses")
        .select("id, overtime_requests!inner(on_date, starts_at, ends_at, status)")
        .eq("employee_id", employeeId)
        .eq("decision", "accepted")
        .gte("overtime_requests.on_date", from)
        .lte("overtime_requests.on_date", to)
        .neq("overtime_requests.status", "cancelled");
      if (error) throw error;
      const rows = (data ?? []) as {
        id: string;
        overtime_requests: { on_date: string; starts_at: string; ends_at: string } | null;
      }[];
      const ids = rows.map((r) => r.id);
      const outcomeOf = new Map<string, string>();
      if (ids.length > 0) {
        const { data: outs, error: e2 } = await db
          .from("overtime_outcomes")
          .select("response_id, outcome")
          .in("response_id", ids);
        if (e2) throw e2;
        for (const o of (outs ?? []) as { response_id: string; outcome: string }[]) outcomeOf.set(o.response_id, o.outcome);
      }
      return rows
        .filter((r) => r.overtime_requests)
        .map((r) => ({
          on_date: r.overtime_requests!.on_date,
          starts_at: r.overtime_requests!.starts_at,
          ends_at: r.overtime_requests!.ends_at,
          outcome: outcomeOf.get(r.id) ?? null,
        }));
    },
  });
}
