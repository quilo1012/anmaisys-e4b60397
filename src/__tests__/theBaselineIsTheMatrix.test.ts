import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { defaultCan, type Action, type Role } from "@/lib/permissions";

/**
 * A policy's baseline is a copy of the matrix, and copies drift.
 *
 * `has_action(uid, action, baseline)` reads the user's roles, applies whatever the
 * Permissions screen wrote into `role_permission_overrides`, and only then falls back to
 * the baseline array carved into the policy. That fallback is the same decision as
 * `MATRIX` in src/lib/permissions.ts, written a second time in SQL — so the day they
 * disagree, the screen grants something the database refuses and the person sees an
 * empty table with no error. That is exactly how planner lost machines, downtime and
 * problems, and co_engineer lost stock: not a bug anybody wrote, a copy nobody kept.
 *
 * Counted on 26/08/2026: 436 policies, 7 consulting the matrix, 365 carrying a frozen
 * list, 62 overrides configured and honoured on six tables.
 *
 * This test pins the baselines this migration introduces against the TypeScript they
 * were copied from. It reads the real MATRIX rather than restating it, so adding a role
 * to an action in permissions.ts fails here until the policy is updated too.
 */

const MIGRATION_DIR = resolve(__dirname, "../..", "supabase/migrations");
// Specific to THIS migration, not to the naming convention: 20260911090000 also creates
// a policy called "... select by matrix", and a looser pattern picked that one up instead
// and failed all seven assertions against the wrong file.
const DEFINES = /products select by matrix/;

const migration = () => {
  const file = readdirSync(MIGRATION_DIR)
    .filter((f) => f.endsWith(".sql"))
    .sort()
    .reverse()
    .find((f) => DEFINES.test(readFileSync(resolve(MIGRATION_DIR, f), "utf8")));
  if (!file) throw new Error("No migration converts a select policy to has_action");
  return readFileSync(resolve(MIGRATION_DIR, file), "utf8");
};

/** Every role in the app_role enum, as the live database reports it. */
const TODOS_OS_PAPEIS: Role[] = [
  "admin", "engineer", "operator", "manager", "viewer", "maintenance_manager",
  "co_engineer", "supervisor", "planner", "warehouse", "quality_supervisor",
  "production_office_admin",
];

/** What MATRIX grants for an action, via the same function the app asks. */
function matrixFor(action: Action): string[] {
  return TODOS_OS_PAPEIS.filter((r) => defaultCan(r, action)).sort();
}

/** The roles named inside the has_action(...) call for one action. */
function baselineFor(sql: string, action: string): string[] {
  const at = sql.indexOf(`has_action(auth.uid(), '${action}'`);
  if (at < 0) throw new Error(`no has_action for ${action}`);
  const abre = sql.indexOf("ARRAY[", at);
  const fecha = sql.indexOf("]", abre);
  return [...sql.slice(abre, fecha).matchAll(/'([a-z_]+)'::app_role/g)].map((m) => m[1]).sort();
}

describe("the baselines the policies fall back to", () => {
  const sql = migration();

  // downtime.view is deliberately NOT in this list — see the migration. It gates the
  // Downtime screen and is granted to every role, but operators reach their own
  // stoppages through the ownership clause instead. Copying the matrix there would have
  // handed twelve operator accounts every stoppage on every line.
  for (const action of ["stock.view", "machines.view", "problems.view", "suppliers.view"]) {
    it(`matches MATRIX for ${action}`, () => {
      expect(baselineFor(sql, action)).toEqual(matrixFor(action as Action));
    });
  }

  it("keeps operators out of the downtime baseline, and their own stoppages in", () => {
    const baseline = baselineFor(sql, "downtime.view");
    expect(baseline).not.toContain("operator");
    expect(baseline).not.toContain("viewer");
    // The three ownership routes that replace it. If any goes, an operator stops seeing
    // the downtime on their own work order.
    const policy = sql.slice(sql.indexOf("downtime_events select by matrix"));
    expect(policy).toMatch(/stopped_by = auth\.uid\(\)/);
    expect(policy).toMatch(/resumed_by = auth\.uid\(\)/);
    expect(policy).toMatch(/operator_line_accounts/);
  });

  it("drops the warehouse ALL policy on machines, which was never a view grant", () => {
    expect(sql).toMatch(/DROP POLICY IF EXISTS "Warehouse can manage machines"/);
  });

  it("replaces the old select policies rather than layering on top of them", () => {
    // RLS policies OR together, so adding one can only widen. An override that says
    // `false` only takes effect once the policy that granted it by name is gone.
    for (const antiga of [
      '"Engineers and admins can view products"',
      '"supervisor_read_access" ON public.products',
      '"Authenticated can view machines"',
      '"suppliers_select_scoped"',
      '"Scoped downtime_events select"',
    ]) {
      expect(sql).toContain(`DROP POLICY IF EXISTS ${antiga}`);
    }
  });
});
