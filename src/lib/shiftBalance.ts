/**
 * Overtime counted in shifts, from the board rather than from the clocks.
 *
 * The hours model in `financeClose.ts` is the one the factory pays from: a 44-hour
 * week, settled every 28 days, positive paid and negative deducted. It needs
 * `attendance_days`, which needs a TimeMoto import.
 *
 * This is the other question, answerable today for everybody: how many shifts was
 * somebody due, and how many did they come to? The rota says what is due — a Mon–Thu
 * pattern owes fourteen shifts across three weeks and a Fri–Mon owes thirteen — and
 * the headcount board says who was there.
 *
 * THE TWO DO NOT MEASURE THE SAME THING and are never added together. Somebody who
 * works every shift and goes home at two every day is level on shifts and short on
 * hours; `daily_allocations.left_early_at` exists precisely because that person was
 * invisible. Shifts answer "did they turn up"; hours answer "how long were they here".
 * Reported side by side, like the clocked and payroll overtime figures, because a
 * merged number would hide which question it answered.
 */

export interface ShiftBalanceInput {
  employeeId: string;
  name: string;
  department: string | null;
  patternName: string | null;
  /** ISO weekdays the rota covers: 1 = Monday … 7 = Sunday. Null when none is on file. */
  patternDays: number[] | null;
  /** Days marked assigned or overtime on the board. */
  present: number;
  holiday: number;
  sick: number;
  unpaid: number;
  /**
   * The days somebody drew the board this person belongs to — see `plannedBoardDates`.
   *
   * NOT A BOOLEAN, and it was one: "was this board planned at all in the period". One
   * planned day made the whole period count, so the thirty names on the Night board on
   * 07/08 turned all forty-eight of that crew from excluded into a full period short.
   * Finance Close was moved off the boolean and this was left on it, and the two
   * screens then reported different deficits for the same crew over the same period.
   *
   * Null means the caller does not know, and every rostered day counts — right when
   * the board is complete and only then. An empty set means the board was never drawn,
   * so nothing was due and no deficit can be invented.
   */
  plannedDates: ReadonlySet<string> | null;
}

/**
 * Whether the board was ever drawn for this person's crew.
 *
 * A gap in the record rather than an absence, and the totals count it as one. Null is
 * "not known", which is treated as planned: the caller who does not pass the dates is
 * asking for every rostered day to count.
 */
const boardWasPlanned = (r: { plannedDates: ReadonlySet<string> | null }) =>
  r.plannedDates == null || r.plannedDates.size > 0;

export interface ShiftBalance extends ShiftBalanceInput {
  /** Shifts the rota called for across the period. Null when no rota is on file. */
  expected: number | null;
  /** Expected less booked holiday — the shifts they actually owed. */
  needed: number | null;
  /** present − needed. Positive is overtime, negative is shifts short. */
  balance: number | null;
}

