import { describe, it, expect, vi } from "vitest";
import { announceAsk, announceSummary, NO_ONE, type AnnounceDeps } from "./overtimeAnnounce";
import type { PushMessage } from "./overtimePush";

const MSG: PushMessage = {
  title: "Overtime: Sat 24/10 · 06:00–14:00", body: "Need 2", tag: "overtime-ask-a1",
  action_url: "/dashboard/my-overtime", priority: "medium",
};

function deps(over: Partial<{
  notified: { data: unknown; error: { code?: string; message: string } | null };
  targets: { data: unknown; error: { code?: string; message: string } | null };
  push: { data: { sent?: number; in_app?: number; note?: string } | null; error: unknown };
}> = {}) {
  const rpc = vi.fn(async (fn: string) =>
    fn === "overtime_ask_notified"
      ? over.notified ?? { data: ["u1", "u2"], error: null }
      : over.targets ?? { data: ["u1", "u2", "u3"], error: null });
  const invoke = vi.fn(async () => over.push ?? { data: { sent: 1, in_app: 0 }, error: null });
  return { rpc, invoke } satisfies AnnounceDeps;
}

describe("announceAsk, with BLOCO 100 in the database", () => {
  it("buzzes exactly the people the database told, and does not write the bell again", async () => {
    const d = deps();
    const out = await announceAsk(d, "a1", MSG);
    expect(d.rpc).toHaveBeenCalledWith("overtime_ask_notified", { p_request_id: "a1" });
    expect(d.rpc).not.toHaveBeenCalledWith("overtime_push_targets", expect.anything());
    expect(d.invoke).toHaveBeenCalledWith("send-push", expect.objectContaining({ user_ids: ["u1", "u2"], in_app: false }));
    expect(out).toEqual({ ...NO_ONE, notified: 2, pushed: 1 });
  });

  it("counts a person once even if the read-back repeats them", async () => {
    const d = deps({ notified: { data: ["u1", "u1"], error: null } });
    const out = await announceAsk(d, "a1", MSG);
    expect(out.notified).toBe(1);
    expect(d.invoke).toHaveBeenCalledWith("send-push", expect.objectContaining({ user_ids: ["u1"] }));
  });

  it("calls nothing when nobody eligible was told", async () => {
    const d = deps({ notified: { data: [], error: null } });
    expect(await announceAsk(d, "a1", MSG)).toEqual(NO_ONE);
    expect(d.invoke).not.toHaveBeenCalled();
  });

  it("keeps the bell count when the phones fail, and says the phones failed", async () => {
    const d = deps({ push: { data: null, error: { message: "Edge Function returned 400" } } });
    const out = await announceAsk(d, "a1", MSG);
    expect(out.notified).toBe(2);
    expect(out.error).toBeNull();
    expect(out.pushError).toBe("Edge Function returned 400");
  });

  it("says nobody was told when the read-back itself fails", async () => {
    const d = deps({ notified: { data: null, error: { code: "42501", message: "Not allowed" } } });
    const out = await announceAsk(d, "a1", MSG);
    expect(out).toEqual({ ...NO_ONE, error: "Not allowed" });
    expect(d.invoke).not.toHaveBeenCalled();
  });
});

describe("announceAsk, before BLOCO 100 is pasted", () => {
  it("falls back to the old path: targets by audience, send-push writes the bell", async () => {
    const d = deps({
      notified: { data: null, error: { code: "PGRST202", message: "Could not find the function" } },
      push: { data: { sent: 0, in_app: 3 }, error: null },
    });
    const out = await announceAsk(d, "a1", MSG);
    expect(d.rpc).toHaveBeenCalledWith("overtime_push_targets", { p_request_id: "a1" });
    const body = (d.invoke.mock.calls[0] as unknown[])[1] as Record<string, unknown>;
    expect(body).not.toHaveProperty("in_app");
    expect(out.notified).toBe(3);
  });
});

describe("announceSummary", () => {
  const head = "Published: 2 needed on Sat 24/10";

  it("never claims a phone received anything — only that the push service took it", () => {
    const { text } = announceSummary(head, { ...NO_ONE, notified: 4, pushed: 2 });
    expect(text).toContain("4 eligible people notified in the app");
    expect(text).toContain("2 phone alerts handed to the push service");
    expect(text).not.toMatch(/received|delivered|buzzed/);
  });

  it("does not invent a phone count it was not given", () => {
    expect(announceSummary(head, { ...NO_ONE, notified: 1, pushed: null }).text)
      .toBe(`${head} · 1 eligible person notified in the app`);
  });

  it("warns, and still reports the bell, when the phones failed", () => {
    const s = announceSummary(head, { ...NO_ONE, notified: 3, pushError: "boom" });
    expect(s.tone).toBe("warning");
    expect(s.text).toContain("3 eligible people notified in the app");
    expect(s.text).toContain("phone alerts not sent: boom");
  });

  it("says so when push is not set up", () => {
    expect(announceSummary(head, { ...NO_ONE, notified: 3, pushed: 0, note: "VAPID not configured" }).text)
      .toContain("no phone alerts: VAPID not configured");
  });

  it("says nobody was notified when nobody eligible has a login", () => {
    expect(announceSummary(head, NO_ONE).text).toContain("Nobody eligible has a login yet");
  });

  it("warns when nobody could be told at all", () => {
    const s = announceSummary(head, { ...NO_ONE, error: "Not allowed" });
    expect(s.tone).toBe("warning");
    expect(s.text).toContain("nobody was notified: Not allowed");
  });
});
