/**
 * What the employee panel says a person did: their shift/rota/position timeline, and
 * their overtime as each source holds it.
 *
 * Pure: the hooks in useWorkforce read, this decides what is shown. Nothing here writes
 * or "repairs" one source from another — the board, the clock and payroll are listed
 * side by side and never added into each other (AGENTS.md, "two separate records").
 */
import { currentShift } from "@/lib/operationalShift";
import { windowLabel } from "@/lib/overtimeRequests";
import { askWindow, clock, workedWindow } from "@/lib/boardOvertime";

/* ------------------------------------------------------------ position timeline ---- */

export interface DatedPosition {
  shift_group: string | null;
  shift_pattern_id: string | null;
  effective_from: string;
  note: string | null;
}

export interface RecordChange {
  id: string;
  changed_at: string;
  before_values: { position?: string | null; shift_group?: string | null; shift_pattern_id?: string | null };
  after_values: RecordChange["before_values"];
}

export interface TimelineEntry {
  key: string;
  /** Operational date (yyyy-mm-dd) the change applies from. */
  date: string;
  /** Exact moment, when the source records one. */
  at: string | null;
  opening: boolean;
  lines: string[];
  note: string | null;
}

export interface PositionTimeline {
  entries: TimelineEntry[];
  /** Dated rows identical to the row before them — kept, not shown as changes. */
  hiddenNoops: number;
  hasDated: boolean;
}

const notSet = (v: string | null | undefined) => (v ? v : "Not set");

/**
 * One timeline, newest first, from the dated shift history and the record trigger.
 * `patternName` turns a rota id into its name.
 */
export function buildPositionTimeline(
  dated: DatedPosition[],
  record: RecordChange[],
  patternName: (id: string | null) => string,
): PositionTimeline {
  const oldestFirst = [...dated].sort((a, b) => a.effective_from.localeCompare(b.effective_from));
  const entries: TimelineEntry[] = [];
  let hiddenNoops = 0;
  // Signatures of dated changes, to show a change once when both sources hold it.
  const datedSigs = new Set<string>();

  oldestFirst.forEach((row, i) => {
    const prev = i > 0 ? oldestFirst[i - 1] : null;
    if (!prev) {
      entries.push({
        key: `d-${row.effective_from}`, date: row.effective_from, at: null, opening: true,
        lines: [`Opening position: ${notSet(row.shift_group)} · ${patternName(row.shift_pattern_id)}`],
        note: row.note,
      });
      return;
    }
    const lines: string[] = [];
    if ((prev.shift_group ?? null) !== (row.shift_group ?? null)) {
      lines.push(`Shift: ${notSet(prev.shift_group)} → ${notSet(row.shift_group)}`);
    }
    if ((prev.shift_pattern_id ?? null) !== (row.shift_pattern_id ?? null)) {
      lines.push(`Rota: ${patternName(prev.shift_pattern_id)} → ${patternName(row.shift_pattern_id)}`);
    }
    if (lines.length === 0) { hiddenNoops += 1; return; }
    datedSigs.add(`${row.effective_from}|${row.shift_group ?? ""}|${row.shift_pattern_id ?? ""}`);
    entries.push({ key: `d-${row.effective_from}`, date: row.effective_from, at: null, opening: false, lines, note: row.note });
  });

  for (const c of record) {
    const b = c.before_values ?? {}, a = c.after_values ?? {};
    const date = currentShift(new Date(c.changed_at)).operationalDate;
    const lines: string[] = [];
    if ((b.position ?? null) !== (a.position ?? null)) lines.push(`Position: ${notSet(b.position)} → ${notSet(a.position)}`);
    const shiftMoved = (b.shift_group ?? null) !== (a.shift_group ?? null) || (b.shift_pattern_id ?? null) !== (a.shift_pattern_id ?? null);
    const alreadyDated = datedSigs.has(`${date}|${a.shift_group ?? ""}|${a.shift_pattern_id ?? ""}`);
    if (shiftMoved && !alreadyDated) {
      if ((b.shift_group ?? null) !== (a.shift_group ?? null)) lines.push(`Shift: ${notSet(b.shift_group)} → ${notSet(a.shift_group)}`);
      if ((b.shift_pattern_id ?? null) !== (a.shift_pattern_id ?? null)) {
        lines.push(`Rota: ${patternName(b.shift_pattern_id ?? null)} → ${patternName(a.shift_pattern_id ?? null)}`);
      }
    }
    if (lines.length === 0) continue;
    entries.push({ key: `r-${c.id}`, date, at: c.changed_at, opening: false, lines, note: null });
  }

  entries.sort((x, y) => y.date.localeCompare(x.date) || (y.at ?? "").localeCompare(x.at ?? "") || Number(x.opening) - Number(y.opening));
  return { entries, hiddenNoops, hasDated: dated.length > 0 };
}

