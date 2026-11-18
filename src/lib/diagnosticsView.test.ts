import { describe, expect, it, vi } from "vitest";

vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { diagnosticsView, latestPushPerDevice, type DiagnosticsRow } from "./diagnosticsView";

/**
 * 18/11/2026: "PUSH_STATE (50)" on Root Diagnostics read as fifty errors. It was 22 working
 * phones, 20 waiting on the person holding them, 8 line tablets — and one real fault.
 */

let n = 0;
function push(user: string, meta: Record<string, unknown>, at = "2026-11-18T09:00:00Z"): DiagnosticsRow {
  return {
    id: `p${++n}`, created_at: at, user_id: user, error_type: "PUSH_STATE",
    metadata: { platform: "ios", display: "standalone", permission: "granted", worker: "active", local: "present", server: "registered", reason: null, ...meta },
  };
}
const row = (type: string): DiagnosticsRow => ({ id: `r${++n}`, created_at: "2026-11-18T09:00:00Z", user_id: "u", error_type: type, metadata: {} });

const working = (u: string) => push(u, {});
const notOn = (u: string) => push(u, { permission: "default", local: "absent", server: "not_checked", reason: "not_enabled" });
const staleDenied = (u: string) => push(u, { platform: "desktop", display: "browser", permission: "denied", server: "registered", reason: "permission_denied" });

describe("latestPushPerDevice", () => {
  it("keeps the newest row of each device and drops the older days", () => {
    const today = notOn("anthony");
    const yesterday = working("anthony");
    expect(latestPushPerDevice([today, yesterday])).toEqual([today]);
  });

  it("the same login on another kind of device is another device", () => {
    const phone = working("engineer");
    const desk = staleDenied("engineer");
    expect(latestPushPerDevice([phone, desk])).toHaveLength(2);
  });
});

describe("diagnosticsView", () => {
  const logs = [notOn("a"), working("b"), working("b"), staleDenied("c"), row("RLS_ERROR"), row("NO_SESSION")];

  it("All holds real problems and push faults — not working phones, not the person's, not NO_SESSION", () => {
    const v = diagnosticsView(logs, "all");
    expect(v.problems.map((r) => r.error_type)).toEqual(["PUSH_STATE", "RLS_ERROR"]);
    expect(v.problems[0].metadata?.reason).toBe("permission_denied");
  });

  it("counts PUSH_STATE in devices, and sums them by verdict", () => {
    const v = diagnosticsView(logs, "all");
    expect(v.chips.find((c) => c.type === "PUSH_STATE")?.count).toBe(3);
    expect(v.push).toEqual({ ok: 1, person: 1, fault: 1 });
  });

  it("lists PUSH_STATE faults first, then the person's, then the working ones", () => {
    const v = diagnosticsView(logs, "PUSH_STATE");
    expect(v.shown.map((r) => r.user_id)).toEqual(["c", "a", "b"]);
  });

  it("an empty day shows nothing in All", () => {
    expect(diagnosticsView([working("x"), notOn("y")], "all").problems).toEqual([]);
  });

  it("other chips list their rows as they are", () => {
    expect(diagnosticsView(logs, "NO_SESSION").shown).toHaveLength(1);
  });
});
