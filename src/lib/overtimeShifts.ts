/**
 * The overtime screen, split by the shift the overtime is FOR.
 *
 * An ask carries a date and two times; it has no shift column, and it does not need
 * one. The board already decides which shift an ask's hours belong to — the bridge in
 * 20261007120000 files an accepted answer under
 * `overtime_board_shift(on_date, starts_at)`, which is `factory_shift_of` on the start
 * time: 06:00–17:59 is Day, everything else is Night. `askShift` is that same rule,
 * read on the client, so the tab an ask sits under is the board it will land on.
 *
 * The employee's own crew (`shift_group`) is a different fact and is never used here
 * to place an ask. A day-crew packer who says yes to a night ask is night overtime.
 *
 * Pure functions only. None of this writes; the writes stay in `useOvertimeRequests`.
 */
import { countResponses, type OvertimeRequest, type OvertimeResponse, type OvertimeOutcome } from "@/lib/overtimeRequests";

export type OvertimeShift = "Day" | "Night";
export const OVERTIME_SHIFTS: OvertimeShift[] = ["Day", "Night"];

/** Which board the ask's hours land on. Mirrors `overtime_board_shift` in the database. */
export function askShift(request: Pick<OvertimeRequest, "starts_at">): OvertimeShift {
  const h = Number(request.starts_at.slice(0, 2));
  return h >= 6 && h < 18 ? "Day" : "Night";
}

/** Minutes from start to end, across midnight. Same reading as `hoursBetween`. */
export function windowMinutes(startsAt: string, endsAt: string): number {
  const mins = (t: string) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3, 5));
  const a = mins(startsAt), b = mins(endsAt);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return b > a ? b - a : b === a ? 24 * 60 : 24 * 60 - a + b;
}

/** "36h", "7h30" — a total of minutes for a figure. */
export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60), m = minutes % 60;
  return m === 0 ? `${h}h` : `${h}h${String(m).padStart(2, "0")}`;
}

/**
 * Where an ask stands, in one word.
 *
 * `open`, `closed` and `cancelled` are the database's. `filled` is not stored: it is an
 * open ask with as many accepted as it asked for. It is shown because "open" on an ask
 * that needs nobody else reads as work still to do.
 */
export type AskState = "open" | "filled" | "closed" | "cancelled";

export function askState(
  request: Pick<OvertimeRequest, "status" | "headcount">,
  responses: Pick<OvertimeResponse, "answer" | "decision">[],
): AskState {
  if (request.status !== "open") return request.status;
  return countResponses(request, responses).short === 0 ? "filled" : "open";
}

export const ASK_STATE_LABEL: Record<AskState, string> = {
  open: "Needs people", filled: "Filled", closed: "Closed", cancelled: "Cancelled",
};

/**
 * Outcomes that mean the place was not worked. An accepted answer with one of these
 * is not a confirmed assignment any more, and its hours are not scheduled.
 */
const DROPPED: ReadonlySet<OvertimeOutcome> = new Set([
  "no_show", "called_sick", "cancelled", "cancelled_in_time", "cancelled_late",
]);

export interface ShiftSummary {
  /** Asks still open with places to fill. */
  needsPeople: number;
  /** Said yes and nobody has decided yet — on an open ask. The supervisor's queue. */
  awaitingDecision: number;
  /** Accepted, on an ask that was not cancelled, and not dropped out. */
  confirmed: number;
  /** The hours of those confirmed, summed. */
  scheduledMinutes: number;
}

const EMPTY: ShiftSummary = { needsPeople: 0, awaitingDecision: 0, confirmed: 0, scheduledMinutes: 0 };

/**
 * The counts at the top of the page and on each shift's heading.
 *
 * Each figure counts a different kind of row, so none of them can count the same
 * thing twice: `needsPeople` counts asks, `awaitingDecision` and `confirmed` count
 * answers, and an answer is in at most one of the two (it is either undecided or
 * accepted). A reserve is neither — it is a decision, but not a place.
 */
