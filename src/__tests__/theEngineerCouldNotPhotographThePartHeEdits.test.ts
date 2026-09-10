import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { defaultCan, ALL_ROLES } from "@/lib/permissions";
import type { Action } from "@/lib/permissions";

/**
 * The bucket kept its own copy of who may touch Stock, and the copy went stale.
 *
 * `part-photos` was created on 26/08 saying, in its own header, that access "mirrors
 * public.products exactly". It mirrored the role list products carried that day, by
 * hand. Products then moved to the Permissions matrix and the bucket stayed behind,
 * so on 08/09/2026 an engineer with `stock.manage` granted on the Permissions page
 * could edit a part and could not attach its photograph: "Upload failed — new row
 * violates row-level security policy", measured on the live database as that account.
 *
 * A copy of a list is a second source of truth, and this is the test that keeps this
 * one from drifting a second time: the storage policies must ask `has_action` with the
 * same baselines the screen and the products policies use, and must not carry a
 * hand-written role list of their own.
 *
 * `20260908142852` answered the same report on the same day by adding three roles to
 * the hand-written list. It is the thing this file exists to stop coming back, so the
 * last test below holds the two migrations in the only order that works.
 */
const root = resolve(__dirname, "../..");
const MIGRATIONS = resolve(root, "supabase/migrations");

const migration = (stamp: string) => {
  const file = readdirSync(MIGRATIONS).find((f) => f.startsWith(stamp));
  if (!file) throw new Error(`a migração ${stamp} desapareceu de supabase/migrations/`);
  return readFileSync(resolve(MIGRATIONS, file), "utf8");
};

const sql = migration("20260918090000");

/** The baseline the screen itself carries: every role that can do this without an override. */
/**
 * The four profiles retired on 10/09/2026. They hold nothing in the matrix any more,
 * and the SQL written before that day still names some of them. That is inert — no
 * account carries these values — so the comparison is made over the live profiles only,
 * rather than rewriting policies nobody is governed by.
 */
const RETIRED = ["supervisor", "planner", "viewer", "co_engineer"];
const live = (roles: string[]) => roles.filter((r) => !RETIRED.includes(r)).sort();

const baseline = (action: Action) => live(ALL_ROLES.filter((r) => defaultCan(r, action)));

/** The three policies this migration re-issues. Delete is deliberately not one of them. */
const REISSUED = ["part_photos_read", "part_photos_insert", "part_photos_update"] as const;

/** `ARRAY['a','b']::app_role[]` → ["a","b"], in the order written. */
const arrays = (s: string): string[][] =>
  [...s.matchAll(/ARRAY\[([^\]]+)\]::app_role\[\]/g)].map((m) =>
    m[1].split(",").map((r) => r.trim().replace(/'/g, "")),
  );

/** The text of one CREATE POLICY block, from its name to the statement's semicolon. */
const policy = (name: string) => {
  const start = sql.indexOf(`CREATE POLICY "${name}"`);
  if (start === -1) throw new Error(`${name} não é reemitida por esta migração`);
  const end = sql.indexOf("\n);", start);
  return sql.slice(start, end);
};

describe("the part photos ask the matrix, like the parts themselves", () => {
  it("re-issues the three policies that decide reading and writing", () => {
    for (const name of REISSUED) {
      expect(sql).toContain(`DROP POLICY IF EXISTS "${name}" ON storage.objects;`);
      expect(sql).toContain(`CREATE POLICY "${name}"`);
    }
  });

  it("leaves the delete policy alone — it already mirrors products", () => {
    // Mentioned in the header, never touched by a statement.
    expect(sql).not.toMatch(/(DROP|CREATE) POLICY[^\n]*part_photos_delete/);
  });

  it("really did drop the hand-written role list", () => {
    // The 26/08 version answered the question with has_role() alone, which is what
    // made an engineer with stock.manage fail. The only has_role left is the
    // production_office_admin branch, which mirrors `office_admin all` on products.
    for (const name of REISSUED) {
      const body = policy(name);
      expect(body).toMatch(/public\.has_action\(/);
      const roles = [...body.matchAll(/has_role\(auth\.uid\(\), '([a-z_]+)'/g)].map((m) => m[1]);
      expect(roles).toEqual(roles.filter((r) => r === "production_office_admin"));
    }
  });

  it("asks stock.view to read and stock.manage to upload or replace", () => {
    expect(policy("part_photos_read")).toContain("'stock.view'");
    expect(policy("part_photos_insert")).toContain("'stock.manage'");
    expect(policy("part_photos_update")).toContain("'stock.manage'");
  });

  it("carries the same baselines the Permissions page carries", () => {
    // Not "a list that looks similar" — the very list `defaultCan` holds, in order.
    // A role added to Stock on one side and not the other is the bug all over again.
    const read = arrays(policy("part_photos_read"));
    expect(read.length).toBe(1);
    expect(live([...read[0]])).toEqual(baseline("stock.view"));
    for (const name of ["part_photos_insert", "part_photos_update"] as const) {
      const found = arrays(policy(name));
      expect(found.length).toBeGreaterThan(0);
      for (const list of found) expect(live([...list])).toEqual(baseline("stock.manage"));
    }
  });

  it("keeps the engineer, who is exactly who could not upload", () => {
    expect(baseline("stock.view")).toContain("engineer");
    // `engineer` is NOT in the stock.manage baseline: this account passes by an
    // override on the Permissions page, which is precisely what has_role could not see.
    expect(baseline("stock.manage")).not.toContain("engineer");
  });

  it("comes after the migration that extended the hand-written list", () => {
    // 20260908142852 patches the same two policies by naming engineer, co_engineer and
    // warehouse by hand. Both live in supabase/migrations and a replay runs them in
    // filename order, so this one has to be the later stamp or the copy wins.
    const earlier = readdirSync(MIGRATIONS).find((f) => f.startsWith("20260908142852"));
    expect(earlier).toBeTruthy();
    expect("20260918090000" > "20260908142852").toBe(true);
    // And it is not enough to be later: it must re-issue what that one left behind.
    for (const name of ["part_photos_insert", "part_photos_update"] as const) {
      expect(readFileSync(resolve(MIGRATIONS, earlier!), "utf8")).toContain(`CREATE POLICY "${name}"`);
      expect(sql).toContain(`DROP POLICY IF EXISTS "${name}" ON storage.objects;`);
    }
  });
});
