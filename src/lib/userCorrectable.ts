/**
 * Which refusals are the user's to fix, and which are the system's.
 *
 * Root Diagnostics files every 4xx the backend returns, and it is right to: a screen
 * sending the database something it should never have sent is exactly the fault that
 * hides for weeks otherwise. But not every refusal is a fault. Somebody typing a SKU
 * code that already exists is the constraint doing its job, on a screen that already
 * explains it — and filing that as a system error puts a wolf in a list people read
 * to find wolves.
 *
 * The tempting discriminator is the SQL code, and it is the wrong one. On 08/08 the
 * same 23505 was both things before lunch: a duplicate SKU code somebody could fix by
 * typing a different one, and `daily_allocations_one_leader_per_area`, which a
 * supervisor dragging a card could do nothing about and which took weeks to be seen.
 * A rule keyed on the code would have silenced the second to quieten the first.
 *
 * So it is declared, one constraint at a time, and an entry has to be true twice over:
 *
 * 1. **The user can fix it** by entering something else. Not "a manager could fix it
 *    eventually" — the person who hit it, at the moment they hit it.
 * 2. **A screen already tells them how.** Named below, so the claim can be checked, and
 *    so deleting that handler leaves a lie somebody can grep for.
 *
 * Anything not listed is a fault. That is the safe direction and it is not symmetric:
 * a false alarm costs a line in a list, and a false silence cost this project a fix on
 * a board that had been refusing to save for weeks.
 */
const USER_CORRECTABLE = new Map<string, string>([
  [
    "sku_products_code_key",
    "SKUProductsPage: the toast says the code is already on the list, and the field "
    + "names the SKU holding it, so the person can see what to type instead",
  ],
]);

/**
 * The constraint a Postgres message is about, if it names one.
 *
 * Covers the four `violates … constraint "name"` forms; anything else is null, which
 * reads as "not a constraint violation" everywhere this is used.
 */
export function constraintFrom(message: string | null | undefined): string | null {
  if (!message) return null;
  const m = /violates (?:unique|check|foreign key|exclusion) constraint "([^"]+)"/.exec(message);
  return m?.[1] ?? null;
}

/** Whether this refusal is somebody's typing rather than the system's fault. */
export function isUserCorrectable(message: string | null | undefined): boolean {
  const name = constraintFrom(message);
  return name !== null && USER_CORRECTABLE.has(name);
}

/** Why a constraint is on the list, for a diagnostics screen that wants to say so. */
export function whyUserCorrectable(message: string | null | undefined): string | null {
  const name = constraintFrom(message);
  return (name && USER_CORRECTABLE.get(name)) ?? null;
}
