import { describe, it, expect } from "vitest";
import {
  audienceLabel, formFromInstant, formProblems, instantFromForm, isRead, percentOf, readSummary, statusOf,
  type AnnouncementInput, type ReportRow,
} from "./announcements";

const row = (over: Partial<ReportRow>): ReportRow => ({
  employee_id: "e", user_id: "u", name: "A", department: "Production", shift_group: "Night",
  has_login: true, read_at: null, acknowledged_at: null, ...over,
});

describe("audienceLabel", () => {
  it("says who it is for in words", () => {
    expect(audienceLabel(null, null)).toBe("All employees");
    expect(audienceLabel("Production", null)).toBe("Production · all shifts");
    expect(audienceLabel(null, "Weekend")).toBe("Weekend shift · all departments");
    expect(audienceLabel("Production", "Weekend")).toBe("Production · Weekend");
    expect(audienceLabel("  ", "")).toBe("All employees");
  });
});

describe("the read report's numbers", () => {
  // The owner's example: Production – Weekend Night, 18 targeted, 15 read, 3 unread, 83%.
  it("matches 15 of 18 → 83%", () => {
    const rows = [
      ...Array.from({ length: 15 }, (_, i) => row({ user_id: `r${i}`, read_at: "t", acknowledged_at: "t" })),
      ...Array.from({ length: 3 }, (_, i) => row({ user_id: `u${i}` })),
    ];
    expect(readSummary(rows)).toEqual({ targeted: 18, read: 15, unread: 3, noLogin: 0, percent: 83 });
  });

  it("counts an employee without a login as targeted and unread, and says how many", () => {
    const s = readSummary([row({ acknowledged_at: "t" }), row({ user_id: null, has_login: false })]);
    expect(s).toMatchObject({ targeted: 2, read: 1, unread: 1, noLogin: 1, percent: 50 });
  });

  it("opening is not confirming when confirmation is asked", () => {
    expect(readSummary([row({ read_at: "t" })]).read).toBe(0);
    expect(readSummary([row({ read_at: "t" })], false).read).toBe(1);
  });

  it("is 0% of nobody, not NaN", () => {
    expect(percentOf(0, 0)).toBe(0);
  });
});

describe("isRead", () => {
  it("needs the acknowledgment when one is asked", () => {
    expect(isRead({ requires_ack: true, read_at: "t", acknowledged_at: null })).toBe(false);
    expect(isRead({ requires_ack: true, read_at: "t", acknowledged_at: "t" })).toBe(true);
    expect(isRead({ requires_ack: false, read_at: "t", acknowledged_at: null })).toBe(true);
  });
});

describe("statusOf", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  it("tells scheduled, live, ended and withdrawn apart", () => {
    expect(statusOf({ published_at: "2026-11-27T07:00:00Z", expires_at: null, withdrawn_at: null }, now)).toBe("scheduled");
    expect(statusOf({ published_at: "2026-11-26T07:00:00Z", expires_at: null, withdrawn_at: null }, now)).toBe("live");
    expect(statusOf({ published_at: "2026-11-20T07:00:00Z", expires_at: "2026-11-25T23:59:00Z", withdrawn_at: null }, now)).toBe("expired");
    expect(statusOf({ published_at: "2026-11-26T07:00:00Z", expires_at: null, withdrawn_at: "2026-11-26T08:00:00Z" }, now)).toBe("withdrawn");
  });
});

describe("the schedule is London time", () => {
  it("07:00 on 12 December is 07:00 UTC (GMT)", () => {
    expect(instantFromForm("2026-12-12", "07:00")).toBe("2026-12-12T07:00:00.000Z");
  });
  it("07:00 on 12 June is 06:00 UTC (BST)", () => {
    expect(instantFromForm("2027-06-12", "07:00")).toBe("2027-06-12T06:00:00.000Z");
  });
  it("goes back into the form unchanged", () => {
    expect(formFromInstant("2027-06-12T06:00:00.000Z")).toEqual({ day: "2027-06-12", time: "07:00" });
  });
  it("refuses half a date", () => {
    expect(instantFromForm("", "07:00")).toBeNull();
  });
});

describe("formProblems", () => {
  const now = new Date("2026-11-26T12:00:00Z");
  const ok: AnnouncementInput = { title: "Company Closure – December 12", body: "Closed.", department: null, shiftGroup: null, urgent: false, publishAt: null, expiresAt: null };
  it("is empty for a ready announcement", () => {
    expect(formProblems(ok, now)).toEqual([]);
  });
  it("asks for a title and a message", () => {
    expect(formProblems({ ...ok, title: " ", body: "" }, now)).toEqual(["Give the announcement a title.", "Write the message."]);
  });
  it("refuses a schedule in the past and an end before the start", () => {
    expect(formProblems({ ...ok, publishAt: "2026-11-26T11:00:00Z" }, now)[0]).toMatch(/already passed/);
    expect(formProblems({ ...ok, publishAt: "2026-11-28T07:00:00Z", expiresAt: "2026-11-27T23:59:00Z" }, now))
      .toEqual(["The end date must be after the publish date."]);
  });
});
