import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultCan, ALL_ROLES } from "@/lib/permissions";

/**
 * 20260831090000 is the first migration to make `stock.pricing` mean anything.
 *
 * The switch existed on the Permissions page, admin-only, and governed nothing: no
 * screen asked for it and no policy mentioned it. What decided who moved a price was
 * `stock.manage` in the UI and the plain UPDATE policies on `products` — four roles
 * where the matrix names one.
 *
 * The two things this pins are the two that would silently undo it.
 */

const root = resolve(__dirname, "../..");
const sql = readFileSync(
  resolve(root, "supabase/migrations/20260831090000_a_price_is_not_the_same_right_as_a_quantity.sql"),
  "utf8",
);

describe("the price gate", () => {
  it("reads the switch rather than a second list of roles", () => {
    // `has_action` consults role_permission_overrides — the Permissions page itself.
    // A hand-written `has_role(...) OR has_role(...)` here would rebuild the exact
    // defect this migration exists to remove.
    expect(sql).toMatch(/has_action\(\s*auth\.uid\(\),\s*'stock\.pricing'/);
    expect(sql).not.toMatch(/has_role\s*\(/);
  });

  it("fires on the value, not the statement", () => {
    // `useUpdateProduct` sends every column on every save. A trigger that refused any
    // UPDATE naming `price` would refuse every ordinary product edit by a manager.
    expect(sql).toMatch(/NEW\.price IS NOT DISTINCT FROM OLD\.price/);
    expect(sql).toMatch(/RETURN NEW;/);
  });

  it("lets a part be catalogued without being valued", () => {
    // stock.manage covers five roles whose job is cataloguing parts. Requiring the
    // pricing right to INSERT would take that away from four of them.
    expect(sql).toMatch(/NEW\.price IS NULL OR NEW\.price = 0/);
  });

  it("keeps admin as the baseline the matrix declares", () => {
    const holders = ALL_ROLES.filter((r) => defaultCan(r, "stock.pricing"));
    expect(holders).toEqual(["admin"]);
    expect(sql).toMatch(/ARRAY\['admin'\]::app_role\[\]/);
  });
});
