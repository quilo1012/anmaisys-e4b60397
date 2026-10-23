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
  /**
   * How many people the ask wanted, or null: since BLOCO 102 an ask says when, not
   * how many, and takes everybody who says yes. Older asks keep their number.
   */
  headcount: number | null;
  department: string | null;
  shift_group: string | null;
  /** Crews the office chose NOT to send this to (BLOCO 116). Absent until the block is pasted. */
  excluded_shift_groups?: string[] | null;
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
  /**
   * Que turno a pessoa tinha à frente quando disse que sim.
   *
   * Gravado no momento da resposta, para um pedido poder ser corrigido sem apagar as
   * respostas nem comprometer ninguém com horas que nunca viu. Null nas respostas
   * dadas antes desta coluna existir — e aí não se afirma nada. Ver
   * `answeredForDifferentHours`.
   */
  answered_for_date?: string | null;
  answered_for_starts_at?: string | null;
  answered_for_ends_at?: string | null;
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
  headcount: number | null;
  interested: number;
  accepted: number;
  reserve: number;
  declined: number;
  /** How many places are still free. Never negative; null on an ask with no number. */
  short: number | null;
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
  responses: (Pick<OvertimeResponse, "answer" | "decision"> & { id?: string })[],
  /**
   * When known, `short` counts only places still held — somebody accepted who then
   * called in sick no longer fills one (`placesTaken`, the database's own count). Left
   * out, every accept holds a place, which is all a caller without outcomes can say.
   */
  outcomeOf?: (responseId: string) => string | undefined,
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
    // Null on an ask with no number (BLOCO 102): there are no places to run short of.
    short: request.headcount == null ? null : Math.max(0, request.headcount - (outcomeOf
      ? yes.filter((r) => {
          if (r.decision !== "accepted") return false;
          const o = r.id ? outcomeOf(r.id) : undefined;
          return o === undefined || o === "attended";
        }).length
      : accepted)),
  };
}

/**
 * How many places the ask has given away: accepted, and still coming.
 *
 * Somebody accepted who then dropped out (any outcome but 'attended') no longer holds a
 * place — that is the gap `record_overtime_outcome` fills from the reserve. The database
 * counts the same way (`overtime_places_taken`, BLOCO 101) and refuses an accept past
 * the headcount, so the screen greys Accept out on the same number instead of letting
 * the supervisor press it and read a refusal.
 */
export function placesTaken(
  responses: readonly Pick<OvertimeResponse, "id" | "decision">[],
  outcomeOf: (responseId: string) => string | undefined,
): number {
  return responses.filter((r) => {
    if (r.decision !== "accepted") return false;
    const outcome = outcomeOf(r.id);
    return outcome === undefined || outcome === "attended";
  }).length;
}

/**
 * What the floor reads about room on an ask, or null when it cannot be known (the
 * counts are not in yet, or BLOCO 101 is not pasted).
 *
 * A full ask still takes a yes — the supervisor puts it on reserve, and the reserve is
 * who steps in when somebody drops out — so "full" is said as what a yes now means,
 * not as a closed door.
 */
export function placesLine(places: { taken: number; headcount: number | null } | undefined): string | null {
  // An ask with no number has no places to count: everybody who says yes is in.
  if (!places || places.headcount == null) return null;
  const left = Math.max(0, places.headcount - places.taken);
  if (left === 0) {
    return `All ${places.headcount} ${places.headcount === 1 ? "place is" : "places are"} filled — a yes puts you on the reserve list`;
  }
  return `${left} of ${places.headcount} ${places.headcount === 1 ? "place" : "places"} left`;
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
  request: Pick<OvertimeRequest, "department" | "shift_group"> & { excluded_shift_groups?: string[] | null },
  employee: { department: string | null; shift_group: string | null },
): boolean {
  if (request.department && request.department !== employee.department) return false;
  if (request.shift_group && request.shift_group !== employee.shift_group) return false;
  // A crew the office chose not to send this to (BLOCO 116).
  if (employee.shift_group && request.excluded_shift_groups?.includes(employee.shift_group)) return false;
  return true;
}

/**
 * The board an ask's hours land on: Day from 06:00 to 17:59, Night otherwise.
 *
 * The same line `factory_shift_of` draws in the database, which is what the ask →
 * board bridge (`overtime_board_shift`) uses. It is NOT the ask's `shift_group`:
 * that field says which crew is asked, and an ask for night hours can be put to the
 * day crew. Confusing the two is how "the admin cannot add a Day person to Night
 * overtime" happened — the form's "Shift" read as the target shift and narrowed the
 * people instead.
 */
export function overtimeBoardFor(startsAt: string): "Day" | "Night" {
  const h = Number(startsAt.slice(0, 2));
  return h >= 6 && h < 18 ? "Day" : "Night";
}

