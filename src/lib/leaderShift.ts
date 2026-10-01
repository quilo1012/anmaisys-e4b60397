/**
 * Which leaders belong in a selector filtered to one shift.
 *
 * `line_leaders.shift` is stale: of 32 active leaders, 16 say BOTH and almost all of
 * them only ever open a line on one shift. Filtering by the register put 17 names
 * under Night, one of them a night leader. The truth is the history of who opened a
 * line on which shift; the register is only the fallback for someone with no history
 * yet, so a leader hired this week never disappears from both lists.
 */
export type ShiftFilter = "all" | "DAY" | "NIGHT";
export type ObservedShift = "DAY" | "NIGHT";

/** Same key on both sides: `production_sessions.leader_name` is free text. */
export function leaderShiftKey(name: string | null | undefined): string {
  return String(name ?? "").trim().toLowerCase();
}

export function leadersForShift<T extends { name: string; shift?: string | null }>(
  leaders: ReadonlyArray<T>,
  observed: ReadonlyMap<string, ReadonlySet<ObservedShift>>,
  shift: ShiftFilter,
): T[] {
  if (shift === "all") return [...leaders];
  return leaders.filter((l) => {
    const seen = observed.get(leaderShiftKey(l.name));
    if (seen && seen.size > 0) return seen.has(shift);
    const reg = String(l.shift ?? "").trim().toUpperCase();
    return reg === "" || reg === "BOTH" || reg === shift;
  });
}

/** Builds the observed map from session rows; blank names are skipped. */
export function observedShifts(
  rows: ReadonlyArray<{ leader_name: string | null; shift: string | null }>,
): Map<string, Set<ObservedShift>> {
  const m = new Map<string, Set<ObservedShift>>();
  for (const r of rows) {
    const key = leaderShiftKey(r.leader_name);
    const sh = String(r.shift ?? "").trim().toUpperCase();
    if (!key || (sh !== "DAY" && sh !== "NIGHT")) continue;
    if (!m.has(key)) m.set(key, new Set());
    m.get(key)!.add(sh);
  }
  return m;
}
