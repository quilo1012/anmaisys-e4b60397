/**
 * The hours a person is on the board for, once their confirmed overtime is counted.
 *
 * The board drew a placement as the shift it sat on — 06:00–18:00 or 18:00–06:00, less
 * a late start, an early finish or a half day — and nothing else. Confirmed overtime
 * reached it only through the bridge (`overtime_board_apply`), which inserts an
 * "overtime" row with no hours on it and `on conflict do nothing`. So:
 *
 *   - somebody already on the board that day who said yes to 12:00–14:00 after a
 *     06:00–12:00 half day kept their row as it was — the board still ended at 12:00;
 *   - somebody placed only by the bridge counted a whole 12-hour shift for a 4-hour ask.
 *
 * The confirmed answers are the record (`overtime_responses.decision = 'accepted'`), so
 * they are read as they stand and laid over the placement here, rather than copied onto
 * the board where an edit or a cancellation would leave a stale copy behind. Nothing is
 * counted twice: the shift and the overtime are merged as intervals.
 *
 * Minutes are counted from 00:00 of the board's date, so a night shift runs 1080–1800
 * and an ask at 02:00 the next morning sits at 1560.
 */

export type BoardShift = "Day" | "Night";

/** One confirmed ask, as the board needs it. */
export interface ConfirmedAsk {
  request_id: string;
  employee_id: string;
  on_date: string;   // yyyy-mm-dd
  starts_at: string; // HH:MM[:SS]
  ends_at: string;
}

/** What a placement contributes, for the hour columns and the chip on the card. */
export interface PlacementHours {
  /** The shift part, in hours (0 for a row the overtime bridge made). */
  base: number;
  /** Overtime beyond the shift part, in hours. */
  overtime: number;
  /** Everything, without counting an overlap twice. */
  total: number;
  /** "06:00–14:00", or "06:00–12:00 + 14:00–16:00" when there is a gap. */
  label: string;
  /**
   * The same, the way the sheet would write it in a cell: "06–14", "06:30–14",
   * "06–12+14–16". The card has one line for its marks; the full label is the tooltip.
   */
  short: string;
  /** The shift part alone, for the detail line ("Shift 06:00–12:00"). Null for a bridge row. */
  shiftLabel: string | null;
  /** The confirmed overtime that reached this placement, in order. */
  overtimeLabels: string[];
  /** The booked hours before any late start / early finish / stay-late: "06:00–14:00". */
  bookedLabel: string;
  /** First start to last end actually worked: "06:00–18:00". */
  workedSpan: string;
  /** What `left_early_at` / `arrived_late_at` mean against the booked hours. */
  marks: WorkedMarks;
}

/**
 * `left_early_at` is used by the office as "went home at" — before the booked end it is
 * an early finish, after it a stay-late. `arrived_late_at` likewise: after the booked
 * start a late start, before it an early start. Minutes, signed, nearest way round the
 * clock, so a night shift crossing midnight reads right.
 */
export interface WorkedMarks {
  /** Minutes before the booked end they went home (> 0), else 0. */
  earlyFinish: number;
  /** Minutes after the booked end they stayed (> 0), else 0. */
  stayLate: number;
  lateStart: number;
  earlyStart: number;
  /** "HH:MM" of the booked start / end. */
  bookedStart: string;
  bookedEnd: string;
}

/** Signed minutes from `ref` (minutes from board midnight) to clock time `t`, in (-720, 720]. */
const signedFrom = (ref: number, t: string): number => {
  let d = (((toMin(t) - ref) % DAY) + DAY) % DAY;
  if (d > DAY / 2) d -= DAY;
  return d;
};

/**
 * The hours actually on the board for one booked window and the two marks. The single
 * place a "went home at" / "came in at" is turned into worked hours.
 */
export function workedWindow(
  booked: [number, number],
  marks: { arrived_late_at: string | null; left_early_at: string | null },
): { window: [number, number]; marks: WorkedMarks } {
  const dIn = marks.arrived_late_at ? signedFrom(booked[0], marks.arrived_late_at) : 0;
  const dOut = marks.left_early_at ? signedFrom(booked[1], marks.left_early_at) : 0;
  const from = booked[0] + dIn;
  const to = Math.max(from, booked[1] + dOut);
  return {
    window: [Math.min(from, to), to],
    marks: {
      earlyFinish: dOut < 0 ? -dOut : 0,
      stayLate: dOut > 0 ? dOut : 0,
      lateStart: dIn > 0 ? dIn : 0,
      earlyStart: dIn < 0 ? -dIn : 0,
      bookedStart: clock(booked[0]),
      bookedEnd: clock(booked[1]),
    },
  };
}