/**
 * Who a supervisor may add at the desk: everybody active who has not answered.
 *
 * The ask's department and crew decide who is ASKED — who sees it and may answer on
 * their own phone (`answer_overtime` still enforces that). A supervisor adding a name
 * is a decision made by somebody allowed to make it, so it is not narrowed: a Day
 * person covering a Night shortage is the point of overtime. People outside the ask's
 * audience are offered last and flagged, so it is a visible choice, not an accident.
 */
export function deskCandidates<T extends { id: string; full_name: string; department: string | null; shift_group: string | null }>(
  request: Pick<OvertimeRequest, "department" | "shift_group">,
  employees: T[],
  answered: ReadonlySet<string>,
): { employee: T; outside: boolean }[] {
  return employees
    .filter((e) => !answered.has(e.id))
    .map((e) => ({ employee: e, outside: !requestIsForEmployee(request, e) }))
    .sort((a, b) => Number(a.outside) - Number(b.outside) || a.employee.full_name.localeCompare(b.employee.full_name));
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
    // Since BLOCO 102 a yes books the shift itself; the supervisor is told, not asked.
    case "accepted": return "Booked — your supervisor has been told";
    case "reserve":  return "Reserve";
    case "declined": return "Not needed this time";
  }
  if (request.status === "cancelled") return "Ask cancelled";
  if (request.status === "closed")    return "Not needed this time";
  return "Waiting for the supervisor";
}

/**
 * Whether the shift this ask is for has already finished.
 *
 * Seen on a Line 1 tablet at 23:00 on 08/10: the ask for that morning, 06:00–14:00,
 * listed as "Not answered" with both buttons live, nine hours after the window shut.
 * Somebody could have said yes to a morning that was over, and the supervisor's
 * screen would have shown them among the interested.
 *
 * The screen filtered on `on_date >= today` and nothing else — dates, when the ask
 * carries hours. `starts_at` and `ends_at` were never read.
 *
 * A window whose end reads earlier than its start is a night: 18:00–06:00 ends the
 * following morning, not twelve hours before it began.
 */
export function askIsOver(
  request: Pick<OvertimeRequest, "on_date" | "starts_at" | "ends_at">,
  now: Date = new Date(),
): boolean {
  const hm = (t: string) => t.slice(0, 5);
  const crossesMidnight = hm(request.ends_at) <= hm(request.starts_at);
  const end = new Date(`${request.on_date}T${hm(request.ends_at)}:00`);
  if (crossesMidnight) end.setDate(end.getDate() + 1);
  return now.getTime() > end.getTime();
}

/**
 * Whether the shift this ask is for has already begun.
 *
 * `on_date` is the day the shift starts, so a night of 18:00–06:00 begins on
 * `on_date` at 18:00 and nothing about the next morning matters here. Once it has
 * begun it is no longer an opportunity: nobody signs up for a shift already under
 * way, even while `askIsOver` would still call it running.
 */
export function askHasStarted(
  request: Pick<OvertimeRequest, "on_date" | "starts_at">,
  now: Date = new Date(),
): boolean {
  const start = new Date(`${request.on_date}T${request.starts_at.slice(0, 5)}:00`);
  return now.getTime() >= start.getTime();
}

/** Today as `yyyy-mm-dd` on the device's own clock — the clock `askHasStarted` reads. */
export function localDate(now: Date = new Date()): string {
  const p = (n: number) => String(n).padStart(2, "0");
  return `${now.getFullYear()}-${p(now.getMonth() + 1)}-${p(now.getDate())}`;
}

/**
 * What My Overtime lists: shifts still ahead, and nothing else.
 *
 * The list used to keep every ask the person had answered, over or not, as "their
 * record" — so a phone opened on a Monday still led with last week's mornings. That
 * record lives elsewhere: an accepted shift is on My Attendance, and every answer
 * stays in `overtime_responses` for the supervisor's screen and the audit. Here it
 * is only what can still be worked:
 *
 * - the shift has not started (`askHasStarted`, so a night is judged by its 18:00);
 * - an open ask for this person's department and crew that does not land on hours
 *   already theirs (`clashes` is `my_overtime_clashes()`, the database reading their
 *   board and rota), or one they are already on (a supervisor may add somebody from
 *   outside the audience at the desk);
 * - a closed (filled) ask only when this person is in it, accepted or reserve, so
 *   "You're in" for Thursday does not vanish the moment the supervisor closes it.
 *
 * Cancelled asks are never listed. The query already leaves them out; repeating it
 * here keeps the whole rule in one readable place.
 */
