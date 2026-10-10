import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { invokeFunction } from "@/lib/invokeFunction";
import { newAskMessage, decisionMessage, type PushMessage } from "@/lib/overtimePush";
import type {
  OvertimeRequest, OvertimeResponse, OvertimeDecision, OvertimeOutcome, Reliability, OvertimeRules,
} from "@/lib/overtimeRequests";

/**
 * Reads and writes for the overtime ask. Typed against the generated client; the
 * row shapes the screens use are declared in `@/lib/overtimeRequests`.
 */
const db = supabase;

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
      return (data ?? []) as OvertimeRequest[];
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
      return (data ?? []) as OvertimeResponse[];
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
      return (data ?? []) as OutcomeRow[];
    },
  });
}

/** The two rules the floor can read. One row; both off until a manager turns them on. */
export function useOvertimeRules() {
  return useQuery({
    queryKey: ["overtime_rules"],
    staleTime: 60_000,
    queryFn: async (): Promise<OvertimeRules> => {
      const { data, error } = await db.from("overtime_rules")
        .select("no_show_block_days, late_cancel_hours, late_cancel_blocks").eq("id", true).maybeSingle();
      if (error) throw error;
      return data ?? { no_show_block_days: 0, late_cancel_hours: 0, late_cancel_blocks: false };
    },
  });
}

export interface MyBlock { blocked_until: string; reason: string; on_date: string }

