import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { EVENT_LABEL } from "@/lib/overtimeAudit";

/**
 * The overtime audit (20261018090000) as text: what it promises about who can write,
 * who can read, and what it never copies. Run against a real Postgres when it was
 * written; this keeps the promises from being edited away quietly.
 */
const sql = readFileSync(
  resolve(__dirname, "../..", "supabase/migrations/20261018090000_overtime_keeps_its_own_record.sql"), "utf8",
).toLowerCase();

describe("the overtime audit", () => {
  it("grants no role a way to write or rewrite it", () => {
    expect(sql).toContain("revoke all on public.overtime_audit from public, anon, authenticated");
    expect(sql).toContain("grant select on public.overtime_audit to authenticated");
    expect(sql).not.toMatch(/grant (insert|update|delete|all)[^;]*on public\.overtime_audit/);
    expect(sql).toMatch(/before update or delete on public\.overtime_audit/);
    expect(sql).toMatch(/before truncate on public\.overtime_audit/);
  });

  it("lets an employee read only their own rows", () => {
    expect(sql).toMatch(/public\.can_manage_overtime\(auth\.uid\(\)\)\s+or \(employee_id is not null and employee_id = public\.my_employee_id\(\)\)/);
  });

  it("keeps the writer out of reach of callers", () => {
    expect(sql).toMatch(/revoke all on function public\.overtime_audit_write\([^)]*\)\s+from public, anon, authenticated/);
    expect(sql).toContain("revoke all on function public.overtime_audit_actor(uuid, uuid) from public, anon, authenticated");
  });

  it("does not copy a sickness note, and reads no secret", () => {
    expect(sql).toContain("case when v_sick then null else new.note end");
    // Code only: the header says in words which secrets it never reads.
    const code = sql.replace(/--.*$/gm, "");
    expect(code).not.toMatch(/password|access_token|refresh_token|invite_code|pin_hash|encrypted/);
  });

  it("has a label on screen for every event the table accepts", () => {
    const check = sql.match(/event_type\s+text not null check \(event_type in \(([\s\S]*?)\)\)/)![1];
    const events = [...check.matchAll(/'([a-z_]+)'/g)].map((m) => m[1]).sort();
    expect(events).toEqual(Object.keys(EVENT_LABEL).sort());
  });
});
