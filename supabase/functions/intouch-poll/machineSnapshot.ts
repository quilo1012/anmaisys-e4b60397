// Write a machine's reading only when the reading changed.
//
// Every run used to UPDATE every mapped machine (status, code, stop clock,
// last_seen_at, updated_at), changed or not: ~10 statements a minute, 12,850 calls
// in pg_stat_statements on 11/11/2026, and each one fired the
// `trg_intouch_machine_state_moves_the_order` trigger, because the SET named
// `last_downtime_code` even when the value was the same.
//
// `last_seen_at` still has to move every minute: the board calls a reading older
// than 90 s stale. So an unchanged machine gets only that, and all of them together
// in one statement.

export interface MachineReading {
  last_status: number | null;
  last_downtime_code: string | null;
  stop_since_at: string | null;
}

const sameInstant = (a: string | null, b: string | null) => {
  if (a == null || b == null) return a == null && b == null;
  // The database answers "2026-11-11T10:00:00+00:00", the poll writes
  // "2026-11-11T10:00:00.000Z". Same instant, different text.
  const ta = new Date(a).getTime();
  const tb = new Date(b).getTime();
  return Number.isNaN(ta) || Number.isNaN(tb) ? a === b : ta === tb;
};

/**
 * True when the row must be written in full. A machine never seen before is always
 * written, so its first reading becomes the baseline the next poll compares with.
 */
export function readingChanged(
  previous: MachineReading & { last_seen_at: string | null },
  next: MachineReading,
): boolean {
  if (!previous.last_seen_at) return true;
  const prevStatus = previous.last_status == null ? null : Number(previous.last_status);
  if (prevStatus !== next.last_status) return true;
  if ((previous.last_downtime_code ?? null) !== (next.last_downtime_code ?? null)) return true;
  return !sameInstant(previous.stop_since_at, next.stop_since_at);
}
