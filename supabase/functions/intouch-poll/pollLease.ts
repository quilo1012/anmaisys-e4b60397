// One poll at a time.
//
// pg_cron calls this function every minute. On 11/11/2026 its p95 was 7.1 s and
// the slowest run took 33 s, so a slow run was still working when the next minute's
// run started, and both read the same machines and wrote the same rows. On a busy
// database that is when the pile-up happens.
//
// The guard is a lease row in the database, not an advisory lock: PostgREST hands
// each request a pooled connection, so a session lock taken in one request can stay
// held on a connection that the next request never sees. A row with "running since"
// has no such problem, and a run that dies without clearing it is forgotten once the
// lease expires.
//
// The lease is longer than an edge function can live (150 s), so a run that finishes
// always holds its own lease when it clears it, never the next run's.
//
// Before the SQL (BLOCO 162) is pasted the two functions do not exist. Polling must
// not stop because of that: a missing function means "run without the guard", which
// is what happened before this file existed.

export const LEASE_SECONDS = 180;

export const START_RPC = "intouch_poll_try_start";
export const FINISH_RPC = "intouch_poll_finish";

type RpcError = { code?: string | null; message?: string | null } | null;
export type Rpc = (
  fn: string,
  args?: Record<string, unknown>,
) => PromiseLike<{ data: unknown; error: RpcError }>;

export type LeaseDecision =
  /** Go ahead, and clear the lease when done. */
  | { run: true; guarded: true }
  /** Go ahead without a guard: the functions are not there yet, or the check failed. */
  | { run: true; guarded: false; reason: "lease_rpc_missing" | "lease_check_failed"; detail?: string }
  /** Another run holds the lease. */
  | { run: false; guarded: false; reason: "previous_poll_still_running" };

/** PostgREST's "no such function" (PGRST202) or Postgres's own (42883). */
export function isMissingFunction(error: RpcError): boolean {
  if (!error) return false;
  if (error.code === "PGRST202" || error.code === "42883") return true;
  return /could not find the function/i.test(error.message ?? "");
}

export async function tryStartPoll(rpc: Rpc, leaseSeconds = LEASE_SECONDS): Promise<LeaseDecision> {
  try {
    const { data, error } = await rpc(START_RPC, { p_lease_seconds: leaseSeconds });
    if (error) {
      if (isMissingFunction(error)) return { run: true, guarded: false, reason: "lease_rpc_missing" };
      // Any other failure runs the poll as it ran before the guard existed. Refusing
      // here would stop every machine reading on one bad answer from the lease.
      return { run: true, guarded: false, reason: "lease_check_failed", detail: error.message ?? error.code ?? "" };
    }
    if (data === true) return { run: true, guarded: true };
    return { run: false, guarded: false, reason: "previous_poll_still_running" };
  } catch (e) {
    return { run: true, guarded: false, reason: "lease_check_failed", detail: (e as Error)?.message ?? String(e) };
  }
}

/** Clears the lease. Never throws: the poll's answer must not depend on it. */
export async function finishPoll(rpc: Rpc, decision: LeaseDecision): Promise<void> {
  if (!decision.run || !decision.guarded) return;
  try {
    await rpc(FINISH_RPC);
  } catch { /* the lease expires on its own */ }
}
