/**
 * Who owns `plan_qty`, and what "Sync from Planner & Downtime" is allowed to do to it.
 *
 * Three screens and a trigger already answered this, in the same direction:
 *
 *   - `trg_sync_items_target_from_rag` rescales `production_items.target_qty` when a
 *     RAG `plan_qty` changes. RAG → Planner.
 *   - `IntouchImportDialog.applyRagPlans`: "Override per-SKU qty using
 *     rag_weekly_entries.plan_qty (source of truth)."
 *   - `ProductionPerformancePage`: "Target comes from RAG Weekly (plan_qty), NOT from
 *     SKU per-item targets."
 *   - `AnalyticsPage`: "Official target lives in the RAG Weekly plan
 *     (rag_weekly_entries.plan_qty) — NOT on production_items."
 *
 * `RAGWeeklyPage`'s sync went the other way: it summed the per-SKU targets and wrote
 * the total over `plan_qty`. That is the one place in the codebase that lets a derived
 * figure overwrite the agreed one, and it is why the board and the Planner disagreed —
 * whichever was pressed last won, and the loser was usually the plan somebody agreed.
 *
 * The Planner keeps one job here: seeding a cell nobody has planned yet. A cell that
 * carries a plan keeps it.
 */

/**
 * The `plan_qty` to write for one line/date/shift when the Planner is synced in.
 *
 * @param plannerPlan  Sum of `COALESCE(target_qty, planned_qty, 0)` over the session's items.
 * @param existingPlan The plan already on the RAG row, if the row exists.
 */
export function planAfterPlannerSync(
  plannerPlan: number | null | undefined,
  existingPlan: number | null | undefined,
): number {
  const agreed = clamp(existingPlan);
  // Zero is "nobody has planned this cell", not "the plan is zero" — a cell whose plan
  // is genuinely nothing is a cell with no row, and the board prints a dash for both.
  if (agreed > 0) return agreed;
  return clamp(plannerPlan);
}

function clamp(v: number | null | undefined): number {
  const n = Number(v);
  return Number.isFinite(n) && n > 0 ? n : 0;
}
