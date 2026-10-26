import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * BLOCO 134: a direct message rings the bell (and, through BLOCO 117, the phone) of
 * whoever it is for. Before it, `dm_employee_bell` wrote a row only when the recipient
 * was an employee or came through the overtime door, so staff never heard of a message.
 *
 * What it does is tested in SQL (supabase/tests/a_direct_message_rings_test.sql). This
 * holds the lines around it: the three old cases are untouched, the new one is the last
 * branch, and the package carries it word for word.
 */
const root = resolve(__dirname, "../..");
const MIG = "20261026200000_a_direct_message_rings_whoever_it_is_for.sql";
const sql = readFileSync(resolve(root, "supabase/migrations", MIG), "utf8");
const before = readFileSync(resolve(root, "supabase/migrations/20261021170000_employees_can_write_to_each_other.sql"), "utf8");
const apply = readFileSync(resolve(root, "docs/apply-passo-3/APPLY-ALL-IN-ORDER.sql"), "utf8");
const paste = readFileSync(resolve(root, "docs/apply-passo-3/APLICAR-134-mensagem-privada-toca-a-quem-recebe.sql"), "utf8");
const sqlTest = readFileSync(resolve(root, "supabase/tests/a_direct_message_rings_test.sql"), "utf8");

const fnOf = (s: string) =>
  s.slice(s.indexOf("create or replace function public.dm_employee_bell()"), s.indexOf("revoke all on function public.dm_employee_bell()"));

describe("a direct message rings whoever it is for (BLOCO 134)", () => {
  const now = fnOf(sql);
  const then = fnOf(before);

  it("keeps BLOCO 114's three cases word for word", () => {
    const oldCases = then.slice(then.indexOf("    if coalesce(current_setting('app.dm_door'"), then.indexOf("    end if;\n  exception"));
    expect(oldCases.length).toBeGreaterThan(500);
    expect(now).toContain(oldCases);
  });

  it("adds one last branch that rings the recipient and opens the conversation", () => {
    const last = now.slice(now.lastIndexOf("    else\n"), now.indexOf("    end if;\n  exception"));
    expect(last).toMatch(/insert into public\.notifications \(user_id, kind, title, body, priority, action_url\)/);
    expect(last).toMatch(/values \(new\.recipient_id, 'chat_message'/);
    expect(last).toMatch(/' sent you a message'/);
    expect(last).toMatch(/'\/dashboard\/messages\?c=dm:' \|\| new\.sender_id/);
  });

  it("still only warns on failure, and changes nothing but the function", () => {
    expect(now).toMatch(/exception when others then\s+raise warning 'dm_employee_bell\(%\): %'/);
    const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
    expect(code).not.toMatch(/create trigger|drop trigger|alter table|create policy|drop policy/i);
    expect(code).toMatch(/revoke all on function public\.dm_employee_bell\(\) from public, anon, authenticated/);
  });

  it("is BLOCO 134 in the apply package, word for word; its paste is all-or-nothing", () => {
    expect(apply).toContain(`-- BLOCO 134\n-- ${MIG}\n-- ${"=".repeat(64)}\n${sql}`);
    expect(paste).toContain(sql.slice(sql.indexOf("create or replace function public.dm_employee_bell()")));
    expect(paste).toMatch(/\nbegin;\n/);
    expect(paste.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("has a SQL test that rolls back and covers staff, employees and the overtime door", () => {
    expect(sqlTest.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    expect(sqlTest).toContain("ALL TESTS PASSED");
    for (const c of ["manager to supervisor", "employee to manager", "employee to employee unchanged",
                     "supervisor to employee unchanged", "the overtime door rings once"]) {
      expect(sqlTest).toContain(c);
    }
  });
});
