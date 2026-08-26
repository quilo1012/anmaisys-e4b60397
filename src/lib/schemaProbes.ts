/**
 * Which missing columns this codebase asks for on purpose.
 *
 * `selectOptions` in useQualityOptions.ts is a ladder: it asks for the newest columns
 * first and drops one per rung until the database answers. PostgREST names only ONE
 * unknown column per error, so probing is the only reliable walk down — and on a
 * database that has not had 20260824090000 applied, the top rungs return
 * `400 42703 column quality_options.is_gate does not exist` every single time, by
 * design, and the ladder catches them and renders the correct answer.
 *
 * `installApiErrorTelemetry` sits on the global fetch, below react-query, and cannot
 * see that. `meta.schemaOptional` does not reach it — that is a react-query layer and
 * only silences the toast. So without this list every probe files as an API_ERROR,
 * on every route, because the syncs that drive the ladder run at the App root.
 *
 * Declared, not inferred — the same doctrine as `userCorrectable`, and for the same
 * reason. Keying on `42703` alone would silence every missing column in the app,
 * including the ones with nothing behind them, and a missing column with no fallback
 * is exactly the drift this log exists to catch. An entry has to be true twice over:
 *
 * 1. **Something falls back**, so the screen is right without the column.
 * 2. **The fallback is named below**, so the claim can be checked and so deleting that
 *    ladder leaves a lie somebody can grep for.
 *
 * Anything unlisted stays a fault. False alarm costs a line in a list; false silence
 * is a green scorecard on a leader with a failed CCP.
 *
 * These are still recorded, as SCHEMA_DRIFT — not dropped. The migration really has
 * not landed, and that is worth knowing. It is just not somebody's bug to chase.
 */
const PROBED_COLUMNS = new Map<string, string>([
  [
    "quality_options.is_gate",
    "useQualityOptions selectOptions rung 2 (20260824090000): absent reads as "
    + "'nothing gates', and useGateLabels().missing says so out loud in the lists manager",
  ],
  [
    "quality_options.counts_against_leader",
    "useQualityOptions selectOptions rung 1 (20260827093000): absent reads as "
    + "'every department charges', the strict direction, and useDepartmentAttribution()"
    + ".missing says so in the lists manager",
  ],
  [
    "quality_options.points",
    "useQualityOptions selectOptions rung 3 (20260815120000): absent reads as "
    + "'unpriced', so severity alone decides the score",
  ],
]);

/**
 * The `table.column` a Postgres 42703 is about, if it names one.
 *
 * Covers the bare and the quoted form; anything else is null, which reads as "not a
 * missing-column message" everywhere this is used.
 */
export function probedColumn(message: string | undefined | null): string | null {
  if (!message) return null;
  const m = /column "?([A-Za-z0-9_]+)"?\."?([A-Za-z0-9_]+)"? does not exist/.exec(message);
  return m ? `${m[1]}.${m[2]}` : null;
}

/** Whether this codebase asks for that column knowing it may not be there. */
export function isProbedColumn(message: string | undefined | null): boolean {
  const col = probedColumn(message);
  return col !== null && PROBED_COLUMNS.has(col);
}
