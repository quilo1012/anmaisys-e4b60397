/**
 * A role the screen offers and the database cannot store.
 *
 * `app_role` is a Postgres enum, and the list the Manage Users screen offers is a
 * constant in `permissions.ts`. Nothing holds the two together: on 11/10 `employee`
 * was added to the constant, to the role labels, to `create-user`, to `update-user`
 * and — by hand — to the generated types file, while the `ALTER TYPE ... ADD VALUE`
 * sat unapplied in a migration. The screen offered it, somebody picked it, and the
 * database answered
 *
 *     invalid input value for enum app_role: "employee"
 *
 * which arrived on screen exactly like that, as a red box, with nothing to do about it.
 *
 * The error is the ground truth and this reads it. No probe, no second list to keep in
 * step, no guess about what the database holds: the only thing that knows is the
 * database, and it says so the moment it is asked.
 *
 * Deliberately narrow. It matches the enum coercion failure for `app_role` and nothing
 * else — a different 22P02, a constraint violation, a refusal from the function's own
 * checks all stay what they are, because a screen that explains every error as "the
 * migration is missing" would be wrong more often than right.
 */
const ENUM_REFUSAL = /invalid input value for enum app_role:\s*"([a-z_]+)"/i;

/** The role the database refused, or null when this is some other failure. */
export function roleRejectedByDatabase(error: unknown): string | null {
  if (!error) return null;
  const message =
    typeof error === "string" ? error
    : typeof (error as { message?: unknown }).message === "string" ? (error as { message: string }).message
    : "";
  return message.match(ENUM_REFUSAL)?.[1] ?? null;
}

/**
 * What to say instead of the Postgres sentence.
 *
 * Names the role and the one action that fixes it. Whoever reads this is an admin on
 * the Users screen, so "a migration has not been applied" is a sentence they can act
 * on — and the role they picked is the thing they need to hear named.
 */
export function roleRejectedMessage(role: string): string {
  return `The "${role}" role isn't in the database yet — its migration hasn't been applied. ` +
         `Create the account with another role for now, or apply the pending migrations first.`;
}
