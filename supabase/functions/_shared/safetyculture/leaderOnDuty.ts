/**
 * Which shift was open on a line when a finding was raised.
 *
 * `leader_line_assignment` was answering this question and could not. It holds seven
 * rows, every one of them open ended — "Rafael Tosta has Line 4 from 2026-08-17, no
 * end date" — so every action on Line 4, on any day, at any hour, came out in Rafael's
 * name. Measured against `production_sessions` on 07/09/2026 that was the wrong leader
 * on fourteen of the twenty-two imported actions carrying one, across six lines. It is
 * not a data-entry slip; a fixed assignment cannot express a rota.
 *
 * `production_sessions` is written when somebody opens the line, and it records the
 * line, the date, the shift and who opened it. That is the answer, and it is already
 * being collected.
 */

export interface ProductionSession {
  line: string;
  /** When the line was opened. The ordering key — not `session_date`. */
  started_at: string;
  leader_name: string | null;
  session_date?: string | null;
  shift?: string | null;
}

/**
 * How long after opening a session can still be the one in charge.
 *
 * A shift is twelve hours and nobody closes the row — `finished_at` is null on every
 * session in the table — so the window is what stands in for a closing time. Sixteen
 * leaves room for an overrun without letting yesterday's night shift claim this
 * morning's finding.
 */
const MAX_HOURS = 16;

const norm = (v: unknown) => String(v ?? "").trim().toLowerCase();

const ms = (iso: string | null | undefined): number | null => {
  if (!iso) return null;
  const t = new Date(iso).getTime();
  return Number.isNaN(t) ? null : t;
};

/**
 * The session that was open on `line` at `at`, or null.
 *
 * The last one opened before that moment wins, which is what makes the night shift
 * work: nights start around 17:00 and run past midnight, so an action at 02:23 on the
 * 3rd belongs to the session opened at 17:09 on the 2nd. A lookup keyed on the
 * calendar date of the action finds nothing for those — and "nothing" was exactly when
 * the standing assignment used to step in and name the day-shift leader instead.
 *
 * A session with nobody recorded on it is still returned. That is a known gap and the
 * caller has to report it; falling back to the standing assignment is how the wrong
 * name got onto these records to begin with.
 */
export function sessionInCharge(
  line: string,
  at: string | null | undefined,
  sessions: ProductionSession[],
  maxHours: number = MAX_HOURS,
): ProductionSession | null {
  const when = ms(at);
  if (when === null) return null;
  const key = norm(line);
  if (!key) return null;

  const floor = when - maxHours * 3_600_000;
  let best: ProductionSession | null = null;
  let bestAt = -Infinity;

  for (const s of sessions) {
    if (norm(s.line) !== key) continue;
    const opened = ms(s.started_at);
    // Strictly at or before the finding, and not so long before that the shift it
    // belongs to had already gone home.
    if (opened === null || opened > when || opened <= floor) continue;
    if (opened > bestAt) {
      bestAt = opened;
      best = s;
    }
  }
  return best;
}
