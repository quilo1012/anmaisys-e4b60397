import { describe, it, expect } from "vitest";
import { attendanceFromBoard, attendanceForStatus } from "@/lib/attendanceFromBoard";

const mark = (status: string, date = "2026-08-02", employeeId = "e1") => ({ employeeId, date, status });

describe("attendanceForStatus", () => {
  it("keeps the words payroll uses, not the board's", () => {
    expect(attendanceForStatus("assigned")).toBe("present");
    expect(attendanceForStatus("overtime")).toBe("present");
    expect(attendanceForStatus("holiday")).toBe("holiday");
    expect(attendanceForStatus("sick")).toBe("sick");
    expect(attendanceForStatus("unpaid")).toBe("unpaid");
  });

  it("treats anything it does not recognise as present rather than as absent", () => {
    // The board is the daily plan and a name on it means somebody was expected in.
    // Guessing "absent" for a status added later would stop paying them.
    expect(attendanceForStatus("something-new")).toBe("present");
  });
});

describe("attendanceFromBoard", () => {
  it("writes one row per person per day", () => {
    const rows = attendanceFromBoard([mark("assigned"), mark("unpaid")]);
    expect(rows).toHaveLength(1);
  });

  it("lets working beat being away on the same day", () => {
    // Anthony Paulo on 02/08: on the weekend board working, and in the day sheet's
    // absence column. He worked. Choosing by shift name made him unpaid on a Sunday
    // he was on a line.
    expect(attendanceFromBoard([mark("unpaid"), mark("assigned")])[0].status).toBe("present");
    expect(attendanceFromBoard([mark("assigned"), mark("unpaid")])[0].status).toBe("present");
  });

  it("does not depend on the order the marks arrive in", () => {
    const a = attendanceFromBoard([mark("holiday"), mark("sick"), mark("unpaid")])[0].status;
    const b = attendanceFromBoard([mark("unpaid"), mark("sick"), mark("holiday")])[0].status;
    expect(a).toBe("holiday");
    expect(b).toBe("holiday");
  });

  it("ranks an away day above nothing but below a day worked", () => {
    expect(attendanceFromBoard([mark("sick"), mark("unpaid")])[0].status).toBe("sick");
    expect(attendanceFromBoard([mark("overtime"), mark("holiday")])[0].status).toBe("present");
  });

  it("never lets an unknown status win over a day somebody demonstrably worked", () => {
    expect(attendanceFromBoard([mark("assigned"), mark("mystery")])[0].status).toBe("present");
  });

  it("keeps different people and different days apart", () => {
    const rows = attendanceFromBoard([
      mark("assigned", "2026-08-02", "e1"),
      mark("holiday", "2026-08-03", "e1"),
      mark("unpaid", "2026-08-02", "e2"),
    ]);
    expect(rows).toHaveLength(3);
    expect(rows.find((r) => r.employee_id === "e2")!.status).toBe("unpaid");
  });

  it("is empty for an empty board", () => {
    expect(attendanceFromBoard([])).toEqual([]);
  });
});