export function upcomingForMe<R extends Pick<OvertimeRequest, "id" | "on_date" | "starts_at" | "status" | "department" | "shift_group">>(
  requests: R[],
  employee: { department: string | null; shift_group: string | null },
  mine: ReadonlyMap<string, Pick<OvertimeResponse, "decision">>,
  now: Date = new Date(),
  clashes: ReadonlyMap<string, string> = new Map(),
): R[] {
  return requests.filter((r) => {
    if (askHasStarted(r, now)) return false;
    const my = mine.get(r.id);
    // An unanswered ask on hours already theirs is the same shift twice, not
    // overtime: the weekend crew's Saturday 06:00–18:00 against a Saturday
    // 06:00–18:00 ask. One answered before the board was drawn stays, so the answer
    // does not vanish; the page then refuses the yes.
    if (r.status === "open") return !!my || (requestIsForEmployee(r, employee) && !clashes.has(r.id));
    if (r.status === "closed") return my?.decision === "accepted" || my?.decision === "reserve";
    return false;
  });
}

/**
 * How many people the ask wants, in words.
 *
 * Both screens built this as `{headcount} needed · {shift_group} · {department}` —
 * four kinds of fact threaded onto middle dots, so the number that decides whether
 * somebody reads on carried the same weight as a note typed by hand.
 */
export function headcountLine(request: Pick<OvertimeRequest, "headcount">): string | null {
  if (request.headcount == null) return null;
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
  request: Pick<OvertimeRequest, "department" | "shift_group"> & { excluded_shift_groups?: string[] | null },
): string {
  const crew = request.shift_group ? `${request.shift_group} crew` : null;
  const skipped = (request.excluded_shift_groups ?? []).map((g) => `${g} crew`);
  const base = request.department && crew ? `${request.department}, ${crew}` : request.department ?? crew ?? "Everyone";
  return skipped.length > 0 ? `${base}, not ${skipped.join(" or ")}` : base;
}

/** `14:00–22:00` from two Postgres times, with or without seconds. */
export function windowLabel(startsAt: string, endsAt: string): string {
  const hm = (t: string) => t.slice(0, 5);
  return `${hm(startsAt)}–${hm(endsAt)}`;
}

/**
 * Quanto tempo vai de uma hora à outra, atravessando a meia-noite.
 *
 * Existe por causa de um pedido real, a 13/10/2026, marcado para as **18:00–14:00**:
 * vinte horas, onde era 18:00–06:00. As duas horas são escritas à mão em campos
 * separados e nada as relacionava, por isso o engano não tinha como aparecer — e
 * `18:00–14:00` lê-se bem à pressa. A duração não.
 *
 * Não recusa nada: um turno longo pode ser real, e um ecrã que proíbe o que não
 * compreende é pior do que um que mostra a conta. Diz só o que foi escrito, por
 * extenso, ao lado do campo.
 */
export function hoursBetween(startsAt: string, endsAt: string): string {
  const mins = (t: string) => {
    // Exige HH:MM. Um campo a meio de ser escrito — "1" — davam 60 minutos e um
    // número errado ao lado da caixa, que é pior do que não dizer nada ainda.
    const m = /^(\d{1,2}):([0-5]\d)/.exec((t ?? "").trim());
    if (!m) return NaN;
    const hh = Number(m[1]);
    return hh <= 23 ? hh * 60 + Number(m[2]) : NaN;
  };
  const a = mins(startsAt), b = mins(endsAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return "";
  // Igual é um turno inteiro, não zero: ninguém marca horas extra de zero minutos, e
  // 24h é o que a pessoa quis dizer se escreveu a mesma hora duas vezes.
  const total = b > a ? b - a : b === a ? 24 * 60 : 24 * 60 - a + b;
  const h = Math.floor(total / 60), m = total % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/**
 * The absolute minutes an ask covers, so two asks on the same or neighbouring days can
 * be compared. An end at or before its start is the next day (the night shift).
 */
export function askMinuteWindow(request: Pick<OvertimeRequest, "on_date" | "starts_at" | "ends_at">): [number, number] {
  const [y, m, d] = request.on_date.split("-").map(Number);
  const base = Date.UTC(y, m - 1, d) / 60000;
  const hm = (t: string) => { const [h, mi] = t.slice(0, 5).split(":").map(Number); return h * 60 + mi; };
  const start = hm(request.starts_at);
  const end = hm(request.ends_at) + (hm(request.ends_at) <= start ? 1440 : 0);
  return [base + start, base + end];
}

/** True when two asks cover any of the same hours. */
export function asksOverlap(
  a: Pick<OvertimeRequest, "on_date" | "starts_at" | "ends_at">,
  b: Pick<OvertimeRequest, "on_date" | "starts_at" | "ends_at">,
): boolean {
  const [as, ae] = askMinuteWindow(a);
  const [bs, be] = askMinuteWindow(b);
  return as < be && bs < ae;
}
