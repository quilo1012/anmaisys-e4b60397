import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultCan, ALL_ROLES } from "@/lib/permissions";

/**
 * The matrix has said since it was written that a Maintenance Manager may manage
 * engineers (`engineers.manage`), and the Permissions page showed it ticked. The four
 * edge functions never asked: they checked `has_role` for admin/manager, so the tick
 * did nothing and there was no switch anywhere that could make it do something.
 *
 * Now they ask `has_action` with the matrix default as the baseline. These tests keep
 * the baseline in the functions equal to the matrix, and keep the functions asking.
 */
const root = resolve(__dirname, "../..");
const fn = (name: string) => readFileSync(resolve(root, "supabase/functions", name, "index.ts"), "utf8");
const shared = readFileSync(resolve(root, "supabase/functions/_shared/callerMay.ts"), "utf8");

function baseline(constName: string): string[] {
  const m = shared.match(new RegExp(`${constName} = \\[([^\\]]*)\\]`));
  if (!m) throw new Error(`${constName} not found`);
  return m[1].split(",").map((s) => s.trim().replace(/"/g, "")).filter(Boolean).sort();
}

describe("engineer PIN functions ask the matrix", () => {
  it("the manage baseline is the matrix default for engineers.manage", () => {
    const expected = ALL_ROLES.filter((r) => defaultCan(r, "engineers.manage")).sort();
    expect(baseline("ENGINEERS_MANAGE_BASELINE")).toEqual(expected);
    expect(expected).toContain("maintenance_manager");
  });

  it("the view baseline is the matrix default for engineers.view", () => {
    const expected = ALL_ROLES.filter((r) => defaultCan(r, "engineers.view")).sort();
    expect(baseline("ENGINEERS_VIEW_BASELINE")).toEqual(expected);
  });

  it.each(["create-engineer", "update-engineer", "delete-engineer"])("%s asks engineers.manage", (name) => {
    const src = fn(name);
    expect(src).toMatch(/callerMay\(authHeader, callerId, "engineers\.manage", ENGINEERS_MANAGE_BASELINE\)/);
    expect(src).not.toMatch(/_role: "manager"/);
  });

  it("list-engineers asks engineers.view and keeps labor_rate for admins", () => {
    const src = fn("list-engineers");
    expect(src).toMatch(/callerMay\(authHeader, callerId, "engineers\.view", ENGINEERS_VIEW_BASELINE\)/);
    expect(src).toMatch(/isAdmin \? "id, name, is_active, created_at, labor_rate" : "id, name, is_active, created_at"/);
  });

  it("only an admin may still write labor_rate", () => {
    expect(fn("update-engineer")).toMatch(/laborRate !== undefined && !isAdmin/);
  });
});
