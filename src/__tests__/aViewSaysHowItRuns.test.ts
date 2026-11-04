import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { viewsThatRunAsTheirOwner } from "./viewsThatRunAsTheirOwner";

/**
 * Audit 2026-11-02, DB-001. A view without security_invoker runs as its owner and reads
 * past every RLS policy underneath, and `CREATE OR REPLACE VIEW … AS` with no WITH
 * clause turns the option off on a view that had it (20261001203000 did exactly that to
 * v_leader_weekly_scorecard). So every view a migration creates or replaces from BLOCO
 * 143 on either says `security_invoker = true` itself, or the same migration sets it
 * with ALTER VIEW afterwards. Older migrations are what production already ran; the
 * catalogue check for those is VERIFY-145.
 */
const migrations = resolve(__dirname, "../../supabase/migrations");
const FIRST_GUARDED = "20261104090000";

describe("viewsThatRunAsTheirOwner", () => {
  it("passes a view that says it runs as its reader", () => {
    expect(viewsThatRunAsTheirOwner("create or replace view public.v_a with (security_invoker = true) as select 1;")).toEqual([]);
    expect(viewsThatRunAsTheirOwner("CREATE VIEW v_a WITH (security_invoker=on) AS SELECT 1;")).toEqual([]);
  });

  it("flags a view created or replaced without the option", () => {
    expect(viewsThatRunAsTheirOwner("create view public.v_a as select 1;")).toEqual(["v_a"]);
    expect(viewsThatRunAsTheirOwner("create or replace view public.v_a as select 1;")).toEqual(["v_a"]);
  });

  it("flags the rebuild from pg_get_viewdef that started this", () => {
    expect(viewsThatRunAsTheirOwner("execute 'CREATE OR REPLACE VIEW v_leader_weekly_scorecard AS ' || d;"))
      .toEqual(["v_leader_weekly_scorecard"]);
  });

  it("flags the option written as false", () => {
    expect(viewsThatRunAsTheirOwner("create view v_a with (security_invoker = false) as select 1;")).toEqual(["v_a"]);
  });

  it("passes a rebuild followed by ALTER VIEW … SET (security_invoker = true)", () => {
    const sql = "execute 'CREATE OR REPLACE VIEW v_a AS ' || d;\nalter view public.v_a set (security_invoker = true);";
    expect(viewsThatRunAsTheirOwner(sql)).toEqual([]);
  });

  it("does not take a comment for the option, nor a view in a comment for a view", () => {
    expect(viewsThatRunAsTheirOwner("create view v_a as -- security_invoker\nselect 1;")).toEqual(["v_a"]);
    expect(viewsThatRunAsTheirOwner("/* create view v_b as select 1; */ select 1;")).toEqual([]);
    expect(viewsThatRunAsTheirOwner("-- create view v_c as select 1;\nselect 1;")).toEqual([]);
  });
});

describe("every view a migration makes from BLOCO 143 on runs as its reader", () => {
  const guarded = readdirSync(migrations).filter((f) => f.endsWith(".sql") && f >= FIRST_GUARDED);

  it("starts at the migration that fixed the weekly scorecard view", () => {
    expect(guarded[0]).toBe("20261104090000_the_weekly_scorecard_view_reads_as_its_reader.sql");
  });

  for (const f of guarded) {
    it(f, () => {
      expect(viewsThatRunAsTheirOwner(readFileSync(resolve(migrations, f), "utf8"))).toEqual([]);
    });
  }
});
