/**
 * Which overtime asks interrupt the person with the "OVERTIME AVAILABLE" alert.
 *
 * The alert is a doorbell for the list on My Overtime, not a second list. So the
 * rule is the page's own (`upcomingForMe`) narrowed to the asks still waiting on
 * this person: open, theirs to answer, not begun, not on hours already theirs, and
 * not answered at all. An ask they answered — yes or no, here or on another phone —
 * never rings again: changing an answer is done on the page, on purpose, not by a
 * popup asking the same question twice.
 *
 * Dismissing is not answering. "Not now" is remembered per login and per ask on this
 * device, so the bell does not ring again for the same ask, and the ask stays on My
 * Overtime with its two buttons untouched.
 */
import {
  askHasStarted, requestIsForEmployee,
  type OvertimeRequest, type OvertimeResponse,
} from "@/lib/overtimeRequests";

export function offersToAlert<R extends Pick<OvertimeRequest, "id" | "on_date" | "starts_at" | "status" | "department" | "shift_group" | "created_by">>(
  requests: readonly R[],
  employee: { department: string | null; shift_group: string | null },
  mine: ReadonlyMap<string, Pick<OvertimeResponse, "answer" | "decision">>,
  opts: {
    now?: Date;
    clashes?: ReadonlyMap<string, string>;
    dismissed?: ReadonlySet<string>;
    /** The signed-in login. Whoever posted an ask is not rung about it. */
    userId?: string | null;
  } = {},
): R[] {
  const now = opts.now ?? new Date();
  return requests
    .filter((r) =>
      r.status === "open"
      && !mine.has(r.id)
      && !askHasStarted(r, now)
      && requestIsForEmployee(r, employee)
      && !opts.clashes?.has(r.id)
      && !opts.dismissed?.has(r.id)
      && !(opts.userId && r.created_by === opts.userId))
    .sort((a, b) => a.on_date.localeCompare(b.on_date) || a.starts_at.localeCompare(b.starts_at));
}

/**
 * What the server did with the answer, in the words the alert shows.
 *
 * Read from the row `answer_overtime` returned, never from the button pressed: since
 * BLOCO 102 a yes comes back booked, or on reserve when a numbered ask was full;
 * before it, undecided. The alert must not promise a place it did not get.
 */
export type OfferOutcome = "booked" | "reserve" | "yes_pending" | "declined";

export function offerOutcome(
  pressed: "yes" | "no",
  row: Pick<OvertimeResponse, "answer" | "decision"> | null | undefined,
): OfferOutcome {
  const answer = row?.answer ?? pressed;
  if (answer === "no") return "declined";
  if (row?.decision === "accepted") return "booked";
  if (row?.decision === "reserve") return "reserve";
  return "yes_pending";
}

// ── "Not now", remembered ───────────────────────────────────────────────────
// localStorage, per login: a phone shared at home by two people who both work here
// should not have one silence the other. Every access is guarded — private mode and
// blocked site data throw — and failing only means the alert can ring once more.

const DISMISSED_PREFIX = "an_ot_offer_dismissed:";
/** Enough for months of asks; the oldest fall off first. */
const DISMISSED_MAX = 200;

export function readDismissed(userId: string, storage?: Pick<Storage, "getItem"> | null): Set<string> {
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  try {
    const raw = store?.getItem(DISMISSED_PREFIX + userId);
    const list = raw ? JSON.parse(raw) : [];
    return new Set(Array.isArray(list) ? list.filter((x): x is string => typeof x === "string") : []);
  } catch {
    return new Set();
  }
}

export function rememberDismissed(
  userId: string,
  askId: string,
  storage?: Pick<Storage, "getItem" | "setItem"> | null,
): Set<string> {
  const store = storage ?? (typeof localStorage !== "undefined" ? localStorage : null);
  const next = readDismissed(userId, store);
  next.delete(askId);
  next.add(askId);
  const list = [...next].slice(-DISMISSED_MAX);
  try {
    store?.setItem(DISMISSED_PREFIX + userId, JSON.stringify(list));
  } catch { /* ignore — the alert may ring once more, nothing is lost */ }
  return new Set(list);
}
