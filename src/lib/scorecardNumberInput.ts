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
