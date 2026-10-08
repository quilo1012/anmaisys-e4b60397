/**
 * The rules of an overtime ask, as pure functions.
 *
 * Everything here reads rows the database already decided on and turns them into
 * what the supervisor's screen shows: the count in the header, the badge beside each
 * name, and the order the names come in. None of it writes. The one write an employee
 * makes (`answer_overtime`) and the one a supervisor makes (the decision) are RPCs and
 * plain updates in `useOvertimeRequests`.
 */

export type OvertimeAnswer = "yes" | "no";
export type OvertimeDecision = "accepted" | "reserve" | "declined";
/** `cancelled` is what the manager records; the database turns it into in_time or late by the rule. */
export type OvertimeOutcome =
  | "attended" | "no_show" | "called_sick" | "cancelled" | "cancelled_in_time" | "cancelled_late";

export interface OvertimeRequest {
  id: string;
  on_date: string;
  starts_at: string;
  ends_at: string;
  headcount: number;
  department: string | null;
  shift_group: string | null;
  note: string | null;
  status: "open" | "closed" | "cancelled";
  created_by: string;
  created_at: string;
  closed_at: string | null;
}

export interface OvertimeResponse {
  id: string;
  request_id: string;
  employee_id: string;
  answer: OvertimeAnswer;
  decision: OvertimeDecision | null;
  answered_at: string;
  decided_at: string | null;
}

/** One row of `overtime_reliability()`. */
export interface Reliability {
  employee_id: string;
  sick_this_month: number;
  absent_this_month: number;
  ot_accepted_60d: number;
  ot_attended_60d: number;
  /** yyyy-mm-dd until which self-sign-up is refused by the rules, or null. */
  blocked_until?: string | null;
}

export interface RequestCounts {
  headcount: number;
  interested: number;
  accepted: number;
  reserve: number;
  declined: number;
  /** How many more the supervisor still has to pick. Never negative. */
  short: number;
}

/**
 * "Needs 4 · 7 interested · 2 accepted · 1 reserve".
 *
 * `interested` counts every 'yes', decided or not, because that is the pool the
 * supervisor chose from and it is what the header is read for. A 'no' is not
 * interest; it is kept only so the list shows who has seen the ask.
 */
export function countResponses(
  request: Pick<OvertimeRequest, "headcount">,
  responses: Pick<OvertimeResponse, "answer" | "decision">[],
): RequestCounts {
  const yes = responses.filter((r) => r.answer === "yes");
  const accepted = yes.filter((r) => r.decision === "accepted").length;
  const reserve = yes.filter((r) => r.decision === "reserve").length;
  const declined = yes.filter((r) => r.decision === "declined").length;
  return {
    headcount: request.headcount,
    interested: yes.length,
    accepted,
    reserve,
    declined,
    short: Math.max(0, request.headcount - accepted),
  };
}

export type ReliabilityTone = "good" | "warn" | "bad";

export interface OvertimeRules {
  no_show_block_days: number;
  late_cancel_hours: number;
  late_cancel_blocks: boolean;
}

/** "Blocked until 20/10", for the badge beside a name. Empty when not blocked. */
export function blockedLabel(r: Pick<Reliability, "blocked_until"> | undefined, today: string = new Date().toISOString().slice(0, 10)): string {
  if (!r?.blocked_until || r.blocked_until <= today) return "";
  const [, m, d] = r.blocked_until.split("-");
  return `Blocked until ${d}/${m}`;
}

/**
 * The colour beside the name, and nothing else decides it.
 *
 * Green: nothing this month. Amber: one occurrence, and it was announced (sick,
 * cancelled in time). Red: two or more of anything, or any no-show at all — one
 * unannounced absence is what actually costs the line, and it should not look the
 * same as one phone call.
 *
 * The 60-day overtime ratio does not move the colour. It is shown beside it, as a
 * fraction, so the supervisor can weigh "6 of 6" against "3 of 8" with their own
 * judgement; folding it into the light would hide the count it was made from.
 */
export function reliabilityTone(r: Reliability | undefined): ReliabilityTone {
  if (!r) return "good";
  const total = r.sick_this_month + r.absent_this_month;
  if (r.absent_this_month >= 1) return "bad";
  if (total >= 2) return "bad";
  if (total === 1) return "warn";
  return "good";
}

/** "0 absences", "1 sick", "2 sick · 1 absent" — what the badge says. */
export function reliabilityLabel(r: Reliability | undefined): string {
  if (!r) return "0 absences";
  const parts: string[] = [];
  if (r.sick_this_month) parts.push(`${r.sick_this_month} sick`);
  if (r.absent_this_month) parts.push(`${r.absent_this_month} absent`);
  return parts.length ? parts.join(" · ") : "0 absences";
}

/** "6/6 worked" or a dash when the person has never been picked. */
export function attendedLabel(r: Reliability | undefined): string {
  if (!r || r.ot_accepted_60d === 0) return "—";
  return `${r.ot_attended_60d}/${r.ot_accepted_60d} worked`;
}

const TONE_RANK: Record<ReliabilityTone, number> = { good: 0, warn: 1, bad: 2 };

export interface Candidate<E = { id: string; full_name: string }> {
  employee: E;
  response: OvertimeResponse;
  reliability: Reliability | undefined;
}

