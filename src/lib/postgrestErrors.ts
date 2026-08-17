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
