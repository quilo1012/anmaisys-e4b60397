/**
 * Parses a number `<input>`'s raw text into what the draft actually wants: `null`
 * for an untouched/cleared field, never `0`. Shared by every pillar so "empty
 * stays empty" has one definition instead of four copies that could drift.
 */
export function parseNullableNumber(raw: string): number | null {
  if (raw.trim() === "") return null;
  const n = Number(raw);
  return Number.isNaN(n) ? null : n;
}

/**
 * The four percentage columns — `ppe_compliance_pct`,
 * `hs_training_compliance_pct`, `leader_attendance_pct`, `team_attendance_pct` —
 * are `numeric(5,4)` constrained `BETWEEN 0 AND 1`, and the thresholds they are
 * judged against (`THR_HSTrainRed`, `THR_HSTrainGreen`, `THR_Attend`) are
 * fractions too. So the fraction is the truth and it stays on the wire; what was
 * wrong was the label. A box labelled "PPE compliance %" next to a bare
 * `type="number"` invites `95`, and the database refuses the row.
 *
 * One definition, used by Health & Safety and by Monitored alike — the two bands
 * that hold these columns — so no component scales or bounds them on its own.
 */
export const FRACTION_INPUT = { min: 0, max: 1, step: 0.01 } as const;

/** "PPE compliance" -> "PPE compliance (0–1)". The unit is part of the question. */
export function fractionLabel(label: string): string {
  return `${label} (0–1)`;
}

/** Counters: whole, never negative — `CHECK (… >= 0)` on every one of them. */
export const COUNT_INPUT = { min: 0, step: 1 } as const;
