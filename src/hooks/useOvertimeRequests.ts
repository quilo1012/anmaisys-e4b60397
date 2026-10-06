import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import type {
  OvertimeRequest, OvertimeResponse, OvertimeDecision, OvertimeOutcome, Reliability,
} from "@/lib/overtimeRequests";

/**
 * Reads and writes for the overtime ask.
 *
 * `as any` on the client because the generated types in
 * `src/integrations/supabase/types.ts` do not know these tables until Lovable
 * regenerates them after the migration lands. The row shapes are typed on the way
 * out, in `@/lib/overtimeRequests`, so the screens still get a real type.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const db = supabase as any;

const KEYS = {
  requests: ["overtime_requests"] as const,
  responses: (requestId?: string) => ["overtime_responses", requestId ?? "all"] as const,
  outcomes: (requestId: string) => ["overtime_outcomes", requestId] as const,
  reliability: ["overtime_reliability"] as const,
  me: ["my_employee"] as const,
};

/** Asks from today onward, plus the last 14 days so a closed one can still be marked up. */
export function useOvertimeRequests() {
  return useQuery({
    queryKey: KEYS.requests,
    queryFn: async (): Promise<OvertimeRequest[]> => {
      const since = new Date(Date.now() - 14 * 86_400_000).toISOString().slice(0, 10);
      const { data, error } = await db
        .from("overtime_requests")
        .select("*")
        .gte("on_date", since)
        .order("on_date", { ascending: true })
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useOvertimeResponses(requestId?: string) {
  return useQuery({
    queryKey: KEYS.responses(requestId),
    queryFn: async (): Promise<OvertimeResponse[]> => {
      let q = db.from("overtime_responses").select("*");
      if (requestId) q = q.eq("request_id", requestId);
      const { data, error } = await q.order("answered_at", { ascending: true });
      if (error) throw error;
      return data ?? [];
    },
  });
}

export interface OutcomeRow {
  response_id: string;
  outcome: OvertimeOutcome;
  note: string | null;
}

export function useOvertimeOutcomes(requestId: string, responseIds: string[]) {
  return useQuery({
    queryKey: [...KEYS.outcomes(requestId), responseIds.length],
    enabled: responseIds.length > 0,
    queryFn: async (): Promise<OutcomeRow[]> => {
      const { data, error } = await db
        .from("overtime_outcomes")
        .select("response_id, outcome, note")
        .in("response_id", responseIds);
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** The number beside every name, keyed by employee id. One call for the whole screen. */
export function useOvertimeReliability() {
  return useQuery({
    queryKey: KEYS.reliability,
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, Reliability>> => {
      const { data, error } = await db.rpc("overtime_reliability");
      if (error) throw error;
      return new Map((data ?? []).map((r: Reliability) => [r.employee_id, r]));
    },
  });
}

/**
 * A name and where it works. Deliberately not `Employee` from useWorkforce: the
 * roster table is readable by admin alone, and these screens are used by managers
 * and by the floor, so they read through RPCs that hand out only these four fields.
 */
export interface RosterName {
  id: string;
  full_name: string;
  department: string | null;
  shift_group: string | null;
}

/** Active people, for the manager choosing. Empty for anybody without `overtime.manage`. */
export function useOvertimeRoster() {
  return useQuery({
    queryKey: ["overtime_roster"],
    staleTime: 5 * 60_000,
    queryFn: async (): Promise<RosterName[]> => {
      const { data, error } = await db.rpc("overtime_roster");
      if (error) throw error;
      return data ?? [];
    },
  });
}

/** The employee row linked to the signed-in login, or null when there is none yet. */
export function useMyEmployee() {
  const { user } = useAuth();
  return useQuery({
    queryKey: [...KEYS.me, user?.id],
    enabled: !!user,
    queryFn: async (): Promise<RosterName | null> => {
      const { data, error } = await db.rpc("my_overtime_identity");
      if (error) throw error;
      return (data as RosterName[] | null)?.[0] ?? null;
    },
  });
}

/** Names nobody has linked a login to yet — the list a new login picks itself from. */
export function useUnlinkedEmployees() {
  return useQuery({
    queryKey: ["employees_unlinked"],
    queryFn: async (): Promise<RosterName[]> => {
      const { data, error } = await db.rpc("overtime_unlinked_names");
      if (error) throw error;
      return data ?? [];
    },
  });
}

export function useOvertimeMutations() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEYS.requests });
    void qc.invalidateQueries({ queryKey: ["overtime_responses"] });
    void qc.invalidateQueries({ queryKey: ["overtime_outcomes"] });
    void qc.invalidateQueries({ queryKey: KEYS.reliability });
  };

  const createRequest = useMutation({
    mutationFn: async (input: {
      on_date: string; starts_at: string; ends_at: string; headcount: number;
      department: string | null; shift_group: string | null; note: string | null;
    }) => {
      const { error } = await db.from("overtime_requests").insert({ ...input, created_by: user!.id });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const setRequestStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OvertimeRequest["status"] }) => {
      const patch: Partial<OvertimeRequest> = { status };
      if (status !== "open") patch.closed_at = new Date().toISOString();
      const { error } = await db.from("overtime_requests").update(patch).eq("id", id);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  /** The employee's one write. Goes through the RPC so the rules stay in the database. */
  const answer = useMutation({
    mutationFn: async ({ requestId, answer }: { requestId: string; answer: "yes" | "no" }) => {
      const { error } = await db.rpc("answer_overtime", { p_request_id: requestId, p_answer: answer });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  /** A supervisor answering on behalf of somebody who has no login and said yes at the desk. */
  const answerFor = useMutation({
    mutationFn: async ({ requestId, employeeId }: { requestId: string; employeeId: string }) => {
      const { error } = await db.from("overtime_responses").upsert(
        { request_id: requestId, employee_id: employeeId, answer: "yes", answered_at: new Date().toISOString() },
        { onConflict: "request_id,employee_id" },
      );
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const decide = useMutation({
    mutationFn: async ({ responseId, decision }: { responseId: string; decision: OvertimeDecision | null }) => {
      const { error } = await db.from("overtime_responses").update({
        decision,
        decided_at: decision ? new Date().toISOString() : null,
        decided_by: decision ? user!.id : null,
      }).eq("id", responseId);
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const recordOutcome = useMutation({
    mutationFn: async ({ responseId, outcome, note }: { responseId: string; outcome: OvertimeOutcome; note?: string }) => {
      const { error } = await db.from("overtime_outcomes").upsert(
        { response_id: responseId, outcome, note: note ?? null, recorded_by: user!.id, recorded_at: new Date().toISOString() },
        { onConflict: "response_id" },
      );
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  const linkMe = useMutation({
    mutationFn: async (employeeId: string) => {
      const { error } = await db.rpc("link_me_to_employee", { p_employee_id: employeeId });
      if (error) throw error;
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEYS.me });
      void qc.invalidateQueries({ queryKey: ["employees_unlinked"] });
      void qc.invalidateQueries({ queryKey: ["overtime_roster"] });
    },
  });

  return { createRequest, setRequestStatus, answer, answerFor, decide, recordOutcome, linkMe };
}