/** "Booked 06:00–14:00, stayed until 18:00" — the tooltip line for the worked hours. */
export function workedNote(m: WorkedMarks, worked: string): string | null {
  const [ws, we] = worked.split("–");
  const bits = [
    m.earlyStart ? `came in at ${ws}` : m.lateStart ? `arrived late at ${ws}` : null,
    m.stayLate ? `stayed until ${we}` : m.earlyFinish ? `left early at ${we}` : null,
  ].filter(Boolean);
  return bits.length ? `Booked ${m.bookedStart}–${m.bookedEnd}, ${bits.join(", ")}` : null;
}

/** The fields of a board row this reads. */
export interface PlacementLike {
  status: string;
  half_day: boolean | null;
  left_early_at: string | null;
  arrived_late_at: string | null;
  /** Set on a row the overtime bridge made for this ask; null on every planned row. */
  overtime_request_id?: string | null;
}

export const SHIFT_MIN = 12 * 60;
const DAY = 1440;

const toMin = (t: string): number => {
  const [h, m] = t.split(":").map(Number);
  return h * 60 + (m || 0);
};

const dayDiff = (a: string, b: string): number =>
  Math.round((Date.UTC(+a.slice(0, 4), +a.slice(5, 7) - 1, +a.slice(8, 10))
    - Date.UTC(+b.slice(0, 4), +b.slice(5, 7) - 1, +b.slice(8, 10))) / 86_400_000);

