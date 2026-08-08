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
   * Whether the board this person belongs to was planned at all in the period.
   *
   * The night board has never been filled in, so all forty-eight of its people read as
   * a full period short. Counted with everybody else that is forty-eight invented
   * deficits burying the two or three that are real — a warning nobody can act on
   * teaches people to skip the warnings.
   */
  boardPlanned: boolean;
}

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
      const expected = expectedShifts(r.patternDays, from, to);
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
    inDeficit: withBalance.filter((r) => r.boardPlanned && (r.balance ?? 0) < 0).length,
    deficitShifts: withBalance.reduce(
      (n, r) => n + (r.boardPlanned ? Math.max(0, -(r.balance ?? 0)) : 0), 0,
    ),
    // Nobody works a three-week period without appearing once. A person with a rota
    // and an empty board was not matched by the import — their name is one of the
    // Pedros or Sergios the spreadsheet writes without a surname — and reading their
    // deficit as absence would accuse somebody who came in every day.
    noBoardRecord: rows.filter(
      (r) => r.boardPlanned && r.patternDays?.length
        && r.present + r.holiday + r.sick + r.unpaid === 0,
    ).length,
    onUnplannedBoard: rows.filter((r) => !r.boardPlanned).length,
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
  if (!r.boardPlanned) return false;
  const marked = r.present + r.holiday + r.sick + r.unpaid;
  return marked > 0 && marked >= (r.needed ?? 0) * 0.5;
}