/**
 * The order the names come in: best record first, then who answered first.
 *
 * The supervisor still picks. Sorting only puts the likely choice at the top, so on a
 * phone the first four rows are usually the four they want. Already-decided rows keep
 * their place rather than jumping, because a list that reorders itself under a thumb
 * is how the wrong person gets accepted.
 */
export function sortCandidates<E extends { id: string }>(cs: Candidate<E>[]): Candidate<E>[] {
  return [...cs].sort((a, b) => {
    const t = TONE_RANK[reliabilityTone(a.reliability)] - TONE_RANK[reliabilityTone(b.reliability)];
    if (t !== 0) return t;
    const ra = a.reliability, rb = b.reliability;
    const fa = ra && ra.ot_accepted_60d ? ra.ot_attended_60d / ra.ot_accepted_60d : 1;
    const fb = rb && rb.ot_accepted_60d ? rb.ot_attended_60d / rb.ot_accepted_60d : 1;
    if (fa !== fb) return fb - fa;
    return a.response.answered_at.localeCompare(b.response.answered_at);
  });
}

/**
 * Does this person see this ask?
 *
 * Null on the ask means "everyone". A department on the ask narrows it to that
 * department; a shift group narrows it further. A person with no department set
 * sees only asks that were not narrowed — nobody is quietly included in a department
 * they were never put in.
 */
export function requestIsForEmployee(
  request: Pick<OvertimeRequest, "department" | "shift_group">,
  employee: { department: string | null; shift_group: string | null },
): boolean {
  if (request.department && request.department !== employee.department) return false;
  if (request.shift_group && request.shift_group !== employee.shift_group) return false;
  return true;
}

/** What the employee's own row says on their screen. */
export function myStatusLabel(
  request: Pick<OvertimeRequest, "status">,
  response: Pick<OvertimeResponse, "answer" | "decision"> | undefined,
): string {
  if (!response) return request.status === "open" ? "Not answered" : "Closed";
  if (response.answer === "no") return "You said no";
  switch (response.decision) {
    case "accepted": return "You're in";
    case "reserve": return "Reserve";
    case "declined": return "Filled";
    default: return request.status === "open" ? "Waiting" : "Filled";
  }
}

/**
 * What the employee themselves said. A fact about the employee, and nothing else.
 *
 * Split from `myStatusLabel` because a badge and a confirmation are different jobs.
 * One word is right on a badge; a person who has just pressed a button is asking two
 * questions — did my answer land, and has anybody acted on it — and a single string
 * can only answer one of them. Collapsing them is how "I confirmed" and "I was
 * accepted" came to read as the same sentence on a phone held between shifts.
 */
export function myAnswerLabel(
  response: Pick<OvertimeResponse, "answer" | "decision"> | undefined,
): string {
  if (!response) return "Not answered";
  return response.answer === "yes" ? "You said yes" : "You said no";
}

/**
 * What the supervisor has done about it, or null when there is nothing to report.
 *
 * Null rather than "nothing yet": a line that says nothing should not be drawn. It is
 * null before the person answers, and null for somebody who said no — there is no
 * decision to wait for on an answer that declined.
 *
 * A cancelled ask wins over waiting. Reading "Waiting for the supervisor" on an ask
 * that no longer exists is the worst of both, and the cancellation is the news.
 */
export function supervisorLabel(
  request: Pick<OvertimeRequest, "status">,
  response: Pick<OvertimeResponse, "answer" | "decision"> | undefined,
): string | null {
  if (!response || response.answer === "no") return null;
  switch (response.decision) {
    case "accepted": return "Accepted";
    case "reserve":  return "Reserve";
    case "declined": return "Not needed this time";
  }
  if (request.status === "cancelled") return "Ask cancelled";
  if (request.status === "closed")    return "Not needed this time";
  return "Waiting for the supervisor";
}

/**
 * How many people the ask wants, in words.
 *
 * Both screens built this as `{headcount} needed · {shift_group} · {department}` —
 * four kinds of fact threaded onto middle dots, so the number that decides whether
 * somebody reads on carried the same weight as a note typed by hand.
 */
export function headcountLine(request: Pick<OvertimeRequest, "headcount">): string {
  return `${request.headcount} ${request.headcount === 1 ? "person" : "people"} needed`;
}

/**
 * Who can answer the ask, in words. Separate from `headcountLine` because the two
 * screens lead with different halves: the supervisor's card asks who can see this,
 * the floor's card asks how many are wanted.
 *
 * "Everyone" rather than an empty line: a null on the ask means it was not narrowed
 * — the same rule `requestIsForEmployee` reads — and a gap would look like missing
 * data instead of the answer.
 */
export function audienceLine(
  request: Pick<OvertimeRequest, "department" | "shift_group">,
): string {
  const crew = request.shift_group ? `${request.shift_group} crew` : null;
  if (request.department && crew) return `${request.department}, ${crew}`;
  return request.department ?? crew ?? "Everyone";
}

/** `14:00–22:00` from two Postgres times, with or without seconds. */
export function windowLabel(startsAt: string, endsAt: string): string {
  const hm = (t: string) => t.slice(0, 5);
  return `${hm(startsAt)}–${hm(endsAt)}`;
}
