// Target and actual for a period, at two grains: one row per line (what the
// board and the report header show) and one row per day (what the report's
// history table shows).
//
// Both come out of the same routine, on purpose. The period figures and the
// day-by-day figures are read side by side on the same page, and if they were
// two pieces of arithmetic they would eventually disagree there.

/** A production session, cut down to what the arithmetic actually reads. */
export interface HistorySession {
  session_date: string;
  shift: string;
  line: string;
  leader_name: string | null;
  /** The plan for this session's day/line/shift — RAG Weekly's `plan_qty`. */
  target: number;
  items: { actual: number }[];
}

export interface HistoryRagRow {
  entry_date: string;
  line: string;
  shift: string;
  plan_qty: number;
  actual_qty: number;
}

export interface AggregatedLine {
  line: string;
  leader: string | null;
  target: number;
  actual: number;
  eff: number;
  hasSession: boolean;
  /** Planned to run, nothing logged on the floor. */
  notLogged: boolean;
}

/** One line's day, as the history table prints it. */
export interface DailyHistoryRow extends AggregatedLine {
  date: string;
  shift: string;
}

/**
 * Target and actual per line, from RAG where it exists and the floor's own sessions
 * where it does not.
 *
 * Lifted out of the component so the same arithmetic can be run over one shift's
 * rows as easily as over the period's. A report that summed both shifts printed one
 * row per line for work that happened on two, and a line that made target on days
 * and lost it on nights read as an average that happened on neither.
 */
export function aggregateLines(
  sessions: HistorySession[],
  ragRows: HistoryRagRow[],
  leaderFilter: string,
): AggregatedLine[] {
  type Agg = { line: string; target: number; ragActual: number; sessionActual: number; leader: string | null; hasSession: boolean };
  const map = new Map<string, Agg>();
  const ragLineSet = new Set<string>();
  const blank = (line: string): Agg => ({ line, target: 0, ragActual: 0, sessionActual: 0, leader: null, hasSession: false });

  if (leaderFilter === "__all__") {
    for (const r of ragRows) {
      ragLineSet.add(r.line);
      const cur = map.get(r.line) ?? blank(r.line);
      cur.target += r.plan_qty;
      cur.ragActual += r.actual_qty;
      map.set(r.line, cur);
    }
  }

  for (const s of sessions) {
    const cur = map.get(s.line) ?? blank(s.line);
    // Only add session target if this line wasn't already seeded from RAG (avoid double count).
    if (!ragLineSet.has(s.line)) cur.target += s.target;
    const itemsActual = s.items.reduce((a, i) => a + i.actual, 0);
    cur.sessionActual += itemsActual;
    cur.leader = s.leader_name ?? cur.leader;
    cur.hasSession = true;
    map.set(s.line, cur);
  }

  return Array.from(map.values()).map((x) => {
    const actual = x.ragActual > 0 ? x.ragActual : x.sessionActual;
    // A line that was planned to run but has nothing logged on the floor.
    //
    // This used to look for a RAG figure with no matching shift record — the way
    // Line 1 read 96% and 99% on 29/07 with zero entries on either shift. RAG
    // actual is now derived from the same entries, so the two can no longer
    // disagree and that test can never fire. What still needs flagging the same
    // day is the case it was really catching: a planned line nobody logged.
    const notLogged = x.target > 0 && actual === 0;
    return { line: x.line, target: x.target, actual, leader: x.leader, hasSession: x.hasSession, notLogged, eff: x.target > 0 ? (actual / x.target) * 100 : 0 };
  })
    // Hide empty placeholder lines: no RAG target AND no production (e.g. a session
    // created just by assigning a leader, or an operator opening My Production).
    .filter((x) => x.target > 0 || x.actual > 0)
    .sort((a, b) => b.eff - a.eff);
}

const SHIFT_ORDER = ["DAY", "NIGHT"];
const shiftKey = (s: string | null | undefined) => (s ?? "").trim().toUpperCase();
const shiftRank = (s: string) => {
  const i = SHIFT_ORDER.indexOf(s);
  return i === -1 ? SHIFT_ORDER.length : i;
};

/**
 * Every day of the period that has anything on it, one row per line per shift.
 *
 * A period report answered "how did August go" and nothing else: a line at 123%
 * over the month could have lost four days and made them back in one, and the
 * single row said the same either way. This is the same arithmetic run one day at
 * a time, so the report can print the run rather than the verdict.
 *
 * Days with neither a plan nor production are absent, not zero — a factory that
 * did not run on a Sunday has no 0% Sunday to answer for.
 */
export function buildDailyHistory(
  sessions: HistorySession[],
  ragRows: HistoryRagRow[],
  leaderFilter: string,
): DailyHistoryRow[] {
  // RAG only seeds days when no leader is picked, for the same reason it only
  // seeds lines there: a RAG row does not say who was leading, so a filtered
  // report would inherit days that belong to somebody else.
  const usesRag = leaderFilter === "__all__";
  const dates = new Set<string>(sessions.map((s) => s.session_date));
  if (usesRag) for (const r of ragRows) dates.add(r.entry_date);

  const rows: DailyHistoryRow[] = [];
  for (const date of Array.from(dates).sort()) {
    const daySessions = sessions.filter((s) => s.session_date === date);
    const dayRag = usesRag ? ragRows.filter((r) => r.entry_date === date) : [];
    // Whatever shifts the day actually carries, not just DAY and NIGHT: a row
    // stored with any other value would otherwise vanish from the history while
    // still counting in the totals above it.
    const shifts = Array.from(new Set([...daySessions.map((s) => shiftKey(s.shift)), ...dayRag.map((r) => shiftKey(r.shift))]))
      .sort((a, b) => shiftRank(a) - shiftRank(b) || a.localeCompare(b));
    for (const sh of shifts) {
      const ss = daySessions.filter((s) => shiftKey(s.shift) === sh);
      const rr = dayRag.filter((r) => shiftKey(r.shift) === sh);
      for (const line of aggregateLines(ss, rr, leaderFilter)) rows.push({ ...line, date, shift: sh });
    }
  }
  return rows;
}
