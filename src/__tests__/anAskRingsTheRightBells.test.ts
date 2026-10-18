import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

/**
 * BLOCO 100 as text. The SQL test proves it in a database; this keeps the promises
 * that matter most from being edited away in review.
 */
const SQL = readFileSync(
  resolve(__dirname, "../..", "supabase/migrations/20261018130000_an_ask_rings_the_bell_of_who_can_take_it.sql"),
  "utf8",
);

describe("an ask rings the bell of who can take it", () => {
  it("tells each person once per ask", () => {
    expect(SQL).toMatch(/create unique index if not exists notifications_one_per_event_key\s+on public\.notifications \(user_id, kind, overtime_request_id\)/);
    expect(SQL).toMatch(/on conflict \(user_id, kind, overtime_request_id\) do nothing/);
  });

  it("targets by the rules that accept a yes, own hours included", () => {
    expect(SQL).toMatch(/public\.overtime_schedule_clash\(e\.id, q\.id\) is null/);
    expect(SQL).toMatch(/not exists \(select 1 from public\.overtime_block_for\(e\.id\)\)/);
    expect(SQL).toMatch(/q\.status = 'open'/);
    expect(SQL).toMatch(/\(q\.on_date \+ q\.starts_at\) > \(now\(\) at time zone 'Europe\/London'\)/);
  });

  it("never fails the ask because the bell failed", () => {
    expect(SQL).toMatch(/exception when others then[\s\S]*raise warning 'overtime_request_notify/);
  });

  it("keeps the targeting and the trigger out of reach, anon included", () => {
    expect(SQL).toMatch(/revoke all on function public\.overtime_notify_targets\(uuid\) from public, anon, authenticated/);
    expect(SQL).toMatch(/revoke all on function public\.overtime_ask_notified\(uuid\) from public, anon;/);
  });

  it("lets an employee change only read_at on their own rows", () => {
    expect(SQL).toMatch(/revoke update on public\.notifications from anon, authenticated;/);
    expect(SQL).toMatch(/grant update \(read_at\) on public\.notifications to authenticated;/);
  });
});