export function summarise(
  requests: OvertimeRequest[],
  responsesByRequest: Map<string, OvertimeResponse[]>,
  outcomeByResponse: Map<string, OvertimeOutcome>,
): ShiftSummary {
  const s = { ...EMPTY };
  for (const r of requests) {
    const rs = responsesByRequest.get(r.id) ?? [];
    if (askState(r, rs) === "open") s.needsPeople += 1;
    if (r.status === "open") {
      s.awaitingDecision += rs.filter((x) => x.answer === "yes" && x.decision === null).length;
    }
    if (r.status === "cancelled") continue;
    const minutes = windowMinutes(r.starts_at, r.ends_at);
    for (const x of rs) {
      if (x.answer !== "yes" || x.decision !== "accepted") continue;
      const o = outcomeByResponse.get(x.id);
      if (o && DROPPED.has(o)) continue;
      s.confirmed += 1;
      s.scheduledMinutes += minutes;
    }
  }
  return s;
}

/* ---------------------------------------------------------------- filters */

export type DateRange = "upcoming" | "today" | "tomorrow" | "next7" | "past14" | "date";
export type StateFilter = "all" | AskState;

export interface AskFilters {
  range: DateRange;
  /** yyyy-mm-dd, read only when `range` is "date". */
  date: string;
  state: StateFilter;
  /** "all", or a department name. */
  department: string;
}

export const DEFAULT_FILTERS: AskFilters = { range: "upcoming", date: "", state: "all", department: "all" };

