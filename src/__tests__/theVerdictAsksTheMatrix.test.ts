import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultCan, ALL_ROLES } from "@/lib/permissions";

/**
 * 20260901090000 re-issues `enforce_quality_validation` whole to change three lines.
 *
 * The function is the quality audit gate: who may rule on an action and who may
 * approve its closure. A character altered by accident anywhere else in it — the
 * reopen rule, the signature withdrawal, the validate-before-close order — would apply
 * cleanly and nothing would report it.
 *
 * So this asserts the weaker and more useful thing, the same way `weeklyViewReissue`
 * does: every line of logic in the definition in force still appears in the new one,
 * except the ones deliberately replaced.
 */
const root = resolve(__dirname, "../..");
const read = (f: string) => readFileSync(resolve(root, "supabase/migrations", f), "utf8");

const before = read("20260827090000_the_evidence_gate_outlived_the_place_to_attach_it.sql");
const after = read("20260901090000_the_verdict_asks_the_matrix_who_may_give_it.sql");

function body(sql: string): string {
  const start = sql.indexOf("CREATE OR REPLACE FUNCTION public.enforce_quality_validation()");
  const end = sql.indexOf("$function$;", start) + "$function$;".length;
  if (start === -1 || end < 11) throw new Error("function body not found");
  return sql.slice(start, end);
}

/** Lines that are code, not commentary — commentary is allowed to be rewritten. */
const logic = (s: string) =>
  body(s).split("\n").map((l) => l.trim()).filter((l) => l && !l.startsWith("--"));

/** The three lines this migration exists to replace. */
const REPLACED = [
  "_is_admin boolean;",
  "_is_admin   := has_role(_uid,'admin');",
  "_is_quality := _is_admin OR has_role(_uid,'quality_supervisor');",
  "_is_manager := _is_admin OR has_role(_uid,'manager') OR has_role(_uid,'maintenance_manager');",
];

describe("the re-issued audit gate", () => {
  it("keeps every other line of the function exactly", () => {
    const kept = logic(before).filter((l) => !REPLACED.includes(l));
    const now = logic(after);
    expect(kept.length).toBeGreaterThan(20);
    for (const line of kept) expect(now).toContain(line);
  });

  it("really did drop the hand-written role lists", () => {
    for (const line of REPLACED) expect(logic(after)).not.toContain(line);
    expect(body(after)).not.toMatch(/has_role\s*\(/);
  });

  it("asks the Permissions page instead", () => {
    expect(body(after)).toMatch(/has_action\(_uid, 'quality\.validate'/);
    expect(body(after)).toMatch(/has_action\(_uid, 'quality\.close'/);
  });

  it("passes the baselines the matrix declares, so nothing moves today", () => {
    const holders = (a: "quality.validate" | "quality.close") =>
      ALL_ROLES.filter((r) => defaultCan(r, a)).sort();
    expect(holders("quality.validate")).toEqual(["admin", "quality_supervisor"]);
    expect(holders("quality.close")).toEqual(["admin", "maintenance_manager", "manager"]);
    // The literal arrays in the migration must be those same sets.
    expect(body(after)).toContain("ARRAY['admin','quality_supervisor']::app_role[]");
    expect(body(after)).toContain("ARRAY['admin','manager','maintenance_manager']::app_role[]");
  });
});
