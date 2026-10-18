import type { PushMessage } from "@/lib/overtimePush";

/**
 * Telling people about a new ask, after it is saved.
 *
 * Since BLOCO 100 the database writes the bell rows itself, in the same transaction as
 * the ask, for exactly the people who could take it (`overtime_notify_targets`): open,
 * not started, their department and crew, not blocked, not answered, and not on those
 * hours already. So the browser no longer decides who is told. It asks the database
 * who WAS told (`overtime_ask_notified`) — a count of rows, not a guess — and only
 * buzzes those phones, with `in_app: false` so `send-push` does not write the bell a
 * second time.
 *
 * Before BLOCO 100 is pasted the function is missing (PGRST202) and the old path runs
 * unchanged: targets by department and crew, and `send-push` writes the bell.
 */
export interface PushOutcome {
  /** Logins whose bell was written. Rows in the database, not an estimate. */
  notified: number;
  /** Phones the push service accepted a message for. Null when nothing said. */
  pushed: number | null;
  /** Why no phone could get one — "VAPID not configured", for instance. */
  note: string | null;
  /** Nobody was told at all: the bell could not be written or read back. */
  error: string | null;
  /** The bell was written but the phones were not buzzed. */
  pushError: string | null;
}

export const NO_ONE: PushOutcome = { notified: 0, pushed: null, note: null, error: null, pushError: null };

type RpcResult = { data: unknown; error: { code?: string; message: string } | null };
type InvokeResult = { data: { sent?: number; in_app?: number; note?: string } | null; error: unknown };

export interface AnnounceDeps {
  rpc: (fn: string, args: Record<string, unknown>) => Promise<RpcResult>;
  invoke: (fn: string, body: Record<string, unknown>) => Promise<InvokeResult>;
}

const errText = (e: unknown) =>
  e && typeof e === "object" && "message" in e ? String((e as { message: unknown }).message) : String(e);

/** The pre-BLOCO-100 path: the browser picks the logins and `send-push` writes the bell. */
export async function pushTo(
  deps: AnnounceDeps,
  requestId: string,
  message: PushMessage,
  employeeIds: string[] | null,
): Promise<PushOutcome> {
  const { data: ids, error: tErr } = await deps.rpc("overtime_push_targets", {
    p_request_id: requestId,
    ...(employeeIds ? { p_employee_ids: employeeIds } : {}),
  });
  if (tErr) return { ...NO_ONE, error: tErr.message };
  const userIds = (ids ?? []) as string[];
  if (userIds.length === 0) return NO_ONE;
  const { data, error } = await deps.invoke("send-push", { user_ids: userIds, ...message });
  if (error) return { ...NO_ONE, error: errText(error) };
  return {
    notified: data?.in_app ?? userIds.length,
    pushed: typeof data?.sent === "number" ? data.sent : null,
    note: data?.note ?? null,
    error: null,
    pushError: null,
  };
}

/** A new ask: read back who the database told, then buzz only their phones. */
export async function announceAsk(
  deps: AnnounceDeps,
  requestId: string,
  message: PushMessage,
): Promise<PushOutcome> {
  const { data, error } = await deps.rpc("overtime_ask_notified", { p_request_id: requestId });
  if (error) {
    if (error.code === "PGRST202") return pushTo(deps, requestId, message, null);
    return { ...NO_ONE, error: error.message };
  }
  const userIds = [...new Set((data ?? []) as string[])];
  if (userIds.length === 0) return NO_ONE;
  const told: PushOutcome = { ...NO_ONE, notified: userIds.length };
  const { data: sent, error: pErr } = await deps.invoke("send-push", {
    user_ids: userIds, ...message, in_app: false,
  });
  if (pErr) return { ...told, pushError: errText(pErr) };
  return {
    ...told,
    pushed: typeof sent?.sent === "number" ? sent.sent : null,
    note: sent?.note ?? null,
  };
}

/** The supervisor's toast, saying only what is known. */
export function announceSummary(head: string, push: PushOutcome): { tone: "success" | "warning"; text: string } {
  if (push.error) return { tone: "warning", text: `${head} — but nobody was notified: ${push.error}` };
  if (push.notified === 0) {
    return { tone: "success", text: `${head}. Nobody eligible has a login yet, so nobody was notified.` };
  }
  const told = `${push.notified} eligible ${push.notified === 1 ? "person" : "people"} notified in the app`;
  if (push.pushError) return { tone: "warning", text: `${head} · ${told} · phone alerts not sent: ${push.pushError}` };
  if (push.note) return { tone: "warning", text: `${head} · ${told} · no phone alerts: ${push.note}` };
  if (push.pushed === 0) return { tone: "success", text: `${head} · ${told} · nobody has turned on phone alerts yet` };
  if (push.pushed === null) return { tone: "success", text: `${head} · ${told}` };
  return {
    tone: "success",
    text: `${head} · ${told} · ${push.pushed} phone alert${push.pushed === 1 ? "" : "s"} handed to the push service`,
  };
}
