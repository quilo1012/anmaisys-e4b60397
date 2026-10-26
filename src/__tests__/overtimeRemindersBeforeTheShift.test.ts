import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OVERTIME_NOTICE_KINDS } from "@/lib/notificationOpen";

/**
 * BLOCO 133: booked overtime is reminded a day and two hours before.
 *
 * What it does is tested in SQL (supabase/tests/overtime_reminders_test.sql: who,
 * when, once, moved, called off, ended, both clock changes). This file holds the
 * lines that keep it attached to the rest: the kinds the page marks read, the apply
 * package, who may run it, and the push's ttl.
 */
const root = resolve(__dirname, "../..");
const MIG = "20261026110000_overtime_reminders_before_the_shift.sql";
const sql = readFileSync(resolve(root, "supabase/migrations", MIG), "utf8");
const apply = readFileSync(resolve(root, "docs/apply-passo-3/APPLY-ALL-IN-ORDER.sql"), "utf8");
const paste = readFileSync(resolve(root, "docs/apply-passo-3/APLICAR-133-lembretes-de-overtime.sql"), "utf8");
const sqlTest = readFileSync(resolve(root, "supabase/tests/overtime_reminders_test.sql"), "utf8");

const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
const reminders = code.slice(code.indexOf("function public.overtime_reminders_due"), code.indexOf("function public.overtime_reminders_forget_ask"));
const push = code.slice(code.indexOf("function public.notification_push()"));

describe("overtime reminders (BLOCO 133)", () => {
  it("writes only the two reminder kinds, and the page marks both read from the phone", () => {
    const kinds = [...reminders.matchAll(/'(overtime_reminder_[a-z0-9]+)'/g)].map((m) => m[1]);
    expect(new Set(kinds)).toEqual(new Set(["overtime_reminder_24h", "overtime_reminder_2h"]));
    for (const k of kinds) expect(OVERTIME_NOTICE_KINDS).toContain(k);
  });

  it("reminds only a valid booking, read the way the board reads it", () => {
    expect(reminders).toMatch(/r\.decision = 'accepted'/);
    expect(reminders).toMatch(/q\.status <> 'cancelled'/);
    expect(reminders).toMatch(/not exists \(select 1 from public\.overtime_outcomes o where o\.response_id = r\.id\)/);
    expect(reminders).toMatch(/e\.user_id is not null/);
  });

  it("counts from the shift's start in Europe/London and never after it", () => {
    expect(reminders).toMatch(/\(q\.on_date \+ q\.starts_at\) at time zone 'Europe\/London' as starts/);
    expect(reminders).toMatch(/p_now <\s+b\.starts\b/);
  });

  it("writes each reminder once, on the unique key of BLOCO 100", () => {
    expect(reminders).toMatch(/on conflict \(user_id, kind, overtime_request_id\) do nothing/);
  });

  it("names the production line only from the board, never the department", () => {
    expect(reminders).toMatch(/a\.kind = 'production'/);
    expect(reminders).not.toMatch(/q\.department/);
  });

  it("is run by the database only", () => {
    expect(code).toMatch(/revoke all on function public\.overtime_reminders_due\(timestamptz\) from public, anon, authenticated/);
    expect(code).toMatch(/cron\.schedule\('overtime-reminders', '\*\/5 \* \* \* \*', 'select public\.overtime_reminders_due\(\);'\)/);
  });

  it("sends a ttl for reminders only, and keeps BLOCO 132's tag", () => {
    expect(push).toMatch(/if new\.kind in \('overtime_reminder_24h', 'overtime_reminder_2h'\)/);
    expect(push).toMatch(/'ttl', v_ttl/);
    expect(push).toMatch(/jsonb_strip_nulls/);
    expect(push).toMatch(/then 'overtime-notice-' \|\| new\.overtime_request_id/);
  });

  it("forgets the reminders of a moved or called-off ask, and of an ended booking", () => {
    expect(code).toMatch(/after update of status, on_date, starts_at, ends_at on public\.overtime_requests/);
    expect(code).toMatch(/after insert or update of outcome on public\.overtime_outcomes/);
  });

  it("is BLOCO 133 in the apply package, word for word, after 132; its paste is all-or-nothing", () => {
    // The whole block, header and body, word for word — wherever later blocks put it.
    expect(apply).toContain(`-- BLOCO 133\n-- ${MIG}\n-- ${"=".repeat(64)}\n${sql}`);
    expect(apply.indexOf("-- BLOCO 132\n")).toBeLessThan(apply.indexOf("-- BLOCO 133\n"));
    expect(paste).toContain(sql.slice(sql.indexOf("-- ── 1. The reminders")));
    expect(paste).toMatch(/\nbegin;\n/);
    expect(paste.trimEnd().endsWith("commit;")).toBe(true);
  });

  it("has a SQL test that rolls back and covers both clock changes", () => {
    expect(sqlTest.trimEnd().endsWith("ROLLBACK;")).toBe(true);
    expect(sqlTest).toContain("ALL TESTS PASSED");
    expect(sqlTest).toMatch(/2026-10-25/);
    expect(sqlTest).toMatch(/2026-03-29/);
  });
});
