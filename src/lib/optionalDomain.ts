import { isMissingColumn } from "@/lib/postgrestErrors";

/** What a PostgREST query settles to, in the shape every caller here already handles. */
type Settled<T> = { data: T[] | null; error: unknown };

/**
 * Run a `quality_actions` select that asks for `domain`, and settle for the log without
 * it when the column has not been migrated yet.
 *
 * `domain` arrives with 20260817090000. Commit 7739b8b2 added it to four selects on
 * 16/08 so `actionPoints()` would stop pricing a safety row like a quality one — correct
 * in intent, but the migration had not run. PostgREST rejects the ENTIRE query for one
 * unknown column, so those screens did not lose a field, they lost the whole log: the
 * leader scorecard read "No quality action was raised against this leader in this
 * period" over four open ones and scored Quality 100%.
 *
 * Dropping the column is the right reading rather than a workaround. `domain` exists
 * only to tell `actionPoints` to score a safety action at zero, and a base with no
 * `domain` column has no safety actions to find — 20260817090000 is the same migration
 * that creates them. Undefined therefore means "quality", which is what every row in
 * such a base is. Same shape as `selectOptions` in useQualityOptions.ts, for the same
 * reason.
 *
 * Only a missing column is forgiven, and only once. An RLS refusal or a dead connection
 * comes back untouched for the caller to throw, because a helper that turned every
 * failure into an empty list would be the bug it was written to fix.
 *
 * Delete once 20260817090000 is confirmed applied — it hides real schema drift.
 *
 * @param columns the column list, `domain` included
 * @param run     runs the query for a given column list, e.g. `(c) => db.select(c)...`
 * @returns the settled result — the first attempt's, or the retry's
 */
export async function selectOptionalDomain<T>(
  columns: string,
  run: (columns: string) => PromiseLike<Settled<T>>,
): Promise<Settled<T>> {
  const first = await run(columns);
  if (!first.error || !isMissingColumn(first.error as { code?: string; message?: string })) {
    return first;
  }

  // Anywhere in the list, not only at the end — the callers order their columns to read
  // well, not to make this substitution easy. Asking whether `domain` was there beats
  // comparing the rebuilt string to the original, which would differ on spacing alone
  // and spend a second round trip re-asking a question already answered.
  const kept = columns.split(",").map((c) => c.trim()).filter(Boolean);
  if (!kept.includes("domain")) return first;

  return run(kept.filter((c) => c !== "domain").join(", "));
}
