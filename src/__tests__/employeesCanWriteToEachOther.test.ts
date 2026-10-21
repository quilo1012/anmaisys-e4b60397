import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * BLOCO 114: an employee may start a conversation with another employee. The insert rule
 * (a new, additive policy) and the hub's list (`chat_may_start`) must say the same thing,
 * and nobody else gains anything: the clause is employee -> employee and nothing wider.
 */
const sql = readFileSync(resolve(__dirname, "../../supabase/migrations/20261021170000_employees_can_write_to_each_other.sql"), "utf8");

describe("employees write to each other", () => {
  it("the insert policy is employee -> employee, to somebody else, and only adds", () => {
    const policy = sql.slice(sql.indexOf('create policy "dm_insert_employee_peers"'), sql.indexOf("create or replace function public.chat_may_start"));
    expect(policy).toMatch(/auth\.uid\(\) = sender_id/);
    expect(policy).toMatch(/sender_id <> recipient_id/);
    expect(policy).toMatch(/has_role\(sender_id, 'employee'::app_role\)/);
    expect(policy).toMatch(/has_role\(recipient_id, 'employee'::app_role\)/);
    expect(sql).not.toMatch(/drop policy if exists "dm_insert_routing"|drop policy if exists "dm_insert_reply"/);
  });

  it("the hub's list carries the same clause", () => {
    expect(sql).toMatch(/or \(public\.has_role\(p_from, 'employee'::app_role\) and public\.has_role\(p_to, 'employee'::app_role\)\)/);
  });

  it("a peer message opens Messages, not the overtime supervisor chat", () => {
    expect(sql).toMatch(/'\/dashboard\/messages\?c=dm:' \|\| new\.sender_id/);
  });

  it("touches no data", () => {
    expect(sql).not.toMatch(/\bdelete\s+from\b|\bdrop\s+table\b|\btruncate\b|\bupdate\s+public\./i);
  });
});
