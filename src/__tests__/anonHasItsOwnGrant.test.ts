import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * 20261018120000 as text. This schema's default privileges grant EXECUTE to anon by
 * name, so a revoke from PUBLIC alone left `overtime_unlinked_names` answering 192
 * names to anyone with the publishable key (measured 18/10/2026). The SQL test proves
 * it in the database; this keeps the two promises from being edited away in review.
 */
const read = (p: string) => readFileSync(resolve(__dirname, "../..", p), "utf8");
const SQL = read("supabase/migrations/20261018120000_anon_was_granted_on_its_own.sql");
const TEST = read("supabase/tests/anon_was_granted_on_its_own_test.sql");

describe("anon is revoked by name, not only through PUBLIC", () => {
  it("revokes from public AND anon", () => {
    expect(SQL).toMatch(/revoke all on function %s from public, anon/);
  });

  it("covers the roster that leaked", () => {
    expect(SQL).toContain("'public.overtime_unlinked_names()'");
  });

  it("is checked against anon in the database, not against PUBLIC", () => {
    expect(TEST).toMatch(/has_function_privilege\('anon'/);
  });
});

describe("an employee writes an answer, never a decision", () => {
  it("the own-insert policy refuses a decision", () => {
    const policy = SQL.slice(SQL.indexOf('create policy "overtime_responses_own"'));
    expect(policy).toMatch(/decision is null/);
    expect(policy).toMatch(/decided_by is null/);
    expect(policy).toMatch(/employee_id = public\.my_employee_id\(\)/);
  });
});