const plusDays = (iso: string, n: number): string => {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** "HH:MM" for minutes from the board date's midnight, wrapping past 24h. */
export const clock = (min: number): string => {
  const m = ((min % DAY) + DAY) % DAY;
  return `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
};

/**
 * Which board an ask's hours belong to — the same split the bridge uses
 * (`overtime_board_shift`): starting 06:00–17:59 is that day's Day board, from 18:00 that
 * day's Night board, and before 06:00 the Night board of the day before.
 */
export function boardSlotOf(onDate: string, startsAt: string): { date: string; shift: BoardShift } {
  const s = toMin(startsAt);
  if (s >= 360 && s < 1080) return { date: onDate, shift: "Day" };
  if (s >= 1080) return { date: onDate, shift: "Night" };
  return { date: plusDays(onDate, -1), shift: "Night" };
}

/** The ask's window in minutes from `boardDate` 00:00. An end at or before the start is the next day. */
export function askWindow(ask: Pick<ConfirmedAsk, "on_date" | "starts_at" | "ends_at">, boardDate: string): [number, number] {
  const from = dayDiff(ask.on_date, boardDate) * DAY + toMin(ask.starts_at);
  const len = ((toMin(ask.ends_at) - toMin(ask.starts_at)) + DAY) % DAY || DAY;
  return [from, from + len];
}

/**
 * The shift part of a placement: the board's 12 hours, less a late start, an early
 * finish, or the second half of a half day (a half day is the first six hours, which is
 * what "my shift ends at 12:00" is on a day board).
 */
export function shiftWindow(a: PlacementLike, shift: string): [number, number] | null {
  if (a.overtime_request_id) return null; // the bridge's row: overtime and nothing else
  const start = shift === "Night" ? 1080 : 360;
  const rel = (t: string) => start + (((toMin(t) - start) % DAY) + DAY) % DAY;
  let from = start;
  let to = start + (a.half_day ? SHIFT_MIN / 2 : SHIFT_MIN);
  // Only a real late start / early finish cuts the shift here; an early start or a
  // stay-late is laid on by `placementHours` through `workedWindow`.
  if (a.arrived_late_at && signedFrom(from, a.arrived_late_at) > 0) from = Math.min(to, rel(a.arrived_late_at));
  if (a.left_early_at && signedFrom(to, a.left_early_at) < 0) to = Math.max(from, Math.min(to, rel(a.left_early_at)));
  return [from, to];
}

function merge(windows: Array<[number, number]>): Array<[number, number]> {
  const sorted = windows.filter(([a, b]) => b > a).sort((x, y) => x[0] - y[0]);
  const out: Array<[number, number]> = [];
  for (const [a, b] of sorted) {
    const last = out[out.length - 1];
    if (last && a <= last[1]) last[1] = Math.max(last[1], b);
    else out.push([a, b]);
  }
  return out;
}

/** "06" for 06:00, "06:30" otherwise. */
const hour = (min: number): string => { const c = clock(min); return c.endsWith(":00") ? c.slice(0, 2) : c; };
const showShort = ([a, b]: [number, number]) => `${hour(a)}–${hour(b)}`;

const span = (ws: Array<[number, number]>) => ws.reduce((n, [a, b]) => n + (b - a), 0);
const show = ([a, b]: [number, number]) => `${clock(a)}–${clock(b)}`;

/**
 * Whether an `overtime` row on the board is overtime somebody accepted.
 *
 * `daily_allocations.status = 'overtime'` has two writers. The bridge writes it when an
 * answer is accepted, and stamps the row with the ask (`overtime_request_id`). The board
 * writes it too, on its own, whenever somebody is placed or copied onto a shift their
 * rota does not cover (`statusForPlacement`) — so the finance close pays it as overtime.
 * The second says nothing about the person's answer: between 20/10 and 03/11 there were
 * 85 such rows, 74 of them on a shift with an open ask that only 7 had answered and 2
 * had said no to.
 *
 * The status stays as it is — payroll reads it. This is what the board shows as
 * overtime: a row the bridge wrote, or one with an accepted answer for this board.
 */
export function overtimeIsAccepted(
  a: Pick<PlacementLike, "status" | "overtime_request_id">,
  asks: ReadonlyArray<ConfirmedAsk> | undefined,
): boolean {
  return a.status === "overtime" && (!!a.overtime_request_id || (asks?.length ?? 0) > 0);
}

/**
 * Hours for one placement on the board of `boardDate` / `shift`, with the confirmed
 * overtime that belongs to that board laid over it.
 *
 * `asks` may hold anything for this person: only the asks whose slot is this board are
 * used, so the same list can be passed to the Day and the Night board without an ask
 * counting on both.
 */
export function placementHours(
  a: PlacementLike,
  boardDate: string,
  shift: string,
  asks: ReadonlyArray<ConfirmedAsk>,
): PlacementHours {
  const base = shiftWindow(a, shift);
  const fullBase = a.overtime_request_id ? null : shiftWindow({ ...a, left_early_at: null, arrived_late_at: null }, shift);
  const mine = asks
    .filter((q) => { const s = boardSlotOf(q.on_date, q.starts_at); return s.date === boardDate && s.shift === shift; })
    // A bridge row is that one ask's; any other ask lands on a planned row, if there is one.
    .filter((q) => !a.overtime_request_id || q.request_id === a.overtime_request_id)
    .map((q) => askWindow(q, boardDate))
    .sort((x, y) => x[0] - y[0]);

  // A bridge row whose ask is not (or no longer) confirmed: the old reading, a full shift.
  if (!base && mine.length === 0) {
    const whole: [number, number] = shift === "Night" ? [1080, 1800] : [360, 1080];
    const w = workedWindow(whole, a);
    return { base: 0, overtime: (w.window[1] - w.window[0]) / 60, total: (w.window[1] - w.window[0]) / 60, label: show(w.window), short: showShort(w.window), shiftLabel: null, overtimeLabels: [], bookedLabel: show(whole), workedSpan: show(w.window), marks: w.marks };
  }

  const booked = merge([...(fullBase ? [fullBase] : []), ...mine]);
  const bookedSpan: [number, number] = [booked[0][0], booked[booked.length - 1][1]];
  const w = workedWindow(bookedSpan, a);
  let all: Array<[number, number]>;
  if (base) {
    // A planned row: an early finish / late start already cut the shift part (an ask
    // after it still counts, as before); only hours outside everything booked extend it.
    all = merge([base, ...mine]);
    if (w.marks.stayLate) all[all.length - 1][1] = w.window[1];
    if (w.marks.earlyStart) all[0][0] = w.window[0];
  } else {
    // The bridge's row is the ask alone, so the marks move its ends both ways.
    all = merge(booked.map(([x, y]) => [Math.max(x, w.window[0]), Math.min(y, w.window[1])] as [number, number]));
    if (w.marks.stayLate) all[all.length - 1][1] = w.window[1];
    if (w.marks.earlyStart) all[0][0] = w.window[0];
    if (!all.length) all = [[w.window[0], w.window[0]]];
  }
  const total = span(all);
  const baseMin = base ? base[1] - base[0] : 0;
  return {
    base: baseMin / 60,
    overtime: (total - baseMin) / 60,
    total: total / 60,
    label: all.map(show).join(" + "),
    short: all.map(showShort).join("+"),
    shiftLabel: base ? show(base) : null,
    overtimeLabels: mine.map(show),
    bookedLabel: booked.map(show).join(" + "),
    workedSpan: show([all[0][0], all[all.length - 1][1]]),
    marks: w.marks,
  };
}

/**
 * What a board chip draws for one row: the worked hours (when they differ from the
 * plain shift — confirmed overtime, a stay-late or an early start), and the "→" / "←"
 * marks only for a real late start / early finish against the booked hours.
 */
export function chipHours(
  a: PlacementLike | undefined,
  boardDate: string,
  shift: string,
  asks: ReadonlyArray<ConfirmedAsk>,
): { workHours: PlacementHours | null; leftEarlyAt: string | null; arrivedLateAt: string | null } {
  if (!a) return { workHours: null, leftEarlyAt: null, arrivedLateAt: null };
  if (a.status !== "assigned" && a.status !== "overtime") {
    return { workHours: null, leftEarlyAt: a.left_early_at, arrivedLateAt: a.arrived_late_at };
  }
  const h = placementHours(a, boardDate, shift, asks);
  const showHours = h.overtimeLabels.length > 0 || h.marks.stayLate > 0 || h.marks.earlyStart > 0;
  return {
    workHours: showHours ? h : null,
    leftEarlyAt: a.left_early_at && h.marks.earlyFinish ? a.left_early_at : null,
    arrivedLateAt: a.arrived_late_at && h.marks.lateStart ? a.arrived_late_at : null,
  };
}

/**
 * Confirmed overtime for this board that the board does not show as working.
 *
 * The database writes a booking onto the board itself (`overtime_board_apply`), but
 * `on conflict do nothing`: a person who already had a row that day and shift — put
 * there by a copied day, an import, or an absence — kept that row, and the booking
 * landed nowhere. On 01/11 Yuri Correa was told "is coming in" for Mon 02/11 and the
 * Overtime column did not have him. The supervisor had no way to know.
 *
 * So the board compares the two: everybody with a confirmed ask on this board whose
 * row is missing (`row: null`) or is not a working one (`row` is the status in the
 * way — holiday, sick, unpaid, training). Somebody on a line, assigned or overtime, is
 * on the board and is left out. Sorted by the ask's start, then by who.
 */
export function bookedNotOnBoard(
  confirmed: ReadonlyMap<string, ReadonlyArray<ConfirmedAsk>> | undefined,
  rows: ReadonlyArray<{ employee_id: string; status: string }>,
): { employeeId: string; asks: ConfirmedAsk[]; row: string | null }[] {
  if (!confirmed) return [];
  const statusOf = new Map(rows.map((r) => [r.employee_id, r.status]));
  const out: { employeeId: string; asks: ConfirmedAsk[]; row: string | null }[] = [];
  for (const [employeeId, asks] of confirmed) {
    if (asks.length === 0) continue;
    const row = statusOf.get(employeeId) ?? null;
    if (row === "assigned" || row === "overtime") continue;
    out.push({ employeeId, asks: [...asks], row });
  }
  return out.sort((a, b) =>
    a.asks[0].on_date.localeCompare(b.asks[0].on_date)
    || a.asks[0].starts_at.localeCompare(b.asks[0].starts_at)
    || a.employeeId.localeCompare(b.employeeId));
}

/** An accepted answer to an ask, with the cancellation recorded against it. */
export interface CancelledAskRow extends ConfirmedAsk {
  outcome: string;
  recorded_at: string;
  note: string | null;
  /** The login that wrote the cancellation (`overtime_outcomes.recorded_by`). */
  recorded_by: string | null;
  /** The login linked to the person's record, when there is one (`employees.user_id`). */
  employee_user_id: string | null;
}

/** A booking on an ask (`decision = 'accepted'`), with when it was decided. */
export interface ReservePromotion {
  request_id: string;
  employee_id: string;
  decided_at: string;
}

export interface CancelledOnBoard {
  employeeId: string;
  startsAt: string;
  endsAt: string;
  late: boolean;
  cancelledAt: string;
  note: string | null;
  /** Written by a login that is not the person's own: a supervisor at the desk. */
  bySupervisor: boolean;
  /** The reserve moved up into the place, or null when nobody took it. */
  promotedTo: string | null;
}

/** The outcomes that mean "booked, then not coming". A no-show or a sick call is not one. */
const CANCELLATIONS = new Set(["cancelled", "cancelled_in_time", "cancelled_late"]);

const instant = (iso: string) => new Date(iso).getTime();

/**
 * Overtime for this board that somebody booked and then cancelled.
 *
 * `cancel_my_overtime` takes the person off the board and hands the place to a
 * reserve, so the board just lost a name with nothing to say why. The supervisor
 * read it as a gap. This lists who it was, the hours, whether it came late
 * (`cancelled_late`, inside the notice period), who wrote it, and who took the place.
 *
 * Nothing records which reserve a cancel moved up. But the move runs in the cancel's
 * own transaction (`record_overtime_outcome`), and `now()` is the transaction's start,
 * so the reserve's `decided_at` is the cancel's `recorded_at` to the microsecond: a
 * booking on the same ask decided at that instant is the one. None means the place
 * is empty.
 *
 * Somebody still holding another confirmed ask on this board is on it and left out.
 * The ones that leave a gap — late, or nobody took the place — come first, then the
 * most recent.
 */
export function cancelledOnBoard(
  rows: ReadonlyArray<CancelledAskRow>,
  boardDate: string,
  shift: string,
  confirmed: ReadonlyMap<string, ReadonlyArray<ConfirmedAsk>> | undefined,
  promotions: ReadonlyArray<ReservePromotion> = [],
): CancelledOnBoard[] {
  const out = rows
    .filter((r) => CANCELLATIONS.has(r.outcome))
    .filter((r) => {
      const slot = boardSlotOf(r.on_date, r.starts_at);
      return slot.date === boardDate && slot.shift === shift;
    })
    .filter((r) => !(confirmed?.get(r.employee_id)?.length))
    .map((r): CancelledOnBoard => {
      const at = instant(r.recorded_at);
      const took = promotions.find((p) =>
        p.request_id === r.request_id && p.employee_id !== r.employee_id && instant(p.decided_at) === at);
      return {
        employeeId: r.employee_id,
        startsAt: r.starts_at.slice(0, 5),
        endsAt: r.ends_at.slice(0, 5),
        late: r.outcome === "cancelled_late",
        cancelledAt: r.recorded_at,
        note: r.note?.trim() || null,
        bySupervisor: !!r.recorded_by && !!r.employee_user_id && r.recorded_by !== r.employee_user_id,
        promotedTo: took?.employee_id ?? null,
      };
    });
  const leavesAGap = (c: CancelledOnBoard) => (c.late || !c.promotedTo ? 0 : 1);
  return out.sort((a, b) =>
    leavesAGap(a) - leavesAGap(b)
    || instant(b.cancelledAt) - instant(a.cancelledAt)
    || a.employeeId.localeCompare(b.employeeId));
}

const LONDON_DAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", year: "numeric", month: "2-digit", day: "2-digit" });
const LONDON_TIME = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", hour: "2-digit", minute: "2-digit", hour12: false });
const LONDON_WEEKDAY = new Intl.DateTimeFormat("en-GB", { timeZone: "Europe/London", weekday: "short" });

/** "today 07:10", "yesterday 21:45", "Sun 01/11 09:00" — on the factory's clock. */
export function cancelledWhen(iso: string, now = new Date()): string {
  const at = new Date(iso);
  const day = LONDON_DAY.format(at);
  const time = LONDON_TIME.format(at);
  if (day === LONDON_DAY.format(now)) return `today ${time}`;
  if (day === LONDON_DAY.format(new Date(now.getTime() - 86_400_000))) return `yesterday ${time}`;
  return `${LONDON_WEEKDAY.format(at)} ${day.slice(0, 5)} ${time}`;
}
