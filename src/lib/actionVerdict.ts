/**
 * Which actions the Production quality screen is answerable for.
 *
 * The sync already decides this, once, per action: `classifyAction` writes a verdict
 * into `quality_actions.classification` and the SafetyCulture settings screen prints
 * the tally of it. Until now nothing on the Quality screen read that column, so the
 * two screens counted the same rows and disagreed — 66 actions on one, 58 on the
 * other, and a "Quality tracking by leader" whose largest row was `Unassigned: 30`,
 * built almost entirely out of findings raised in Facilities and Goods In that no
 * production leader could ever have been on the floor for.
 *
 * This module is the one place that turns a verdict into "shows here / does not".
 * Read it from the log, the KPIs, the leader table and the scorecard, so those four
 * can no longer drift apart.
 */

export type ActionVerdict = "line" | "leader" | "quality_error" | "needs_review" | "excluded";

/**
 * Verdicts that take an action off this screen entirely.
 *
 * `excluded` is a finding raised outside Production — a different site, a different
 * board. `quality_error` is Quality's own mistake: real, worth fixing, and not a
 * thing any production leader answers for. Neither can be attributed to a line or a
 * leader, so both would land in `Unassigned` and inflate every total on the page.
 *
 * `needs_review` deliberately STAYS. It is not a judgement that the action does not
 * belong here — it is the sync saying it could not evidence one of its checks. Hiding
 * those would hide the queue of work that closes them, which is the opposite of what
 * the settings screen exists to show.
 */
const OFF_SCREEN: ReadonlySet<string> = new Set<ActionVerdict>(["excluded", "quality_error"]);

/**
 * A row with no verdict at all is kept.
 *
 * `classification` is only ever written by the SafetyCulture sync. The 69 actions
 * typed by hand on this screen carry NULL and always will, and reading NULL as "not
 * classified, therefore hide it" would empty the log of everything the factory
 * entered itself.
 */
export function belongsToProduction(action: { classification?: string | null }): boolean {
  const verdict = action.classification;
  if (!verdict) return true;
  return !OFF_SCREEN.has(verdict);
}

/** The rows this screen answers for, in one call. */
export function onlyProduction<T extends { classification?: string | null }>(actions: T[]): T[] {
  return actions.filter(belongsToProduction);
}

/**
 * What was set aside, broken out by why.
 *
 * Printed under the total rather than dropped in silence: eighteen findings vanishing
 * between two screens is exactly the kind of gap that gets rediscovered as a bug six
 * months later. The reader is told the number and where it went.
 */
export function setAside<T extends { classification?: string | null }>(actions: T[]) {
  let excluded = 0;
  let qualityError = 0;
  for (const a of actions) {
    if (a.classification === "excluded") excluded += 1;
    else if (a.classification === "quality_error") qualityError += 1;
  }
  return { excluded, qualityError, total: excluded + qualityError };
}
