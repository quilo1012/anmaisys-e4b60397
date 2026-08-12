import { supabase } from "@/integrations/supabase/client";
import type { ScorecardPeriod, ScorecardRaw } from "@/lib/leaderScorecard";

/**
 * A leader's own rows, fetched with their own PIN.
 *
 * Line leaders have no account in this system — `leader_pins` is a name and a PIN
 * hash, nothing else — and the tablet they work on is signed in as its line, which
 * RLS scopes to that one line. Reading the scorecard tables from such a session does
 * not fail; it silently returns the rows for one line out of the six a leader rotates
 * across, and prints a smaller score for the person the card is about.
 *
 * So the rows come from `leader_self_scorecard`, a SECURITY DEFINER function that
 * takes the PIN — never a leader id, which a session could otherwise guess — and
 * returns only that leader's data. It computes no score: that stays in
 * {@link computeScorecard}, shared with the manager's copy of the card.
 */

export interface LeaderIdentity {
  id: string;
  name: string;
  line: string | null;
  lines: string[];
}

/**
 * Discriminated on a string, not a boolean: this project compiles with
 * `strict: false`, and TypeScript will not narrow a union on a boolean discriminant
 * without strictNullChecks — so `if (out.ok)` left both branches in scope and the
 * refusal message typechecked as unreachable on the success shape.
 */
export interface SelfScorecardSuccess {
  status: "ok";
  leader: LeaderIdentity;
  raw: ScorecardRaw;
}

export interface SelfScorecardRefused {
  status: "refused";
  error: string;
  message: string;
  lockedSeconds: number;
  remaining: number | null;
}

export type SelfScorecardOutcome = SelfScorecardSuccess | SelfScorecardRefused;

/** What each refusal means to whoever is holding the tablet. */
export function selfScorecardMessage(error: string, extra: { lockedSeconds?: number; remaining?: number | null; engineerName?: string } = {}): string {
  switch (error) {
    case "not_authenticated":
      return "This device is signed out. Sign in on the tablet, then try again.";
    case "not_a_leader":
      return extra.engineerName
        ? `${extra.engineerName} is an engineer PIN, not a line leader's. There is no leader scorecard for it.`
        : "That PIN is not a line leader's.";
    case "locked":
      return `Too many attempts. Wait ${extra.lockedSeconds ?? 30}s before trying again.`;
    case "invalid_pin":
      return extra.remaining != null
        ? `Incorrect PIN. ${extra.remaining} attempt${extra.remaining === 1 ? "" : "s"} left before lockout.`
        : "Incorrect PIN. Please try again.";
    case "bad_period":
      return "That date range runs backwards.";
    case "period_too_long":
      return "A scorecard covers at most a year at a time.";
    case "bad_shift":
      return "Unknown shift.";
    default:
      return "Could not load your scorecard. Contact your supervisor.";
  }
}

const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

export async function fetchLeaderSelfScorecard(pin: string, period: ScorecardPeriod): Promise<SelfScorecardOutcome> {
  const { data, error } = await (supabase as any).rpc("leader_self_scorecard", {
    _pin: pin,
    _from: period.from,
    _to: period.to,
    _shift: period.shift,
  });
  if (error) throw error;

  const payload = (data ?? {}) as any;
  if (!payload.success) {
    const code = String(payload.error ?? "unknown");
    return {
      status: "refused",
      error: code,
      message: selfScorecardMessage(code, {
        lockedSeconds: Number(payload.locked_seconds ?? 0) || undefined,
        remaining: Number.isFinite(payload.remaining) ? Number(payload.remaining) : null,
        engineerName: payload.engineer_name,
      }),
      lockedSeconds: Number(payload.locked_seconds ?? 0),
      remaining: Number.isFinite(payload.remaining) ? Number(payload.remaining) : null,
    };
  }

  const raw: ScorecardRaw = {
    actions: asArray(payload.actions),
    completes: asArray(payload.completes),
    sessions: asArray(payload.sessions),
    // The function names it `rag`; the card calls it ragRows. Renamed here rather than
    // in either of them, so neither has to know about the other's vocabulary.
    ragRows: asArray(payload.rag),
    items: asArray(payload.items),
    woRequests: asArray(payload.work_orders),
  };

  return {
    status: "ok",
    leader: {
      id: String(payload.leader?.id ?? ""),
      name: String(payload.leader?.name ?? ""),
      line: payload.leader?.line ?? null,
      lines: asArray<string>(payload.leader?.lines),
    },
    raw,
  };
}
