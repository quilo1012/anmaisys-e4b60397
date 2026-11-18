import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { diagnosticsView, latestPushPerDevice, pushDevicesView, type DiagnosticsRow } from "./diagnosticsView";

/**
 * 18/11/2026: "PUSH_STATE (50)" on Root Diagnostics read as fifty errors — 22 working phones,
 * 20 waiting on the person holding them, 8 line tablets, one real fault. Then, the same
 * evening, "PUSH_STATE (11 devices)" read as "more errors appeared". The readings moved to
 * Phone Notifications; Root Diagnostics lists errors, and push faults among them.
 */

let n = 0;
function push(user: string, meta: Record<string, unknown>, at = "2026-11-18T09:00:00Z"): DiagnosticsRow {
  return {
    id: `p${++n}`, created_at: at, user_id: user, error_type: "PUSH_STATE",
    metadata: { platform: "ios", display: "standalone", permission: "granted", worker: "active", local: "present", server: "registered", reason: null, ...meta },
  };
}
const row = (type: string, at = "2026-11-18T10:00:00Z"): DiagnosticsRow => ({ id: `r${++n}`, created_at: at, user_id: "u", error_type: type, metadata: {} });

const working = (u: string, at?: string) => push(u, {}, at);
const notOn = (u: string, at?: string) => push(u, { permission: "default", local: "absent", server: "not_checked", reason: "not_enabled" }, at);
const staleDenied = (u: string, at?: string) => push(u, { platform: "desktop", display: "browser", permission: "denied", server: "registered", reason: "permission_denied" }, at);

describe("latestPushPerDevice", () => {
  it("keeps the newest row of each device and drops the older days", () => {
    const today = notOn("anthony");
    const yesterday = working("anthony");
    expect(latestPushPerDevice([today, yesterday])).toEqual([today]);
  });

  it("the same login on another kind of device is another device", () => {
    expect(latestPushPerDevice([working("engineer"), staleDenied("engineer")])).toHaveLength(2);
  });
});

describe("pushDevicesView (Phone Notifications)", () => {
  const rows = [notOn("a"), working("b"), working("b"), staleDenied("c")];

  it("one line per device, faults first, then the person's, then working", () => {
    const v = pushDevicesView(rows);
    expect(v.devices.map((d) => [d.user_id, d.verdict])).toEqual([["c", "fault"], ["a", "person"], ["b", "ok"]]);
  });

  it("sums the devices by verdict", () => {
    expect(pushDevicesView(rows).summary).toEqual({ ok: 1, person: 1, fault: 1 });
  });
});

describe("diagnosticsView (Root Diagnostics)", () => {
  const errors = [row("RLS_ERROR", "2026-11-18T10:00:00Z"), row("NO_SESSION", "2026-11-18T09:30:00Z")];
  const pushRows = [notOn("a"), working("b"), staleDenied("c", "2026-11-18T11:00:00Z")];

  it("lists errors and push faults, newest first — no working phone, nothing waiting on a person, no NO_SESSION", () => {
    const v = diagnosticsView(errors, pushRows, "all");
    expect(v.problems.map((r) => r.error_type)).toEqual(["PUSH_STATE", "RLS_ERROR"]);
    expect(v.problems[0].metadata?.reason).toBe("permission_denied");
  });

  it("gives chips only to errors — never a chip of readings", () => {
    const v = diagnosticsView(errors, pushRows, "all");
    expect(v.chips).toEqual([{ type: "PUSH_STATE", count: 1 }, { type: "RLS_ERROR", count: 1 }]);
  });

  it("a day of phones and nothing broken: no chips, nothing listed", () => {
    const v = diagnosticsView([], [working("x"), notOn("y"), notOn("z")], "all");
    expect(v.chips).toEqual([]);
    expect(v.problems).toEqual([]);
  });

  it("counts NO_SESSION once, apart from the list", () => {
    expect(diagnosticsView(errors, [], "all").readings).toBe(1);
  });

  it("a chip filters to its own rows", () => {
    expect(diagnosticsView(errors, pushRows, "RLS_ERROR").shown).toHaveLength(1);
  });
});
