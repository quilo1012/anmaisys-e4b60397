import { describe, it, expect } from "vitest";
import {
  askShift, windowMinutes, hoursLabel, askState, summarise, filterAsks, inRange, clashesFor,
  scheduleClashKey, boardDatesFor, duplicateNames, DEFAULT_FILTERS, type BoardRow,
} from "./overtimeShifts";
import type { OvertimeRequest, OvertimeResponse, OvertimeOutcome } from "./overtimeRequests";

const ask = (id: string, p: Partial<OvertimeRequest> = {}): OvertimeRequest => ({
  id, on_date: "2026-10-14", starts_at: "06:00:00", ends_at: "18:00:00", headcount: 2,
  department: null, shift_group: null, note: null, status: "open",
  created_by: "u", created_at: "2026-10-12T10:00:00Z", closed_at: null, ...p,
});
let n = 0;
const ans = (request_id: string, employee_id: string, p: Partial<OvertimeResponse> = {}): OvertimeResponse => ({
  id: `r${++n}`, request_id, employee_id, answer: "yes", decision: null,
  answered_at: "2026-10-12T11:00:00Z", decided_at: null, ...p,
});
const group = (rs: OvertimeResponse[]) => {
  const m = new Map<string, OvertimeResponse[]>();
  for (const r of rs) m.set(r.request_id, [...(m.get(r.request_id) ?? []), r]);
  return m;
};

describe("askShift — the board the hours land on, not the person's crew", () => {
  it("06:00 to 17:59 starts are Day, everything else Night (overtime_board_shift)", () => {
    expect(askShift({ starts_at: "06:00:00" })).toBe("Day");
    expect(askShift({ starts_at: "14:00" })).toBe("Day");
    expect(askShift({ starts_at: "17:59" })).toBe("Day");
    expect(askShift({ starts_at: "18:00" })).toBe("Night");
    expect(askShift({ starts_at: "02:00" })).toBe("Night");
    expect(askShift({ starts_at: "05:59" })).toBe("Night");
  });
});

describe("hours", () => {
  it("crosses midnight", () => {
    expect(windowMinutes("18:00:00", "06:00:00")).toBe(720);
    expect(windowMinutes("06:00", "14:30")).toBe(510);
    expect(hoursLabel(510)).toBe("8h30");
    expect(hoursLabel(1440)).toBe("24h");
  });
});

describe("askState", () => {
  it("an open ask with every place accepted reads Filled; stored statuses pass through", () => {
    const a = ask("a", { headcount: 1 });
    expect(askState(a, [])).toBe("open");
    expect(askState(a, [ans("a", "e1", { decision: "accepted" })])).toBe("filled");
    expect(askState({ ...a, status: "cancelled" }, [])).toBe("cancelled");
  });
});

describe("summarise — counts that match the rows and never double-count", () => {
  it("separates asks, undecided answers and confirmed answers, and sums hours", () => {
    const day = ask("d", { headcount: 3 });
    const night = ask("n", { starts_at: "18:00", ends_at: "06:00", headcount: 1 });
    const gone = ask("x", { status: "cancelled" });
    const rs = [
      ans("d", "e1", { decision: "accepted" }),
      ans("d", "e2", { decision: "accepted" }),
      ans("d", "e3"),                                   // awaiting
      ans("d", "e4", { answer: "no" }),                 // not interest
      ans("d", "e5", { decision: "reserve" }),          // neither awaiting nor confirmed
      ans("n", "e6", { decision: "accepted" }),
      ans("x", "e7", { decision: "accepted" }),         // cancelled ask: not confirmed
    ];
    const dropped = rs[1];
    const outcomes = new Map<string, OvertimeOutcome>([[dropped.id, "called_sick"]]);
    const s = summarise([day, night, gone], group(rs), outcomes);
    expect(s.needsPeople).toBe(1);          // day: 2 accepted of 3
    expect(s.awaitingDecision).toBe(1);
    expect(s.confirmed).toBe(2);            // e1 (day) + e6 (night); e2 called sick
    expect(s.scheduledMinutes).toBe(720 * 2);
  });
});

describe("filters", () => {
  const today = "2026-10-13";
  it("Upcoming keeps today onward plus older asks left open", () => {
    expect(inRange(ask("a", { on_date: "2026-10-10", status: "open" }), DEFAULT_FILTERS, today)).toBe(true);
    expect(inRange(ask("a", { on_date: "2026-10-10", status: "closed" }), DEFAULT_FILTERS, today)).toBe(false);
  });
  it("date, status and department work together", () => {
    const asks = [
      ask("a", { on_date: "2026-10-14", department: "Packing" }),
      ask("b", { on_date: "2026-10-14", department: "Blending" }),
      ask("c", { on_date: "2026-10-15", department: "Packing" }),
      ask("d", { on_date: "2026-10-14", department: "Packing", status: "closed" }),
    ];
    const got = filterAsks(asks, new Map(), { range: "tomorrow", date: "", state: "open", department: "Packing" }, today);
    expect(got.map((r) => r.id)).toEqual(["a"]);
    const onDate = filterAsks(asks, new Map(), { ...DEFAULT_FILTERS, range: "date", date: "2026-10-15" }, today);
    expect(onDate.map((r) => r.id)).toEqual(["c"]);
  });
});