/** Shifts a rota calls for between two dates, both ends included. */
export function expectedShifts(
  patternDays: number[] | null | undefined,
  from: string,
  to: string,
  /**
   * The days somebody actually filled the board in for this person's shift.
   *
   * A day the board was never planned cannot be a day somebody failed to turn up. In
   * the period 13/07–09/08 the Day board is empty on 31/07 and holds two names on
   * 06/08, and the Night board is empty on twenty-seven of the twenty-eight days —
   * without this, everybody on days reads two shifts short for a Friday nobody
   * planned, and the whole night crew reads a full period short.
   *
   * Omit it and every rostered day counts, which is right when the board is complete
   * and only then.
   */
  plannedDates?: ReadonlySet<string> | null,
): number | null {
  if (!patternDays?.length) return null;
  const start = Date.parse(`${from}T00:00:00Z`);
  const end = Date.parse(`${to}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end) || end < start) return null;
  const days = new Set(patternDays);
  let n = 0;
  for (let t = start; t <= end; t += 86_400_000) {
    const d = new Date(t);
    // getUTCDay is 0-6 from Sunday; the rotas are stored 1-7 from Monday.
    const iso = d.getUTCDay() || 7;
    if (!days.has(iso)) continue;
    if (plannedDates && !plannedDates.has(d.toISOString().slice(0, 10))) continue;
    n += 1;
  }
  return n;
}

/**
 * Only holiday comes off what was owed.
 *
 * Sickness and unpaid leave are counted and shown but do not reduce the requirement,
 * because that was the rule agreed and it is not this file's to change: deducting them
 * as well moves five more people into overtime on the period this was written, which
 * is a payroll decision rather than an arithmetic one. They are carried through as
 * their own figures so the choice stays visible rather than buried in a subtraction.
 */
export function buildShiftBalances(
  rows: ShiftBalanceInput[],
  from: string,
  to: string,
): ShiftBalance[] {
  return rows
    .map((r) => {
      // Per day, not per period. Without the dates every rostered day counted, and a
      // board drawn once charged a whole period of shifts to everybody on it.
      const expected = expectedShifts(r.patternDays, from, to, r.plannedDates);
      // Never below zero: more holiday than shifts due means the rota changed
      // mid-period, not that they owe negative work.
      const needed = expected == null ? null : Math.max(0, expected - r.holiday);
      const balance = needed == null ? null : r.present - needed;
      return { ...r, expected, needed, balance };
    })
    .sort((a, b) => (b.balance ?? -Infinity) - (a.balance ?? -Infinity) || a.name.localeCompare(b.name));
}

export interface ShiftTotals {
  people: number;
  /** People whose board attendance exceeded what they owed. */
  inOvertime: number;
  overtimeShifts: number;
  /** People short — see `unreliableShort`. */
  inDeficit: number;
  deficitShifts: number;
  /** People on a planned board with not one line on it — a gap worth chasing. */
  noBoardRecord: number;
  /** People whose whole board was never planned. Not their absence; nobody's entry. */
  onUnplannedBoard: number;
  noPattern: number;
}

export function shiftTotals(rows: ShiftBalance[]): ShiftTotals {
  const withBalance = rows.filter((r) => r.balance != null);
  return {
    people: rows.length,
    inOvertime: withBalance.filter((r) => (r.balance ?? 0) > 0).length,
    overtimeShifts: withBalance.reduce((n, r) => n + Math.max(0, r.balance ?? 0), 0),
    // A board nobody filled in produces a shortfall for everybody on it. That is a
    // fact about the board, so it is counted as one and kept out of the deficit.
    inDeficit: withBalance.filter((r) => boardWasPlanned(r) && (r.balance ?? 0) < 0).length,
    deficitShifts: withBalance.reduce(
      (n, r) => n + (boardWasPlanned(r) ? Math.max(0, -(r.balance ?? 0)) : 0), 0,
    ),
    // Nobody works a three-week period without appearing once. A person with a rota
    // and an empty board was not matched by the import — their name is one of the
    // Pedros or Sergios the spreadsheet writes without a surname — and reading their
    // deficit as absence would accuse somebody who came in every day.
    noBoardRecord: rows.filter(
      (r) => boardWasPlanned(r) && r.patternDays?.length
        && r.present + r.holiday + r.sick + r.unpaid === 0,
    ).length,
    onUnplannedBoard: rows.filter((r) => !boardWasPlanned(r)).length,
    noPattern: rows.filter((r) => !r.patternDays?.length).length,
  };
}

/**
 * Whether a shortfall can be believed.
 *
 * The overtime side is safe: the board cannot invent a day somebody stood on a line.
 * The deficit side is not, and this says so per row rather than in a footnote. A name
 * the import could not place produces a full-period deficit that is a gap in the
 * record, not an absence — Luiz Badejo shows thirteen shifts short off one board line,
 * having worked the period.
 */
export function shortfallIsReliable(r: ShiftBalance): boolean {
  if ((r.balance ?? 0) >= 0) return true;
  // Nothing on an unplanned board can be believed either way.
  if (!boardWasPlanned(r)) return false;
  const marked = r.present + r.holiday + r.sick + r.unpaid;
  return marked > 0 && marked >= (r.needed ?? 0) * 0.5;
}

/**
 * The dates each board was actually drawn for.
 *
 * `expectedShifts` reads this to answer "was this a day somebody could have failed to
 * turn up", and the answer has to come from the board being DRAWN — not merely from
 * the board holding a row.
 *
 * A HOLIDAY IS BOOKED BEFORE THE DAY EXISTS. On 07/09/2026, the first day of the
 * 07/09–11/10 period, the Night board held one drawn day and sixteen dates of leave
 * keyed on 14/08 — three weeks before the period opened. Counting those as planned
 * charged forty-eight people with seventeen shifts due against one worked, and the
 * close reported 751 shifts short on a period that had run for a single day.
 *
 * Every other status is marked against a day somebody had already drawn: `assigned`
 * and `overtime` place a person on a line, and `sick` and `unpaid` are keyed on the
 * day itself. Only holiday arrives ahead of the board, so only holiday is excluded.
 *
 * A day whose whole crew is on booked leave therefore reads as unplanned rather than
 * as a day everybody missed — nothing due, nothing worked, no deficit invented.
 */
export function plannedBoardDates(
  rows: ReadonlyArray<{ on_date: string; shift: string | null; status: string | null }>,
): Map<string, Set<string>> {
  const byBoard = new Map<string, Set<string>>();
  for (const r of rows) {
    if (!r.shift || r.status === "holiday") continue;
    let dates = byBoard.get(r.shift);
    if (!dates) byBoard.set(r.shift, (dates = new Set<string>()));
    dates.add(r.on_date);
  }
  return byBoard;
}

/**
 * The last day of a pay period that has actually happened.
 *
 * The close opens on the period covering today, which is by definition still running.
 * 07/09–11/10 is thirty-five days and on the seventh only one of them had been worked;
 * counting the other thirty-four as shifts due makes every single person on the payroll
 * read short by the remainder of the period, every time the screen is opened.
 *
 * Clamping the window is a no-op on a period that has closed, so the document finance
 * is handed at the end of the period is unchanged. It only bites on the one being
 * watched while it runs, which is the only one anybody ever looks at early.
 *
 * A period that has not started yet comes back inverted — `to` before `from` — and
 * `expectedShifts` answers null to that rather than zero. "Not yet a question" is what
 * a future period is; "owes nothing" is what zero would say.
 */
export function periodElapsedTo(to: string, today: string): string {
  return to < today ? to : today;
}