function addDays(isoDate: string, n: number): string {
  const d = new Date(`${isoDate}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Whether an ask's date is inside the chosen range.
 *
 * "Upcoming" keeps what the old screen showed by default: today onward, plus any ask
 * from an earlier day still left open — an ask nobody closed is still somebody's job.
 */
export function inRange(
  request: Pick<OvertimeRequest, "on_date" | "status">,
  f: Pick<AskFilters, "range" | "date">,
  today: string,
): boolean {
  const d = request.on_date;
  switch (f.range) {
    case "upcoming": return d >= today || request.status === "open";
    case "today": return d === today;
    case "tomorrow": return d === addDays(today, 1);
    case "next7": return d >= today && d <= addDays(today, 6);
    case "past14": return d < today && d >= addDays(today, -14);
    case "date": return !f.date || d === f.date;
  }
}

/** All the filters together, except the shift, which the tabs apply. */
export function filterAsks(
  requests: OvertimeRequest[],
  responsesByRequest: Map<string, OvertimeResponse[]>,
  f: AskFilters,
  today: string,
): OvertimeRequest[] {
  return requests.filter((r) => {
    if (!inRange(r, f, today)) return false;
    if (f.department !== "all" && r.department !== f.department) return false;
    if (f.state !== "all" && askState(r, responsesByRequest.get(r.id) ?? []) !== f.state) return false;
    return true;
  });
}

/* -------------------------------------------------------------- conflicts */

/** One row of `daily_allocations`, as much of it as a clash needs. */
export interface BoardRow {
  on_date: string;
  shift: string;
  employee_id: string;
  status: string;
}

export interface Clash {
  /** `block`: accepting would make a duplicate. `warn`: the supervisor should know. */
  severity: "block" | "warn";
  text: string;
}

const fmt = (d: string) => d.split("-").reverse().slice(0, 2).join("/");

/** The shift that ends where this one starts, and the one that starts where it ends. */
function neighbours(date: string, shift: OvertimeShift): { date: string; shift: OvertimeShift }[] {
  return shift === "Day"
    ? [{ date: addDays(date, -1), shift: "Night" }, { date, shift: "Night" }]
    : [{ date, shift: "Day" }, { date: addDays(date, 1), shift: "Day" }];
}

const OFF_STATUS: Record<string, string> = {
  holiday: "On holiday", sick: "Off sick", unpaid: "Unpaid leave", training: "On training",
};

/**
 * What stands in the way of putting this person on this ask.
 *
 * Read from two places the screen already has: the other asks (and who was accepted
 * on them), and the board (`daily_allocations`), which is the rota for the day.
 *
 * - Accepted on another ask for the same date and shift → `block`. That is the
 *   duplicate the board would silently swallow (`on conflict do nothing`), leaving one
 *   person counted twice on the overtime screen and once on the floor.
 * - Rostered on the board for the same date and shift, as an ordinary shift → `block`.
 *   They are already working those hours; overtime on top of them is the same shift
 *   twice, not overtime.
 * - Holiday, sick, unpaid or training that day → `warn`. The board said they are off;
 *   the supervisor may still have a reason, and the rule for that is theirs.
 * - Rostered, or accepted on another ask, on the shift right before or right after →
 *   `warn`: no rest between them.
 *
 * `overtime` rows on the board are skipped: they are what an accepted ask writes, so
 * this ask's own acceptance would otherwise clash with itself.
 */
export function clashesFor(
  employeeId: string,
  request: OvertimeRequest,
  others: { request: OvertimeRequest; responses: OvertimeResponse[] }[],
  board: BoardRow[],
): Clash[] {
  const out: Clash[] = [];
  const shift = askShift(request);

  for (const o of others) {
    if (o.request.id === request.id || o.request.status === "cancelled") continue;
    if (!o.responses.some((x) => x.employee_id === employeeId && x.decision === "accepted")) continue;
    const when = `${fmt(o.request.on_date)} ${o.request.starts_at.slice(0, 5)}–${o.request.ends_at.slice(0, 5)}`;
    const oShift = askShift(o.request);
    if (o.request.on_date === request.on_date && oShift === shift) {
      out.push({ severity: "block", text: `Already accepted for ${when}` });
    } else if (neighbours(request.on_date, shift).some((n) => n.date === o.request.on_date && n.shift === oShift)) {
      out.push({ severity: "warn", text: `No rest: accepted for ${when}` });
    }
  }

  const mine = board.filter((b) => b.employee_id === employeeId && b.status !== "overtime");
  for (const b of mine) {
    const sameShift = b.on_date === request.on_date && b.shift === shift;
    if (sameShift && b.status === "assigned") {
      out.push({ severity: "block", text: `Already rostered on the ${shift.toLowerCase()} shift ${fmt(b.on_date)}` });
    } else if (b.on_date === request.on_date && OFF_STATUS[b.status]) {
      out.push({ severity: "warn", text: `${OFF_STATUS[b.status]} ${fmt(b.on_date)}` });
    } else if (b.status === "assigned"
      && neighbours(request.on_date, shift).some((n) => n.date === b.on_date && n.shift === b.shift)) {
      out.push({ severity: "warn", text: `No rest: rostered ${b.shift.toLowerCase()} ${fmt(b.on_date)}` });
    }
  }
  return out;
}

/** The dates the board has to be read for: each ask's day, and the day either side. */
export function boardDatesFor(requests: Pick<OvertimeRequest, "on_date">[]): string[] {
  const s = new Set<string>();
  for (const r of requests) for (const n of [-1, 0, 1]) s.add(addDays(r.on_date, n));
  return [...s].sort();
}

/**
 * Names that appear more than once on the roster. Two active "Daniel"s exist; a row
 * that only says "Daniel" cannot tell the supervisor which one they are accepting.
 */
export function duplicateNames(roster: { full_name: string }[]): Set<string> {
  const seen = new Map<string, number>();
  for (const e of roster) {
    const k = e.full_name.trim().toLowerCase();
    seen.set(k, (seen.get(k) ?? 0) + 1);
  }
  return new Set([...seen].filter(([, n]) => n > 1).map(([k]) => k));
}
