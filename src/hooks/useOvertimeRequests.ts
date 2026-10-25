import { useMutation, useQuery, useQueryClient, type QueryClient } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";
import { invokeFunction } from "@/lib/invokeFunction";
import { announceAsk, pushTo as pushToVia, type AnnounceDeps, type PushOutcome } from "@/lib/overtimeAnnounce";
import { newAskMessage, decisionMessage, type PushMessage } from "@/lib/overtimePush";
import { localDate } from "@/lib/overtimeRequests";
import type {
  OvertimeRequest, OvertimeResponse, OvertimeDecision, OvertimeOutcome, Reliability, OvertimeRules,
} from "@/lib/overtimeRequests";
import { scheduleClashKey, type BoardRow } from "@/lib/overtimeShifts";

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

/**
 * The asks between two dates, for the calendar. Any month can be opened, so this is
 * not cut at fourteen days back like the list. Under the "overtime_requests" key so
 * every mutation's refresh reaches it.
 */
export function useOvertimeRequestsBetween(from: string, to: string, enabled = true) {
  return useQuery({
    queryKey: [...KEYS.requests, "between", from, to],
    enabled,
    queryFn: async (): Promise<OvertimeRequest[]> => {
      const { data, error } = await db
        .from("overtime_requests")
        .select("*")
        .gte("on_date", from)
        .lte("on_date", to)
        .order("on_date", { ascending: true })
        .order("starts_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OvertimeRequest[];
    },
  });
}

/**
 * The asks on these dates, read fresh — what a bulk publication checks for duplicates
 * just before it writes, so a date outside the calendar's month is checked too.
 */
export async function asksOnDates(dates: string[]): Promise<OvertimeRequest[]> {
  if (dates.length === 0) return [];
  const { data, error } = await db.from("overtime_requests").select("*").in("on_date", dates);
  if (error) throw error;
  return (data ?? []) as OvertimeRequest[];
}

/**
 * My Overtime's read: shifts from today on, open or filled, never cancelled.
 *
 * Narrowed in the query and not only on screen, so a phone does not download a
 * fortnight of finished asks just to hide them. The hour-level cut (a morning that
 * began at 06:00 is gone by 06:00) is `upcomingForMe`, because a date column cannot
 * say it.
 *
 * Under the "overtime_requests" key so every answer and decision refreshes it, and
 * polled once a minute: a supervisor closing or cancelling an ask happens on another
 * device, and nothing else would tell this one.
 */
export function useMyUpcomingOvertime() {
  return useQuery({
    queryKey: [...KEYS.requests, "upcoming"],
    refetchInterval: 60_000,
    queryFn: async (): Promise<OvertimeRequest[]> => {
      const { data, error } = await db
        .from("overtime_requests")
        .select("*")
        .gte("on_date", localDate())
        .in("status", ["open", "closed"])
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

/**
 * The answers to a set of asks, in one read — for the screen that counts across all
 * of them. Keyed under "overtime_responses" so every mutation's refresh reaches it.
 */
export function useOvertimeResponsesFor(requestIds: string[]) {
  const ids = [...requestIds].sort();
  return useQuery({
    queryKey: ["overtime_responses", "for", ...ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<OvertimeResponse[]> => {
      const { data, error } = await db.from("overtime_responses").select("*")
        .in("request_id", ids).order("answered_at", { ascending: true });
      if (error) throw error;
      return (data ?? []) as OvertimeResponse[];
    },
  });
}

/** What happened to each chosen answer, for the same screen. */
export function useOvertimeOutcomesFor(responseIds: string[]) {
  const ids = [...responseIds].sort();
  return useQuery({
    queryKey: ["overtime_outcomes", "for", ...ids],
    enabled: ids.length > 0,
    queryFn: async (): Promise<OutcomeRow[]> => {
      const { data, error } = await db.from("overtime_outcomes")
        .select("response_id, outcome, note").in("response_id", ids);
      if (error) throw error;
      return (data ?? []) as OutcomeRow[];
    },
  });
}

/**
 * The board around the asks — the rota a clash is measured against. Read only: the
 * overtime screen never writes the board; the database bridge does that on accept.
 * `daily_alloc_read` admits admin, manager and office, the same people who hold
 * `overtime.manage`.
 */
export function useOvertimeBoardRows(dates: string[]) {
  return useQuery({
    queryKey: ["overtime_board_rows", ...dates],
    enabled: dates.length > 0,
    staleTime: 60_000,
    queryFn: async (): Promise<BoardRow[]> => {
      const { data, error } = await db.from("daily_allocations")
        .select("on_date, shift, employee_id, status").in("on_date", dates);
      if (error) throw error;
      return (data ?? []) as BoardRow[];
    },
  });
}

/**
 * The signed-in employee's open asks that land on hours already theirs — their own
 * shift that day, by the board or by their rota, or overtime already given — keyed by
 * ask, with the reason. The database decides (`overtime_schedule_clash`); the phone
 * only hides what it is told.
 *
 * Until BLOCO 95 is pasted the function is missing and the map is empty: the screen
 * then offers what it always offered, and `answer_overtime` is the old one too.
 */
export function useMyOvertimeClashes(enabled: boolean) {
  return useQuery({
    queryKey: ["my_overtime_clashes"],
    enabled,
    meta: { schemaOptional: true },
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, string>> => {
      const { data, error } = await db.rpc("my_overtime_clashes");
      if (error) {
        if ((error as { code?: string }).code === "PGRST202") return new Map();
        throw error;
      }
      return new Map((data ?? []).map((r) => [r.request_id, r.reason]));
    },
  });
}

/**
 * The same rule for the supervisor's screen: for each ask, every active person whose
 * own hours it would land on. Empty until BLOCO 95 is pasted — the board-only check in
 * `clashesFor` still runs on its own then.
 */
export function useOvertimeScheduleClashes(requestIds: string[]) {
  const ids = [...requestIds].sort();
  return useQuery({
    queryKey: ["overtime_schedule_clashes", ...ids],
    enabled: ids.length > 0,
    meta: { schemaOptional: true },
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, string>> => {
      const out = new Map<string, string>();
      // The function takes at most 100 asks a call.
      for (let i = 0; i < ids.length; i += 100) {
        const { data, error } = await db.rpc("overtime_schedule_clashes", {
          p_request_ids: ids.slice(i, i + 100),
        });
        if (error) {
          if ((error as { code?: string }).code === "PGRST202") return new Map();
          throw error;
        }
        for (const r of data ?? []) {
          out.set(scheduleClashKey(r.request_id, r.employee_id), r.reason);
        }
      }
      return out;
    },
  });
}

/**
 * Places taken and wanted per ask, for anybody signed in — the floor included, whose
 * read policy on `overtime_responses` shows them only their own row. Counts, never
 * names. An empty map until BLOCO 101 is pasted: the card then says only how many
 * people are needed, as it did before.
 */
export function useOvertimePlaces(requestIds: string[]) {
  const ids = [...requestIds].sort();
  return useQuery({
    queryKey: ["overtime_places", ...ids],
    enabled: ids.length > 0,
    meta: { schemaOptional: true },
    staleTime: 60_000,
    queryFn: async (): Promise<Map<string, { taken: number; headcount: number | null }>> => {
      const out = new Map<string, { taken: number; headcount: number | null }>();
      // The function takes at most 200 asks a call.
      for (let i = 0; i < ids.length; i += 200) {
        // BLOCO 101: the types.ts only learns the function once the block is pasted.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data, error } = await (db.rpc as any)("overtime_places", { p_request_ids: ids.slice(i, i + 200) });
        if (error) {
          if ((error as { code?: string }).code === "PGRST202") return new Map();
          throw error;
        }
        for (const r of (data ?? []) as { request_id: string; taken: number; headcount: number | null }[]) {
          out.set(r.request_id, { taken: r.taken, headcount: r.headcount });
        }
      }
      return out;
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
 * Tell some logins about an ask. Best effort, on purpose: the ask is already saved by
 * the time this runs, and a notification is a courtesy — the row is the record. The
 * logic lives in `overtimeAnnounce`, where it can be tested without a network.
 */
export type { PushOutcome } from "@/lib/overtimeAnnounce";

const announceDeps: AnnounceDeps = {
  // overtime_ask_notified is BLOCO 100; the generated types learn it when it is pasted.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  rpc: async (fn, args) => (await (db.rpc as any)(fn, args)) as Awaited<ReturnType<AnnounceDeps["rpc"]>>,
  invoke: async (fn, body) =>
    (await invokeFunction<{ sent?: number; in_app?: number; note?: string }>(fn, body)) as Awaited<ReturnType<AnnounceDeps["invoke"]>>,
};

const pushTo = (requestId: string, message: PushMessage, employeeIds: string[] | null) =>
  pushToVia(announceDeps, requestId, message, employeeIds);

/**
 * Every cached read an overtime change can alter. A booking, a cancellation or a move
 * also changes the Headcount Board and "Where I'm working" (`my_attendance`), so those
 * are marked stale too: otherwise a cancelled day stays on the employee's screen for
 * up to the 30-second stale time, and on the board until its next poll.
 */
export const OVERTIME_REFRESH_KEYS: readonly (readonly string[])[] = [
  KEYS.requests,
  ["overtime_responses"],
  ["overtime_outcomes"],
  KEYS.reliability,
  ["my_overtime_block"],
  ["overtime_board_rows"],
  ["my_overtime_clashes"],
  ["overtime_schedule_clashes"],
  ["overtime_places"],
  ["my_attendance"],
  ["headcount-allocations"],
  ["headcount-confirmed-overtime"],
];

export function refreshAfterOvertimeChange(qc: Pick<QueryClient, "invalidateQueries">) {
  for (const queryKey of OVERTIME_REFRESH_KEYS) void qc.invalidateQueries({ queryKey });
}

export function useOvertimeMutations() {
  const qc = useQueryClient();
  const { user } = useAuth();
  const refresh = () => refreshAfterOvertimeChange(qc);

  const createRequest = useMutation({
    mutationFn: async (input: {
      on_date: string; starts_at: string; ends_at: string; headcount: number | null;
      department: string | null; shift_group: string | null; note: string | null;
      /** Only sent when something is skipped, so an ask that skips nobody still saves before BLOCO 116. */
      excluded_shift_groups?: string[];
    }): Promise<{ request: OvertimeRequest; push: PushOutcome }> => {
      const { data, error } = await db
        .from("overtime_requests")
        // eslint-disable-next-line @typescript-eslint/no-explicit-any -- headcount is
        // nullable from BLOCO 102; the types.ts learns it once the block is pasted.
        .insert({ ...input, created_by: user!.id } as any)
        .select("*")
        .single();
      if (error) {
        // An empty "People needed" before BLOCO 102 is in: the column is still NOT NULL.
        if ((error as { code?: string }).code === "23502" && input.headcount == null) {
          throw new Error("Leaving People needed empty needs a database update that is not in yet. Put a number in for now.");
        }
        throw error;
      }
      const request = data as OvertimeRequest;
      const push = await announceAsk(announceDeps, request.id, newAskMessage(request));
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
      const patch: Partial<Pick<OvertimeRequest, "status" | "closed_at">> = { status };
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

  /**
   * Apagar um pedido que ninguém tocou. A base recusa se houver respostas ou linhas no
   * quadro: nesse caso a saída é cancelar, que guarda o registo.
   */
  const deleteRequest = useMutation({
    mutationFn: async (id: string) => {
      const { error } = await db.rpc("delete_overtime_ask", { p_request_id: id });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  /**
   * Corrigir a data, as horas ou quantos são precisos num pedido já feito.
   *
   * As horas são escritas à mão e um engano fica lá — 18:00–14:00 onde era 18:00–06:00.
   * Até 12/10/2026 a única saída era cancelar e recomeçar, e com isso iam embora os
   * sins verdadeiros.
   *
   * Isto NÃO apaga respostas, de propósito. Quem já tinha dito que sim fica assinalado
   * no cartão, porque a resposta guarda o turno a que foi dada — ver
   * `answeredForDifferentHours`. O supervisor vê a quem tem de ligar; ninguém fica
   * comprometido em silêncio com horas que nunca viu.
   *
   * Pede a linha de volta pela mesma razão que o `setRequestStatus`: um UPDATE recusado
   * pelas políticas não é erro nenhum, são zero linhas e um 204, e o botão ficava com
   * ar de morto sem poder dizer porquê.
   */
  const editRequest = useMutation({
    mutationFn: async ({ id, ...patch }: { id: string } & Pick<
      OvertimeRequest, "on_date" | "starts_at" | "ends_at" | "headcount"
    >) => {
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
    /**
     * The row the database wrote, so the screen says what actually happened: since
     * BLOCO 102 a yes comes back `accepted` (booked) or `reserve` (a numbered ask that
     * was full); before it, undecided.
     */
    mutationFn: async ({ requestId, answer }: { requestId: string; answer: "yes" | "no" }) => {
      const { data, error } = await db.rpc("answer_overtime", { p_request_id: requestId, p_answer: answer });
      if (error) throw error;
      return data as unknown as Pick<OvertimeResponse, "answer" | "decision"> | null;
    },
    onSuccess: refresh,
  });

  /** A supervisor answering on behalf of somebody who has no login and said yes at the desk. */
  const answerFor = useMutation({
    mutationFn: async ({ requestId, employeeId, window }: {
      requestId: string; employeeId: string;
      window?: Pick<OvertimeRequest, "on_date" | "starts_at" | "ends_at"> | null;
    }) => {
      const base = {
        request_id: requestId, employee_id: employeeId, answer: "yes",
        answered_at: new Date().toISOString(),
      };
      // O mesmo instantâneo que o `answer_overtime` guarda. Sem isto, um sim dado
      // ao balcão nunca aparecia como desactualizado depois de a hora mudar — e é
      // exactamente a pessoa que não tem login, por isso a que mais precisa de
      // alguém se lembrar de lhe ligar.
      const snapshot = {
        answered_for_date: window?.on_date ?? null,
        answered_for_starts_at: window?.starts_at ?? null,
        answered_for_ends_at: window?.ends_at ?? null,
      };
      // Colunas de 20261012080000; o types.ts só as conhece depois de o bloco ser colado.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const write = (row: object) => db.from("overtime_responses").upsert(row as any, { onConflict: "request_id,employee_id" });
      let { error } = await write({ ...base, ...snapshot });
      // Produção ainda não tem estas colunas (bloco 87 por colar, sonda de 18/10):
      // o PostgREST recusa o corpo inteiro com PGRST204 e o "Add" falhava para toda
      // a gente. O sim vale mais do que o instantâneo; grava-se sem ele.
      if (error?.code === "PGRST204" && /answered_for_/.test(error.message ?? "")) {
        ({ error } = await write(base));
      }
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  /**
   * Take back an answer that was given for the wrong day or the wrong hours.
   *
   * The employee answers on their phone and picks the wrong ask — or the supervisor
   * keyed a yes at the desk onto the wrong date. The fix is to remove that answer and
   * add the right one. Order matters: the decision is cleared FIRST, because the board
   * bridge only listens to inserts and updates of `decision`, not deletes — deleting an
   * accepted answer straight away would leave the person on the board for hours they
   * never agreed to. The delete is recorded by the audit trigger like any other write.
   */
  const removeAnswer = useMutation({
    mutationFn: async ({ responseId }: { responseId: string }) => {
      const cleared = await db.from("overtime_responses")
        .update({ decision: null, decided_at: null, decided_by: null }).eq("id", responseId).select("id");
      if (cleared.error) throw cleared.error;
      // A refused write is zero rows and no error: say so instead of looking done.
      if (!cleared.data?.length) throw new Error("Could not change this answer — you may not have permission.");
      const { error } = await db.from("overtime_responses").delete().eq("id", responseId);
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
   * The employee taking back a booking they can no longer make.
   *
   * The RPC does the whole move in the database: it writes the outcome (in time or
   * late, by the same rule the supervisor's record uses), takes the person off the
   * headcount board, and hands the place to the longest-waiting reserve — who comes
   * back here so the push can tell them their place opened.
   */
  const cancelMyBooking = useMutation({
    mutationFn: async ({ requestId, note }: { requestId: string; note?: string }): Promise<{
      outcome: "cancelled_in_time" | "cancelled_late";
      promotedEmployeeId: string | null;
    }> => {
      const { data, error } = await db.rpc("cancel_my_overtime", {
        p_request_id: requestId, p_note: note ?? null,
      });
      if (error) throw error;
      const row = (data as {
        outcome: "cancelled_in_time" | "cancelled_late";
        promoted_response_id: string | null;
        promoted_employee_id: string | null;
      }[] | null)?.[0];
      if (!row) throw new Error("Nothing was cancelled. Check your signal and try again.");
      if (row.promoted_employee_id) {
        const { data: req } = await db.from("overtime_requests")
          .select("id, on_date, starts_at, ends_at").eq("id", requestId).single();
        const message = req ? decisionMessage(req, "accepted") : null;
        if (message) await pushTo(requestId, message, [row.promoted_employee_id]);
      }
      return { outcome: row.outcome, promotedEmployeeId: row.promoted_employee_id };
    },
    onSuccess: refresh,
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
  /**
   * A tentativa silenciosa, antes de se pedir o número do crachá.
   *
   * Corre sozinha quando a página abre para quem ainda não está ligado. Se o email da
   * SESSÃO estiver numa ficha activa e por reclamar, liga e a pessoa nunca chega a ver
   * o formulário. Não leva argumento nenhum de propósito — ver a migração
   * 20261012140000: quem não controla a caixa de correio não reclama a ficha.
   *
   * Falhar é o caso NORMAL, não um erro: a maior parte das fichas não tem email. Por
   * isso isto não levanta nada e não mostra nada — a pessoa vê o formulário do crachá,
   * que é o que veria de qualquer maneira. O único efeito visível é quando corre bem.
   */
  const linkMeByEmail = useMutation({
    mutationFn: async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC do bloco por colar
      const { data, error } = await (db.rpc as any)("link_me_by_email");
      // Silêncio em qualquer caso: a função ausente, o email que não bate e a ficha já
      // reclamada querem dizer todos a mesma coisa para o ecrã — mostra o formulário.
      return error ? null : (data ?? null);
    },
    onSuccess: (linked) => { if (linked) refresh(); },
  });

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

  /**
   * Trocar de dia: responde ao pedido novo e, só se ficar confirmado, cancela o atual.
   * Tudo numa transacção no servidor — se o novo não ficar confirmado, nada é cancelado.
   */
  const swapMyBooking = useMutation({
    mutationFn: async ({ fromRequestId, toRequestId }: { fromRequestId: string; toRequestId: string }) => {
      const { data, error } = await db.rpc("swap_my_overtime", {
        p_from: fromRequestId, p_to: toRequestId, p_note: "Troca de dia",
      });
      if (error) throw error;
      const row = (data as { outcome: "cancelled_in_time" | "cancelled_late"; promoted_employee_id: string | null }[] | null)?.[0];
      if (!row) throw new Error("Nothing was moved. Check your signal and try again.");
      if (row.promoted_employee_id) {
        const { data: req } = await db.from("overtime_requests")
          .select("id, on_date, starts_at, ends_at").eq("id", fromRequestId).single();
        const message = req ? decisionMessage(req, "accepted") : null;
        if (message) await pushTo(fromRequestId, message, [row.promoted_employee_id]);
      }
      return { outcome: row.outcome };
    },
    onSuccess: refresh,
  });

  /** Sair da lista de reserva. Não é cancelamento: não há turno marcado. */
  const leaveReserve = useMutation({
    mutationFn: async ({ requestId }: { requestId: string }) => {
      const { error } = await db.rpc("leave_my_reserve", { p_request_id: requestId });
      if (error) throw error;
    },
    onSuccess: refresh,
  });

  return { createRequest, editRequest, setRequestStatus, deleteRequest, answer, answerFor, removeAnswer, decide, recordOutcome, cancelMyBooking, swapMyBooking, leaveReserve, linkMe, linkMeByEmail, saveRules };
}
