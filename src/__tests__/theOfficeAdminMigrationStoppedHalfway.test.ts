import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultCan, ALL_ROLES, type Action } from "@/lib/permissions";

/**
 * 20260902090000 replaces the write policies on five tables with one policy each,
 * reading the matrix through `has_action`.
 *
 * The baseline array in each policy is a copy of the matrix, and a copy is a second
 * source of truth until something checks it. Change `machines.manage` in
 * permissions.ts and the database keeps the old set, silently, with no error anywhere
 * — which is the exact class of defect this whole sequence has been removing.
 */
const sql = readFileSync(
  resolve(__dirname, "../../supabase/migrations/20260902090000_the_office_admin_migration_stopped_halfway.sql"),
  "utf8",
);

const CASES: [Action, string][] = [
  ["machines.manage", "machines"],
  ["leaders.manage", "line_leaders"],
  ["assets.manage", "mobile_assets"],
  ["problems.manage", "problem_descriptions"],
  ["stock.manage", "products"],
];

/** Every baseline array the migration passes for one action. */
function baselines(action: string): string[][] {
  const re = new RegExp(`has_action\\(auth\\.uid\\(\\), '${action.replace(".", "\\.")}',\\s*\\n?\\s*ARRAY\\[([^\\]]*)\\]`, "g");
  return [...sql.matchAll(re)].map((m) => [...m[1].matchAll(/'(\w+)'/g)].map((x) => x[1]).sort());
}

describe("the five tables the office admin migration missed", () => {
  for (const [action, table] of CASES) {
    it(`${table}: the baseline is the matrix, role for role`, () => {
      const matrix = ALL_ROLES.filter((r) => defaultCan(r, action)).sort();
      const found = baselines(action);
      expect(found.length).toBeGreaterThan(0);
      // Every occurrence, not just the first — USING and WITH CHECK must not drift.
      for (const b of found) expect(b).toEqual(matrix);
    });

    it(`${table}: production_office_admin is actually in it`, () => {
      expect(defaultCan("production_office_admin", action)).toBe(true);
      for (const b of baselines(action)) expect(b).toContain("production_office_admin");
    });
  }

  it("states the rule once, not as a list of roles", () => {
    expect(sql).not.toMatch(/has_role\s*\(/);
  });

  it("does not touch who may READ these tables", () => {
    // Read access is a separate question and this migration does not answer it.
    const dropped = [...sql.matchAll(/DROP POLICY IF EXISTS "([^"]+)"/g)].map((m) => m[1]);
    expect(dropped.some((d) => /view|read|select/i.test(d))).toBe(false);
  });

  it("leaves deleting a product admin-only", () => {
    // Deleting a part is not stock.manage, and StockPage already says so.
    expect(sql).not.toMatch(/DROP POLICY IF EXISTS "Admins can delete products"/);
    expect(sql).not.toMatch(/products delete by matrix/);
  });
});
