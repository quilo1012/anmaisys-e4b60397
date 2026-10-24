import { describe, it, expect } from "vitest";
import {
  attendanceOrder, attendanceStateOf, attendanceSummary, attendanceTrail, isExpected, responseStateOf,
  type AttendanceRow,
} from "@/lib/overtimeAttendance";

const row = (o: Partial<AttendanceRow>): AttendanceRow => ({
  responseId: "r", employeeId: "e", name: "A", response: "accepted", attendance: "not_checked",
  note: null, recordedAt: null, recordedBy: null, corrected: false, ...o,
});

describe("response and attendance are two answers", () => {
  it("reads the employee's answer, not the supervisor's decision, as Declined", () => {
    expect(responseStateOf({ answer: "no", decision: null })).toBe("declined");
    expect(responseStateOf({ answer: "yes", decision: "declined" })).toBe("not_needed");
    expect(responseStateOf({ answer: "yes", decision: null })).toBe("pending");
    expect(responseStateOf({ answer: "yes", decision: "accepted" })).toBe("accepted");
    expect(responseStateOf({ answer: "yes", decision: "reserve" })).toBe("reserve");
  });

  it("is Not yet checked until somebody records it — never Absent by default", () => {
    expect(attendanceStateOf(undefined)).toBe("not_checked");
    expect(attendanceStateOf(null)).toBe("not_checked");
    expect(attendanceStateOf("attended")).toBe("present");
    expect(attendanceStateOf("no_show")).toBe("absent");
    expect(attendanceStateOf("called_sick")).toBe("called_sick");
    expect(attendanceStateOf("cancelled_late")).toBe("cancelled");
  });

  it("an accepted yes is not Present", () => {
    const s = attendanceSummary([row({ response: "accepted" })]);
    expect(s).toMatchObject({ accepted: 1, present: 0, absent: 0, unconfirmed: 1 });
  });
});

describe("the summary", () => {
  it("counts accepted, present, absent and unconfirmed apart", () => {
    const s = attendanceSummary([
      row({ attendance: "present" }),
      row({ attendance: "absent" }),
      row({ attendance: "called_sick" }),
      row({ attendance: "not_checked" }),
    ]);
    expect(s).toEqual({ accepted: 4, present: 1, absent: 2, unconfirmed: 1, declined: 0, reserve: 0 });
  });

  it("does not count a decline, a reserve or a cancelled booking as expected headcount", () => {
    const rows = [
      row({ response: "declined" }),
      row({ response: "reserve" }),
      row({ response: "accepted", attendance: "cancelled" }),
    ];
    expect(rows.some(isExpected)).toBe(false);
    expect(attendanceSummary(rows)).toEqual({ accepted: 0, present: 0, absent: 0, unconfirmed: 0, declined: 1, reserve: 1 });
  });
});

describe("the trail", () => {
  it("names who recorded last and marks a correction", () => {
    const t = attendanceTrail([
      { response_id: "r1", event_type: "attended", actor_name: "Sam", occurred_at: "2026-10-24T06:10:00Z" },
      { response_id: "r1", event_type: "no_show", actor_name: "Lee", occurred_at: "2026-10-24T07:00:00Z" },
      { response_id: "r2", event_type: "attended", actor_name: "Sam", occurred_at: "2026-10-24T06:12:00Z" },
      { response_id: "r2", event_type: "answered_yes", actor_name: "Jo", occurred_at: "2026-10-24T06:13:00Z" },
    ]);
    expect(t.get("r1")).toEqual({ by: "Lee", at: "2026-10-24T07:00:00Z", count: 2 });
    expect(t.get("r2")?.count).toBe(1);
  });
});

it("lists who still needs checking first", () => {
  const rows = [
    row({ name: "P", attendance: "present" }),
    row({ name: "D", response: "declined" }),
    row({ name: "U", attendance: "not_checked" }),
    row({ name: "A", attendance: "absent" }),
  ].sort(attendanceOrder);
  expect(rows.map((r) => r.name)).toEqual(["U", "A", "P", "D"]);
});
