/**
 * Pure-JS mirror of the DB trigger `trg_sync_items_target_from_rag`.
 *
 * When a RAG Weekly `plan_qty` changes, the trigger rescales the per-SKU
 * `target_qty` rows for the matching production session so they sum back
 * to the new plan. Logic:
 *   - If items already carry positive targets → scale proportionally.
 *   - Otherwise → split evenly across all items.
 *   - Values are rounded to integers (Postgres ROUND, half-to-even is
 *     close enough; we mirror with `Math.round`).
 *
 * Keep this in lock-step with the SQL trigger. The unit test next to this
 * file documents the expected behaviour for proportional, even-split, and
 * edge cases (zero items, zero plan).
 */
export interface SplitInput {
  target: number | null | undefined;
  planned: number | null | undefined;
}

export function rescaleItemTargets(items: SplitInput[], newPlan: number): number[] {
  if (!items.length) return [];
  const base = items.map((i) => Number(i.target ?? i.planned ?? 0));
  const sum = base.reduce((a, b) => a + b, 0);
  if (sum > 0) {
    return base.map((v) => Math.round((v * newPlan) / sum));
  }
  return base.map(() => Math.round(newPlan / items.length));
}