/** Until when the signed-in person may not say yes, and why. Null when they may. */
export function useMyOvertimeBlock(enabled: boolean) {
  return useQuery({
    queryKey: ["my_overtime_block"],
    enabled,
    queryFn: async (): Promise<MyBlock | null> => {
      const { data, error } = await db.rpc("my_overtime_block");
      if (error) throw error;
      return (data as MyBlock[] | null)?.[0] ?? null;
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


/**
 * Tell some logins about an ask. Best effort, on purpose.
 *
 * The ask is already saved by the time this runs. If the push fails — VAPID not set,
 * the function down, nobody linked yet — the ask still stands and the supervisor is
 * told the message did not go, not that the ask did not. A notification is a
 * courtesy; the row is the record.
 */
export interface PushOutcome {
  /** Logins that got the in-app bell. */
  notified: number;
  /** Phones that actually got a push. Null when the function did not say. */
  pushed: number | null;
  /** Why no phone could get one — "VAPID not configured", for instance. */
  note: string | null;
  error: string | null;
}

async function pushTo(
  requestId: string,
  message: PushMessage,
  employeeIds: string[] | null,
): Promise<PushOutcome> {
  const none: PushOutcome = { notified: 0, pushed: null, note: null, error: null };
  const { data: ids, error: tErr } = await db.rpc("overtime_push_targets", {
    p_request_id: requestId,
    ...(employeeIds ? { p_employee_ids: employeeIds } : {}),
  });
  if (tErr) return { ...none, error: tErr.message };
  const userIds = (ids ?? []) as string[];
  if (userIds.length === 0) return none;
  const { data, error } = await invokeFunction<{ sent?: number; in_app?: number; note?: string }>(
    "send-push", { user_ids: userIds, ...message },
  );
  if (error) return { ...none, error: String(error.message ?? error) };
  return {
    notified: data?.in_app ?? userIds.length,
    pushed: typeof data?.sent === "number" ? data.sent : null,
    note: data?.note ?? null,
    error: null,
  };
}

export function useOvertimeMutations() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const refresh = () => {
    void qc.invalidateQueries({ queryKey: KEYS.requests });
    void qc.invalidateQueries({ queryKey: ["overtime_responses"] });
    void qc.invalidateQueries({ queryKey: ["overtime_outcomes"] });
    void qc.invalidateQueries({ queryKey: KEYS.reliability });
    void qc.invalidateQueries({ queryKey: ["my_overtime_block"] });
  };

  const createRequest = useMutation({
    mutationFn: async (input: {
      on_date: string; starts_at: string; ends_at: string; headcount: number;
      department: string | null; shift_group: string | null; note: string | null;
    }): Promise<{ request: OvertimeRequest; push: PushOutcome }> => {
      const { data, error } = await db
        .from("overtime_requests")
        .insert({ ...input, created_by: user!.id })
        .select("*")
        .single();
      if (error) throw error;
      const request = data as OvertimeRequest;
      const push = await pushTo(request.id, newAskMessage(request), null);
      return { request, push };
    },
    onSuccess: refresh,
  });

  /**
   * Open, close or cancel an ask — and say so when it did not happen.
   *
   * An UPDATE refused by RLS is not an error. `overtime_requests_manage` is gated on
   * `can_manage_overtime`, and a caller without it simply matches no rows: PostgREST
   * answers 204, the mutation resolves, `refresh` refetches, and the ask comes back
   * exactly as it was. "Cancel ask" looked like a dead button and could not say why.
   *
   * Asking for the row back is what turns that silence into an answer. An INSERT in
   * the same position does raise — RLS violations on insert are errors — which is why
   * `createRequest` needs nothing, and `decide` already asks with `.single()`. This
   * was the one write that did neither.
   */
  const setRequestStatus = useMutation({
    mutationFn: async ({ id, status }: { id: string; status: OvertimeRequest["status"] }) => {
      const patch: Partial<OvertimeRequest> = { status };
      if (status !== "open") patch.closed_at = new Date().toISOString();
      const { data, error } = await db
        .from("overtime_requests").update(patch).eq("id", id).select("id");
      if (error) throw error;
      if (!((data as { id: string }[] | null)?.length)) {
        throw new Error(
          "You do not have permission to change this overtime ask, or it no longer exists.",
        );
      }
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
      const { data, error } = await db.from("overtime_responses").update({
        decision,
        decided_at: decision ? new Date().toISOString() : null,
        decided_by: decision ? user!.id : null,
      }).eq("id", responseId).select("request_id, employee_id").single();
      if (error) throw error;
      if (!decision) return;
      const { data: req } = await db.from("overtime_requests")
        .select("id, on_date, starts_at, ends_at").eq("id", data.request_id).single();
      const message = req ? decisionMessage(req, decision) : null;
      if (message) await pushTo(data.request_id, message, [data.employee_id]);
    },
    onSuccess: refresh,
  });

  /**
   * Record what happened. Through the RPC, because that is where the reserve steps in:
   * when an accepted person drops out of an open ask, the longest-waiting reserve is
   * promoted and comes back here, and the push tells them their place opened.
   */
  const recordOutcome = useMutation({
    mutationFn: async ({ responseId, outcome, note }: { responseId: string; outcome: OvertimeOutcome; note?: string })
      : Promise<{ promotedEmployeeId: string | null; push: PushOutcome | null }> => {
      const { data, error } = await db.rpc("record_overtime_outcome", {
        p_response_id: responseId, p_outcome: outcome, ...(note ? { p_note: note } : {}),
      });
      if (error) throw error;
      const promoted = (data as { promoted_response_id: string; promoted_employee_id: string }[] | null)?.[0];
      if (!promoted) return { promotedEmployeeId: null, push: null };
      const { data: resp } = await db.from("overtime_responses").select("request_id").eq("id", responseId).single();
      const { data: req } = resp
        ? await db.from("overtime_requests").select("id, on_date, starts_at, ends_at").eq("id", resp.request_id).single()
        : { data: null };
      const message = req ? decisionMessage(req, "accepted") : null;
      const push = message && req ? await pushTo(req.id, message, [promoted.promoted_employee_id]) : null;
      return { promotedEmployeeId: promoted.promoted_employee_id, push };
    },
    onSuccess: refresh,
  });

  /**
   * The rules, and the same refusal to fail quietly as `setRequestStatus`.
   *
   * `overtime_rules` is gated by `overtime_rules_manage` on `can_manage_overtime`, so
   * a caller without the action matches no row and gets a 204 — no error. This screen
   * sets how many days a no-show keeps somebody out of overtime and what counts as a
   * late cancellation, so the silent version of this is a supervisor who believes a
   * block is off, on a dialog that said it saved, with the block still on.
   */
  const saveRules = useMutation({
    mutationFn: async (rules: OvertimeRules) => {
      const { data, error } = await db.from("overtime_rules")
        .update({ ...rules, updated_at: new Date().toISOString(), updated_by: user!.id })
        .eq("id", true).select("id");
      if (error) throw error;
      if (!((data as { id: boolean }[] | null)?.length)) {
        throw new Error("You do not have permission to change the overtime rules.");
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ["overtime_rules"] });
      void qc.invalidateQueries({ queryKey: KEYS.reliability });
      void qc.invalidateQueries({ queryKey: ["my_overtime_block"] });
    },
  });

  /**
   * Who you are, said with the number on your badge rather than picked off a list.
   *
   * It used to take an employee id chosen from `overtime_unlinked_names()` — every
   * unclaimed person on the roster, by name and department, with a button saying
   * "That's me". `link_me_to_employee`'s only identity check is an email match on a
   * column almost no employee row fills in, so the choice was free. See
   * `link_me_by_employee_ref`, which takes the badge instead and counts wrong answers.
   */
  const linkMe = useMutation({
    mutationFn: async (employeeRef: string) => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types yet
      const { error } = await (db.rpc as any)("link_me_by_employee_ref", { p_ref: employeeRef });
      if (error) {
        /**
         * The window between this screen shipping and the migration being pasted.
         *
         * Nothing in this repository applies a migration — a person pastes it — so the
         * two halves of this change cannot land at the same instant, and in between
         * the function this calls does not exist. PostgREST answers PGRST202, whose
         * own text is "Could not find the function public.link_me_by_employee_ref...",
         * which is true and useless to somebody standing in a factory. This says what
         * to do instead.
         */
        if ((error as { code?: string }).code === "PGRST202") {
          throw new Error("Sign-up is being updated right now. Ask your supervisor to link your account.");
        }
        throw error;
      }
    },
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: KEYS.me });
      void qc.invalidateQueries({ queryKey: ["employees_unlinked"] });
      void qc.invalidateQueries({ queryKey: ["overtime_roster"] });
    },
  });

  return { createRequest, setRequestStatus, answer, answerFor, decide, recordOutcome, linkMe, saveRules };
}
