import { describe, it, expect } from "vitest";
import { newAskMessage, decisionMessage } from "./overtimePush";

const ask = { id: "q1", on_date: "2026-10-10", starts_at: "14:00:00", ends_at: "22:00:00", headcount: 4, department: "Packing", note: null };

describe("newAskMessage", () => {
  it("says when, how many and where, and sends the tap to My Overtime", () => {
    const m = newAskMessage(ask);
    expect(m.title).toBe("Overtime: Sat 10/10 · 14:00–22:00");
    expect(m.body).toBe("Need 4 · Packing. Say yes or no in the app.");
    expect(m.action_url).toBe("/dashboard/my-overtime");
    expect(m.tag).toBe("overtime-ask-q1");
  });

  it("keeps the title under a lock screen's width", () => {
    expect(newAskMessage(ask).title.length).toBeLessThanOrEqual(40);
  });

  it("leaves the department out when the ask is for everyone", () => {
    expect(newAskMessage({ ...ask, department: null }).body).not.toContain("·");
  });
});

describe("decisionMessage", () => {
  it("tells the accepted and the reserve, and nobody else", () => {
    expect(decisionMessage(ask, "accepted")?.title).toBe("You're in for overtime");
    expect(decisionMessage(ask, "reserve")?.title).toContain("reserve");
    expect(decisionMessage(ask, "declined")).toBeNull();
  });

  it("accepted is the one worth a louder buzz", () => {
    expect(decisionMessage(ask, "accepted")?.priority).toBe("high");
    expect(decisionMessage(ask, "reserve")?.priority).toBe("medium");
  });
});