describe("clashesFor", () => {
  const nightAsk = ask("n", { on_date: "2026-10-14", starts_at: "18:00", ends_at: "06:00" });
  const board = (p: Partial<BoardRow>): BoardRow => ({ on_date: "2026-10-14", shift: "Day", employee_id: "e1", status: "assigned", ...p });

  it("a day-crew person with nothing on the night is free for night overtime", () => {
    expect(clashesFor("e1", nightAsk, [], [board({ on_date: "2026-10-12" })])).toEqual([]);
  });
  it("rostered on the same shift blocks — it would be the shift twice", () => {
    const c = clashesFor("e1", nightAsk, [], [board({ shift: "Night" })]);
    expect(c).toEqual([expect.objectContaining({ severity: "block" })]);
  });
  it("accepted on another ask for the same date and shift blocks the duplicate", () => {
    const other = ask("o", { on_date: "2026-10-14", starts_at: "20:00", ends_at: "02:00" });
    const c = clashesFor("e1", nightAsk, [{ request: other, responses: [ans("o", "e1", { decision: "accepted" })] }], []);
    expect(c[0].severity).toBe("block");
  });
  it("a cancelled ask, or this ask's own overtime row on the board, is not a clash", () => {
    const other = ask("o", { on_date: "2026-10-14", starts_at: "20:00", status: "cancelled" });
    expect(clashesFor("e1", nightAsk,
      [{ request: other, responses: [ans("o", "e1", { decision: "accepted" })] }],
      [board({ shift: "Night", status: "overtime" })])).toEqual([]);
  });
  it("accepted on the day ask before a night ask warns — no rest, but not a duplicate", () => {
    const dayAsk = ask("d", { on_date: "2026-10-14", starts_at: "06:00", ends_at: "18:00" });
    const c = clashesFor("e1", nightAsk, [{ request: dayAsk, responses: [ans("d", "e1", { decision: "accepted" })] }], []);
    expect(c).toEqual([{ severity: "warn", text: "No rest: accepted for 14/10 06:00–18:00" }]);
  });
  it("holiday that day and back-to-back shifts warn", () => {
    expect(clashesFor("e1", nightAsk, [], [board({ status: "holiday" })])[0])
      .toEqual({ severity: "warn", text: "On holiday 14/10" });
    expect(clashesFor("e1", nightAsk, [], [board({ shift: "Day" })])[0].text).toMatch(/No rest/);
    expect(clashesFor("e1", nightAsk, [], [board({ on_date: "2026-10-15", shift: "Day" })])[0].text).toMatch(/No rest/);
  });
});

describe("clashesFor — the database's reading of the person's own hours", () => {
  const satDay = ask("s", { on_date: "2026-10-17", starts_at: "06:00", ends_at: "18:00" });
  const own = new Map([[scheduleClashKey("s", "e1"),
    "Your rota has you on the day shift on Sat 17/10, 06:00–18:00"]]);

  it("blocks the accept when the rota covers the hours and the board is not drawn", () => {
    expect(clashesFor("e1", satDay, [], [], own)).toEqual([
      { severity: "block", text: "Your rota has you on the day shift on Sat 17/10, 06:00–18:00" },
    ]);
  });
  it("is about that person on that ask only", () => {
    expect(clashesFor("e2", satDay, [], [], own)).toEqual([]);
    expect(clashesFor("e1", ask("t", { on_date: "2026-10-17" }), [], [], own)).toEqual([]);
  });
  it("does not say it twice when the board already found the same shift", () => {
    const c = clashesFor("e1", satDay, [],
      [{ on_date: "2026-10-17", shift: "Day", employee_id: "e1", status: "assigned" }], own);
    expect(c.filter((x) => x.severity === "block")).toHaveLength(1);
  });
  it("without the block pasted, the board alone decides as before", () => {
    expect(clashesFor("e1", satDay, [], [], undefined)).toEqual([]);
  });
});

describe("helpers", () => {
  it("reads the board a day either side", () => {
    expect(boardDatesFor([{ on_date: "2026-10-01" }])).toEqual(["2026-09-30", "2026-10-01", "2026-10-02"]);
  });
  it("finds names shared by two people", () => {
    expect([...duplicateNames([{ full_name: "Daniel" }, { full_name: "daniel " }, { full_name: "Ana" }])]).toEqual(["daniel"]);
  });
});
