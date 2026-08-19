/**
 * Reading a Supabase failure well enough to say something useful about it.
 *
 * Two layers can refuse the same request and they do not speak the same language.
 * Postgres answers with a five-character SQLSTATE; PostgREST answers with its own
 * `PGRST***` codes, and for writes it often never asks Postgres at all — it validates
 * the body against a cached copy of the schema and refuses on its own authority.
 */

/** Postgres: a statement named a column that is not there. Reads get this. */
const UNDEFINED_COLUMN = "42703";

/**
 * PostgREST: the column is absent from its schema cache. Writes get this.
 *
 * Worth knowing when a migration HAS run and this still appears: the cache is
 * PostgREST's, not the database's, and it can lag a DDL statement by a moment.
 * `NOTIFY pgrst, 'reload schema';` settles it.
 */
const SCHEMA_CACHE_MISS = "PGRST204";

/**
 * Whether a failure means "this database does not have that column yet".
 *
 * Deliberately narrow. Everything else — a permission refusal, a check constraint,
 * a dropped connection — has to keep its own message: telling somebody the migration
 * has not run when their RLS policy refused them sends them to fix the wrong thing.
 */
export function isMissingColumn(error: { code?: string; message?: string } | null | undefined): boolean {
  return error?.code === UNDEFINED_COLUMN || error?.code === SCHEMA_CACHE_MISS;
}

/** Postgres: a statement named a relation that is not there. Reads get this. */
const UNDEFINED_TABLE = "42P01";

/** PostgREST: the table is absent from its schema cache. Writes get this. */
const TABLE_CACHE_MISS = "PGRST205";

/**
 * Whether a failure means "this database does not have that table yet".
 *
 * Kept apart from `isMissingColumn` because the two send you to different places. A
 * missing column switches one feature off; a missing table can switch off a whole
 * rule — `quality_label_attribution` decides which labels are not the shift leader's,
 * and when it cannot be read every exclusion quietly stops applying. The screen has
 * to be able to say which of the two happened.
 */
export function isMissingTable(error: { code?: string; message?: string } | null | undefined): boolean {
  if (error?.code === UNDEFINED_TABLE || error?.code === TABLE_CACHE_MISS) return true;
  // Some clients drop the code and keep only PostgREST's wording.
  return /could not find the table .* in the schema cache|relation .* does not exist/i.test(error?.message ?? "");
}

