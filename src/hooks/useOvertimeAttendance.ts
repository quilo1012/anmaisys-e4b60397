import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { boardSlotOf } from "@/lib/boardOvertime";
import type { OvertimeRequest } from "@/lib/overtimeRequests";
import {
  attendanceOrder, attendanceStateOf, attendanceTrail, responseStateOf, type AttendanceRow,
} from "@/lib/overtimeAttendance";

export interface AskAttendance {
  request: Pick<OvertimeRequest, "id" | "on_date" | "starts_at" | "ends_at" | "headcount" | "status" | "note">;
  rows: AttendanceRow[];
}

const plusOneDay = (iso: string): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
};

/**
 * The overtime asks that land on this board (a night board reaches into the next
 * morning, so its 02:00 ask is on the next date — `boardSlotOf`), each with everybody
 * who answered it, their response, and what was recorded about attendance.
 *
 * Cancelled asks are left out: they are not headcount. Responses, outcomes and the
 * audit are read as they are stored, keyed to the ask, so editing a rota or a later
 * ask does not change what was recorded here.
 *
 * Only for people who manage overtime: RLS shows anybody else only their own answer,
 * and a board of one would read as a board.
 */
export function useOvertimeAttendance(onDate: string, shift: "Day" | "Night", enabled: boolean) {
  return useQuery({
    queryKey: ["overtime-attendance", onDate, shift],
    enabled,
    refetchInterval: 30_000,
    refetchOnWindowFocus: true,
    queryFn: async (): Promise<AskAttendance[]> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- answered_for_* and the audit are newer than parts of the generated types
      const db = supabase as any;
      const { data: asks, error } = await db
        .from("overtime_requests")
        .select("id, on_date, starts_at, ends_at, headcount, status, note")
        .in("on_date", [onDate, plusOneDay(onDate)])
        .neq("status", "cancelled")
        .order("on_date").order("starts_at");
      if (error) throw error;
      const mine = ((asks ?? []) as AskAttendance["request"][]).filter((q) => {
        const slot = boardSlotOf(q.on_date, q.starts_at);
        return slot.date === onDate && slot.shift === shift;
      });
      if (mine.length === 0) return [];

      const { data: responses, error: rErr } = await db
        .from("overtime_responses")
        .select("id, request_id, employee_id, answer, decision")
        .in("request_id", mine.map((q) => q.id));
      if (rErr) throw rErr;
      const resp = (responses ?? []) as { id: string; request_id: string; employee_id: string; answer: string; decision: string | null }[];
      const responseIds = resp.map((r) => r.id);

      const [outcomes, people, audit] = responseIds.length === 0
        ? [{ data: [] }, { data: [] }, { data: [] }]
        : await Promise.all([
          db.from("overtime_outcomes").select("response_id, outcome, note, recorded_at").in("response_id", responseIds),
          // The overtime roster, not `employees`: that table is HR-only (workforce.view),
          // and a manager who runs overtime would read a board of unknown names.
          db.rpc("overtime_roster"),
          db.from("overtime_audit")
            .select("response_id, event_type, actor_name, occurred_at")
            .in("response_id", responseIds)
            .in("event_type", ["attended", "no_show", "called_sick"])
            .order("occurred_at", { ascending: true }),
        ]);
      if ((outcomes as { error?: unknown }).error) throw (outcomes as { error: unknown }).error;

      const outcomeBy = new Map(((outcomes.data ?? []) as { response_id: string; outcome: string; note: string | null; recorded_at: string }[])
        .map((o) => [o.response_id, o]));
      const nameBy = new Map(((people.data ?? []) as { id: string; full_name: string }[]).map((e) => [e.id, e.full_name]));
      // The audit is read for the name behind each entry; if it cannot be read the
      // attendance itself still shows, without "by".
      const trail = attendanceTrail((audit.data ?? []) as Parameters<typeof attendanceTrail>[0]);

      return mine.map((request) => ({
        request,
        rows: resp.filter((r) => r.request_id === request.id).map((r): AttendanceRow => {
          const o = outcomeBy.get(r.id);
          const t = trail.get(r.id);
          return {
            responseId: r.id,
            employeeId: r.employee_id,
            // The roster lists active people; somebody who has since left keeps their row.
            name: nameBy.get(r.employee_id) ?? "Name not available (inactive)",
            response: responseStateOf(r),
            attendance: attendanceStateOf(o?.outcome),
            note: o?.note ?? null,
            recordedAt: o?.recorded_at ?? null,
            recordedBy: o && t ? t.by : null,
            corrected: (t?.count ?? 0) > 1,
          };
        }).sort(attendanceOrder),
      }));
    },
  });
}
