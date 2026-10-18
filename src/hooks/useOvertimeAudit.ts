import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type { OvertimeAuditRow, OvertimeAuditEvent } from "@/lib/overtimeAudit";

// `overtime_audit` is newer than the generated types until they are regenerated.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

export type OvertimeAuditResult =
  | { state: "ready"; rows: OvertimeAuditRow[]; more: boolean }
  /** BLOCO 98 has not been pasted: the table does not exist yet. */
  | { state: "notSetUp" };

/**
 * The overtime history the signed-in person is allowed to read.
 *
 * Nothing here narrows by who is asking: the database does, by row-level security —
 * somebody who runs overtime gets every row, anybody else only rows about themselves.
 * So the same hook serves both screens and cannot be pointed at somebody else's record.
 * The user id is in the key so two logins on one tablet never share a cache entry.
 */
export function useOvertimeAudit(opts: { limit: number; events?: OvertimeAuditEvent[] | null; employeeId?: string | null }) {
  const { user } = useAuth();
  const { limit, events, employeeId } = opts;
  return useQuery({
    queryKey: ["overtime_audit", user?.id, limit, events ?? null, employeeId ?? null],
    enabled: !!user,
    meta: { schemaOptional: true },
    placeholderData: (prev, prevQuery) => (prevQuery?.queryKey[1] === user?.id ? prev : undefined),
    queryFn: async (): Promise<OvertimeAuditResult> => {
      let q = db.from("overtime_audit").select("*")
        .order("occurred_at", { ascending: false }).order("id", { ascending: false })
        .limit(limit + 1);
      if (events?.length) q = q.in("event_type", events);
      if (employeeId) q = q.eq("employee_id", employeeId);
      const { data, error } = await q;
      if (error) {
        if ((error as { code?: string }).code === "PGRST205") return { state: "notSetUp" };
        throw error;
      }
      const rows = (data ?? []) as OvertimeAuditRow[];
      return { state: "ready", rows: rows.slice(0, limit), more: rows.length > limit };
    },
  });
}
