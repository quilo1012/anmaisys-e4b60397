/**
 * Which board a person is actually drawn on.
 *
 * `boardShiftFor` maps a crew to a board — Weekend crew to the Weekend board. That is
 * the tidy answer and it is not what the factory does. Their own headcount sheets put
 * the Fri–Mon crew, the warehouse and the day shift on one sheet per day, because they
 * all work while the lines run; only the night crew is drawn apart. When those sheets
 * were imported, every one of them landed on the Day board.
 *
 * So approving leave for Talita Melech wrote a holiday onto the Weekend board, where
 * she is the only thing on it, while the board everybody reads showed her as absent
 * from the plan. Two rules for one question, and the quieter one won.
 *
 * The rule here is not a third opinion. It asks where this person has actually been
 * put, and only falls back to the crew mapping for somebody with no history — a new
 * starter, or a crew that has never been planned.
 */

/** How many days of history to weigh. Long enough to survive a fortnight of leave. */
const WINDOW_DAYS = 60;

export interface BoardRow {
  shift: string;
  on_date: string;
}

/**
 * The board this person appears on most, or null when they have never been placed.
 *
 * Ties break towards the most recent, because somebody who moved crews last month
 * belongs on the board they are on now rather than the one they were on longest.
 */
export function boardFromHistory(rows: BoardRow[], today: string): string | null {
  const cutoff = new Date(Date.parse(`${today}T00:00:00Z`) - WINDOW_DAYS * 86_400_000)
    .toISOString().slice(0, 10);
  const seen = new Map<string, { n: number; latest: string }>();
  for (const r of rows) {
    if (!r.shift || r.on_date < cutoff) continue;
    const cur = seen.get(r.shift);
    if (!cur) seen.set(r.shift, { n: 1, latest: r.on_date });
    else seen.set(r.shift, { n: cur.n + 1, latest: r.on_date > cur.latest ? r.on_date : cur.latest });
  }
  if (seen.size === 0) return null;
  return [...seen.entries()].sort(
    (a, b) => b[1].n - a[1].n || b[1].latest.localeCompare(a[1].latest),
  )[0][0];
}

/**
 * Where to write a day for this person: their own history first, the crew mapping
 * second, and null when neither knows — at which point the attendance record still
 * carries the day and only the board drawing is skipped.
 */
export function boardShiftForPerson(
  rows: BoardRow[],
  today: string,
  crewFallback: string | null,
): string | null {
  return boardFromHistory(rows, today) ?? crewFallback;
}