/* ------------------------------------------------------------- board overtime ---- */

export interface BoardOvertimeRow {
  on_date: string;
  shift: string;
  area_name: string | null;
  overtime_request_id: string | null;
  /** "Went home at" / "came in at" on the board row; read through `workedWindow`. */
  left_early_at?: string | null;
  arrived_late_at?: string | null;
}

export interface AskResponse {
  request_id: string;
  on_date: string;
  starts_at: string;
  ends_at: string;
  outcome: string | null;
}

export interface ClockDay {
  on_date: string;
  start_time: string | null;
  end_time: string | null;
  worked_minutes: number | null;
  balance_minutes: number | null;
}

export type OvertimeLineState = "worked" | "booked" | "cancelled";

export interface OvertimeLine {
  key: string;
  date: string;
  shift: string | null;
  area: string | null;
  /** The hours worked on the board: the ask's window, moved by a late start / early finish / stay-late. */
  hours: string | null;
  /** The ask's window as offered, when it differs from what was worked. */
  booked?: string | null;
  outcome: string | null;
  state: OvertimeLineState;
  clock: ClockDay | null;
}

export interface OvertimeSummary {
  last30: number;
  total: number;
  upcoming: number;
}

export const OUTCOME_LABEL: Record<string, string> = {
  attended: "Attended",
  no_show: "No-show",
  called_sick: "Called in sick",
  cancelled: "Cancelled",
  cancelled_in_time: "Cancelled in time",
  cancelled_late: "Cancelled late",
};

const CANCELLED = new Set(["cancelled_in_time", "cancelled_late"]);

const addDays = (iso: string, n: number) => {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

/** Worked hours for a board row from an ask, with the ask's window as "booked". */
function workedOf(b: BoardOvertimeRow, ask: AskResponse | undefined): { hours: string | null; booked: string | null } {
  if (!ask) return { hours: null, booked: null };
  const offered = windowLabel(ask.starts_at, ask.ends_at);
  if (!b.left_early_at && !b.arrived_late_at) return { hours: offered, booked: null };
  const w = workedWindow(askWindow(ask, ask.on_date), { left_early_at: b.left_early_at ?? null, arrived_late_at: b.arrived_late_at ?? null });
  const worked = windowLabel(clock(w.window[0]), clock(w.window[1]));
  return worked === offered ? { hours: offered, booked: null } : { hours: worked, booked: offered };
}

/**
 * The board's overtime rows for one person, newest first, with the ask they came from
 * and, beside them, the clock's own record for the date. Cancelled bookings from an
 * ask are listed even though their board row is gone. Counts are shifts on the board;
 * the clock is never counted in.
 */
export function buildBoardOvertime(
  board: BoardOvertimeRow[],
  asks: AskResponse[],
  clock: ClockDay[],
  today: string,
): { lines: OvertimeLine[]; summary: OvertimeSummary } {
  const askById = new Map(asks.map((a) => [a.request_id, a]));
  const clockByDate = new Map(clock.map((c) => [c.on_date, c]));
  const lines: OvertimeLine[] = board.map((b, i) => {
    const ask = b.overtime_request_id ? askById.get(b.overtime_request_id) : undefined;
    return {
      key: `b-${b.on_date}-${b.shift}-${i}`,
      date: b.on_date,
      shift: b.shift,
      area: b.area_name,
      ...workedOf(b, ask),
      outcome: ask?.outcome ?? null,
      state: b.on_date > today ? "booked" : "worked",
      clock: clockByDate.get(b.on_date) ?? null,
    };
  });
  const onBoard = new Set(board.map((b) => b.overtime_request_id).filter(Boolean));
  for (const a of asks) {
    if (!a.outcome || !CANCELLED.has(a.outcome) || onBoard.has(a.request_id)) continue;
    lines.push({
      key: `c-${a.request_id}`, date: a.on_date, shift: null, area: null,
      hours: windowLabel(a.starts_at, a.ends_at), outcome: a.outcome, state: "cancelled",
      clock: clockByDate.get(a.on_date) ?? null,
    });
  }
  lines.sort((x, y) => y.date.localeCompare(x.date) || (x.shift ?? "").localeCompare(y.shift ?? ""));
  const since = addDays(today, -30);
  const summary: OvertimeSummary = {
    total: board.filter((b) => b.on_date <= today).length,
    last30: board.filter((b) => b.on_date <= today && b.on_date > since).length,
    upcoming: board.filter((b) => b.on_date > today).length,
  };
  return { lines, summary };
}
