import { isMissingColumn } from "@/lib/postgrestErrors";

/** What a PostgREST query settles to, in the shape every caller here already handles. */
type Settled<T> = { data: T[] | null; error: unknown };

/**
 * Run a `quality_actions` select that asks for the columns some live database may not
 * have yet, and settle for the log without them rather than losing it entirely.
 *
 * `domain` arrives with 20260817090000. Commit 7739b8b2 added it to four selects on
 * 16/08 so `actionPoints()` would stop pricing a safety row like a quality one — correct
 * in intent, but the migration had not run. PostgREST rejects the ENTIRE query for one
 * unknown column, so those screens did not lose a field, they lost the whole log: the
 * leader scorecard read "No quality action was raised against this leader in this
 * period" over four open ones and scored Quality 100%.
 *
 * Dropping the column is the right reading rather than a workaround, and it is the
 * right reading for both of them. `domain` exists only to tell `actionPoints` to score
 * a safety action at zero, and a base with no `domain` column has no safety actions to
 * find — 20260817090000 is the same migration that creates them. `points_at_creation`
 * is what an action was frozen at, and a base without the column has frozen nothing, so
 * today's scale is the only scale it has ever had. In both cases absent means "compute
 * it live", which is exactly what `actionPoints` does with an undefined field. Same
 * shape as `selectOptions` in useQualityOptions.ts, for the same reason.
 *
 * Only a missing column is forgiven, and only once. An RLS refusal or a dead connection
 * comes back untouched for the caller to throw, because a helper that turned every
 * failure into an empty list would be the bug it was written to fix.
 *
 * @param columns the column list, optional columns included
 * @param run     runs the query for a given column list, e.g. `(c) => db.select(c)...`
 * @returns the settled result — the first attempt's, or the retry's
 */

/**
 * The columns that are newer than some live database, in the order they arrived.
 *
 * A second entry is what forced this to stop being about one column. `domain` arrives
 * with 20260817090000 and `points_at_creation` with 20260822090000, and a database that
 * has neither would have been retried once, still without the second column, and still
 * refused — so the screen would have lost the whole log exactly as it did in August, for
 * a new reason. PostgREST names only ONE unknown column per error, so the only reliable
 * retry is one that drops every optional column at once.
 *
 * `safety_kind` sits beside `domain` because it arrives in the same migration: the enum,
 * the column and the CHECK that ties them together are one statement, so no live base
 * can have one without the other.
 *
 * Delete an entry the day its migration is confirmed applied everywhere. Each one hides
 * real schema drift for as long as it stays.
 */
const OPTIONAL_COLUMNS = ["domain", "safety_kind", "points_at_creation", "scoring_version_id"];

export async function selectOptionalColumns<T>(
  columns: string,
  run: (columns: string) => PromiseLike<Settled<T>>,
): Promise<Settled<T>> {
  const first = await run(columns);
  if (!first.error || !isMissingColumn(first.error as { code?: string; message?: string })) {
    return first;
  }

  // Anywhere in the list, not only at the end — the callers order their columns to read
  // well, not to make this substitution easy. Asking whether they were there beats
  // comparing the rebuilt string to the original, which would differ on spacing alone
  // and spend a second round trip re-asking a question already answered.
  const kept = columns.split(",").map((c) => c.trim()).filter(Boolean);
  if (!kept.some((c) => OPTIONAL_COLUMNS.includes(c))) return first;

  return run(kept.filter((c) => !OPTIONAL_COLUMNS.includes(c)).join(", "));
}

/** @deprecated The name says one column and it now handles several. Use
 *  `selectOptionalColumns`. Kept so the existing call sites and their tests do not all
 *  have to move in the same commit as a scoring change. */
export const selectOptionalDomain = selectOptionalColumns;
