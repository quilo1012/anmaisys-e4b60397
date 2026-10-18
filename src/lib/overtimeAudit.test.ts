import { describe, it, expect } from "vitest";
import { changeLine, detailLine, whenLine, actorLine, EVENT_LABEL, EVENT_GROUPS, type OvertimeAuditRow } from "@/lib/overtimeAudit";

const row = (over: Partial<OvertimeAuditRow>): OvertimeAuditRow => ({
  id: 1, occurred_at: "2026-10-18T09:00:00Z", event_type: "opportunity_edited",
  request_id: null, response_id: null, employee_id: null, employee_name: null,
  actor_id: null, actor_name: null, actor_role: null, actor_kind: "supervisor", source: "supervisor_interface",
  on_date: null, shift: null, starts_at: null, ends_at: null, old_value: null, new_value: null, note: null,
  ...over,
});

describe("overtime history, read as sentences", () => {
  it("says what changed, old beside new, and only that", () => {
    expect(changeLine(row({
      old_value: { starts_at: "06:00:00", ends_at: "14:00:00" },
      new_value: { starts_at: "16:00:00", ends_at: "22:00:00" },
    }))).toBe("start 06:00 → 16:00, end 14:00 → 22:00");
  });

  it("never shows a sickness note, only that one exists", () => {
    const r = row({ event_type: "called_sick", new_value: { outcome: "called_sick", note_recorded: true }, note: null });
    expect(detailLine(r)).toMatch(/note was recorded \(not shown here\)/);
  });

  it("says whether a cancellation was in time or late", () => {
    expect(detailLine(row({ event_type: "employee_cancelled", new_value: { outcome: "cancelled_late" } }))).toBe("late");
  });

  it("names the date, shift and hours of the overtime", () => {
    expect(whenLine(row({ on_date: "2026-10-24", shift: "Day", starts_at: "06:00:00", ends_at: "14:00:00" })))
      .toMatch(/^Sat,? 24 Oct · Day · 06:00–14:00$/);
  });

  it("says System for a write with no session, and the role beside a name", () => {
    expect(actorLine({ actor_name: null, actor_kind: "system" })).toBe("System");
    expect(actorLine({ actor_name: "Max", actor_kind: "administrator" })).toBe("Max (admin)");
  });

  it("puts every event the database can write in exactly one filter group", () => {
    const grouped = Object.values(EVENT_GROUPS).flatMap((g) => g.events);
    expect(new Set(grouped).size).toBe(grouped.length);
    expect([...grouped].sort()).toEqual(Object.keys(EVENT_LABEL).sort());
  });
});
