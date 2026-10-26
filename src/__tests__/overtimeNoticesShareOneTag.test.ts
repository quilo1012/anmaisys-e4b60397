import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { OVERTIME_NOTICE_KINDS } from "@/lib/notificationOpen";

/**
 * BLOCO 132: the notices about one overtime ask share `overtime-notice-<ask>` on the
 * phone, so a cancellation replaces the reminder it makes wrong.
 *
 * Two lists have to agree — the kinds the trigger tags so (SQL) and the kinds the page
 * marks read for that tag (TypeScript). A kind in only one of them is a notice that
 * either never shares the tag or is never marked read from the phone.
 */
const root = resolve(__dirname, "../..");
const MIG = "20261026100000_overtime_notices_share_one_tag.sql";
const sql = readFileSync(resolve(root, "supabase/migrations", MIG), "utf8");
const apply = readFileSync(resolve(root, "docs/apply-passo-3/APPLY-ALL-IN-ORDER.sql"), "utf8");
const paste = readFileSync(resolve(root, "docs/apply-passo-3/APLICAR-132-avisos-do-pedido-uma-etiqueta.sql"), "utf8");
const sendPush = readFileSync(resolve(root, "supabase/functions/send-push/index.ts"), "utf8");

const code = sql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");

describe("overtime notices share one tag (BLOCO 132)", () => {
  it("tags exactly the kinds the page marks read", () => {
    const list = /new\.kind in \(([^)]*)\)/.exec(code);
    expect(list).not.toBeNull();
    const kinds = [...list![1].matchAll(/'([a-z_0-9]+)'/g)].map((m) => m[1]).sort();
    expect(kinds).toEqual([...OVERTIME_NOTICE_KINDS].sort());
  });

  it("only rows that name their ask get the shared tag; every other row keeps <kind>:<id>", () => {
    expect(code).toMatch(/new\.overtime_request_id is not null/);
    expect(code).toMatch(/then 'overtime-notice-' \|\| new\.overtime_request_id/);
    expect(code).toMatch(/else new\.kind \|\| ':' \|\| new\.id/);
  });

  it("changes the function only: no trigger, table or data", () => {
    expect(code).not.toMatch(/create trigger|drop trigger|alter table|insert into|update public\.|delete from/i);
    expect(code).toMatch(/revoke all on function public\.notification_push\(\) from public, anon, authenticated/);
  });

  it("does not send a ttl yet, so it is safe before send-push is deployed", () => {
    expect(code).not.toMatch(/'ttl'/);
  });

  it("is BLOCO 132 in the apply package, word for word, and its own paste is all-or-nothing", () => {
    // The whole block, header and body, word for word — wherever later blocks put it.
    expect(apply).toContain(`-- BLOCO 132\n-- ${MIG}\n-- ${"=".repeat(64)}\n${sql}`);
    expect(paste).toContain(sql.slice(sql.indexOf("create or replace function public.notification_push()")));
    expect(paste).toMatch(/\nbegin;\n/);
    expect(paste.trimEnd().endsWith("commit;")).toBe(true);
  });
});

describe("send-push takes an optional ttl and keeps a day by default", () => {
  it("validates it and falls back to 24 hours", () => {
    expect(sendPush).toMatch(/ttl: z\.number\(\)\.int\(\)\.min\(60\)\.max\(24 \* 60 \* 60\)\.optional\(\)/);
    expect(sendPush).toContain("TTL: body.ttl ?? 24 * 60 * 60");
  });
});
