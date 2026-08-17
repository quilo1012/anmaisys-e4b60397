import { isMissingColumn } from "@/lib/postgrestErrors";

/** What a PostgREST write settles to, in the shape every caller here already handles. */
type Settled<T> = { data: T | null; error: unknown };

/**
 * The migration that has to run before a safety occurrence can be recorded at all.
 * Named in the message because "column does not exist" tells the person at the tablet
 * nothing they can act on, and tells whoever they call exactly the wrong thing.
 */
const SAFETY_MIGRATION = "20260817090000";

/**
 * Run a `quality_actions` insert or update that carries `domain` and `safety_kind`,
 * and settle for a base that has neither — but only when doing so loses nothing.
 *
 * `buildQualityActionPayload` sends both columns on every write. They arrive with
 * 20260817090000, and PostgREST rejects an entire write for one unknown column
 * (PGRST204 from its schema cache), so on a base without them nobody can log or edit
 * a quality action at all.
 *
 * WHY THIS IS NOT A COPY OF `selectOptionalDomain`. On the read side, dropping the
 * column is simply the right reading: a base with no `domain` column has no safety
 * actions in it, so every row is quality. On the write side that is only true for
 * half the rows.
 *
 *   - A quality action loses nothing. `domain` defaults to 'quality' and its
 *     `safety_kind` was going to be null. The row that lands is the row that was
 *     asked for, and the save goes through.
 *
 *   - A safety occurrence loses everything. Saved without `domain` it IS a quality
 *     action, and `actionPoints()` charges the leader for it — a near miss reported
 *     would cost points, which is the precise inversion the safety design exists to
 *     prevent (see 20260817090000: "safety is counted, never scored"). It would also
 *     be counted as a quality deviation in every total on every screen.
 *
 * So a safety write is refused rather than degraded. A save the person is told about
 * can be made again once the migration runs; an occurrence silently filed as
 * something else is a wrong number nobody will ever go looking for.
 *
 * Only a missing column is forgiven, and only once. An RLS refusal or a dead
 * connection comes back untouched for the caller to throw.
 *
 * Delete once 20260817090000 is confirmed applied — it hides real schema drift.
 */
export async function writeOptionalDomain<T>(
  payload: Record<string, unknown>,
  run: (payload: Record<string, unknown>) => PromiseLike<Settled<T>>,
): Promise<Settled<T>> {
  const first = await run(payload);
  if (!first.error || !isMissingColumn(first.error as { code?: string; message?: string })) {
    return first;
  }

  if (payload.domain === "safety") {
    return {
      data: null,
      error: {
        code: "SAFETY_COLUMNS_MISSING",
        message:
          `This database cannot record a safety occurrence yet — migration ${SAFETY_MIGRATION} ` +
          `has not been applied. Saving it without its kind would file it as a quality action ` +
          `and charge the leader points for it, so nothing was saved.`,
      },
    };
  }

  const { domain: _domain, safety_kind: _safetyKind, ...withoutDomain } = payload;
  return run(withoutDomain);
}
