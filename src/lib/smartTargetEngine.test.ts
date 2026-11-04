import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import {
  forecastShift,
  shiftWindow,
  parseLineNo,
  normaliseSku,
  mergeIntervals,
  totalMinutes,
  freeMinutes,
  backtest,
  type ShiftForecastInput,
  type RateRecord,
  type FillEvent,
  type FillEventSemantics,
  type PlannedJob,
} from "./smartTargetEngine";

/**
 * Synthetic fixtures only. None of this comes from iTouch or the database. The
 * test names carry the numbers of the required tests (T01–T16) so the report can
 * point at them; T17 covers the backtest helper.
 *
 * 3 November 2026 is in GMT, so London wall time equals UTC and the fixtures can
 * be read directly.
 */

const at = (hhmm: string, day = 3) => `2026-11-${String(day).padStart(2, "0")}T${hhmm}:00.000Z`;
const atS = (hhmmss: string, day = 3) => `2026-11-${String(day).padStart(2, "0")}T${hhmmss}.000Z`;

const rate = (sku: string, over: Partial<RateRecord> = {}): RateRecord => ({
  line: "Line 1", sku, value: 600, unit: "containers/hour", status: "validated", sampleShifts: 12, source: "fixture", ...over,
});
const job = (jobId: string, sku: string, sequence: number, over: Partial<PlannedJob> = {}): PlannedJob => ({
  jobId, sku, sequence, ...over,
});
const fullDay = (jobId: string, sku: string): PlannedJob =>
  job(jobId, sku, 1, { plannedStart: at("06:00"), plannedEnd: at("18:00") });

function input(over: Partial<ShiftForecastInput> = {}): ShiftForecastInput {
  return {
    date: "2026-11-03",
    shift: "DAY",
    line: "Line 1",
    jobs: [],
    previousSku: "SKU-A",
    breaks: [],
    downtime: [],
    rates: [rate("SKU-A"), rate("SKU-B")],
    ...over,
  };
}
/** No break allowance, so the arithmetic in a test is only the thing it tests. */
const NO_BREAK = { breakMinutes: 0 };

const VERIFIED: FillEventSemantics = {
  verified: true, acceptedStatuses: ["ok"], rejectedStatuses: ["reject"], note: "synthetic fixture",
};
const ev = (eventId: string | null, timestamp: string | null, over: Partial<FillEvent> = {}): FillEvent => ({
  eventId, timestamp, line: "Line 1", status: "ok", ...over,
});

describe("T01 DAY shift boundaries", () => {
  it("runs 06:00–18:00 London, 720 minutes, in winter and in summer", () => {
    const winter = shiftWindow("2026-11-03", "DAY")!;
    expect(new Date(winter.startMs).toISOString()).toBe("2026-11-03T06:00:00.000Z");
    expect(new Date(winter.endMs).toISOString()).toBe("2026-11-03T18:00:00.000Z");
    expect(winter.grossMinutes).toBe(720);
    // BST: 06:00 London is 05:00 UTC.
    const summer = shiftWindow("2026-07-15", "DAY")!;
    expect(new Date(summer.startMs).toISOString()).toBe("2026-07-15T05:00:00.000Z");
    expect(summer.grossMinutes).toBe(720);
  });

  it("counts an event at 06:00:00 and 17:59:59, not at 05:59:59 or 18:00:00", () => {
    const r = forecastShift(input({
      jobs: [fullDay("J1", "SKU-A")],
      eventSemantics: VERIFIED,
      events: [
        ev("e1", atS("05:59:59")), ev("e2", atS("06:00:00")),
        ev("e3", atS("17:59:59")), ev("e4", atS("18:00:00")),
      ],
    }), NO_BREAK);
    expect(r.events.outsideShift).toBe(2);
    expect(r.actualTotal).toBe(2);
  });
});

describe("T02 NIGHT shift crossing midnight", () => {
  it("runs 18:00 to 06:00 the next day and keeps events either side of midnight", () => {
    const w = shiftWindow("2026-11-03", "NIGHT")!;
    expect(new Date(w.startMs).toISOString()).toBe("2026-11-03T18:00:00.000Z");
    expect(new Date(w.endMs).toISOString()).toBe("2026-11-04T06:00:00.000Z");
    expect(w.grossMinutes).toBe(720);

    const r = forecastShift(input({
      shift: "NIGHT",
      jobs: [job("N1", "SKU-A", 1, { plannedStart: at("18:00"), plannedEnd: at("06:00", 4) })],
      eventSemantics: VERIFIED,
      events: [ev("n1", at("23:59")), ev("n2", at("00:30", 4)), ev("n3", at("06:00", 4)), ev("n4", at("17:59"))],
    }), NO_BREAK);
    expect(r.actualTotal).toBe(2);
    expect(r.events.outsideShift).toBe(2);
    expect(r.jobs[0].actualContainers).toBe(2);
  });

  it("uses the real 780 minutes on the night the clocks go back, and says so", () => {
    expect(shiftWindow("2026-10-24", "NIGHT")!.grossMinutes).toBe(780);
    const r = forecastShift(input({ date: "2026-10-24", shift: "NIGHT", jobs: [] }));
    expect(r.warnings.map((w) => w.code)).toContain("GROSS_NOT_720");
  });

  it("refuses a date that does not exist", () => {
    expect(shiftWindow("2026-02-30", "NIGHT")).toBeNull();
    expect(forecastShift(input({ date: "2026-02-30" })).status).toBe("invalid_input");
  });
});

describe("T03 break allowance and net time", () => {
  const breaks = [
    { start: at("09:00"), end: at("09:15") },
    { start: at("12:00"), end: at("12:30") },
    { start: at("15:00"), end: at("15:30") },
  ];

  it("720 − 75 = 645 net minutes with positioned breaks", () => {
    const r = forecastShift(input({ jobs: [fullDay("J1", "SKU-A")], breaks }));
    expect(r.window!.netMinutes).toBe(645);
    expect(r.jobs[0].allocation!.productiveMinutes).toBe(645);
    expect(r.expectedTotal).toBe(6450);
    expect(r.confidence).toBe("medium");
    expect(r.warnings.map((w) => w.code)).not.toContain("BREAK_TOTAL_MISMATCH");
  });

  it("the same 645 when break times are unknown, but with low confidence", () => {
    const r = forecastShift(input({ jobs: [fullDay("J1", "SKU-A")], breaks: null }));
    expect(r.window!.netMinutes).toBe(645);
    expect(r.jobs[0].allocation!.productiveMinutes).toBe(645);
    expect(r.expectedTotal).toBe(6450);
    expect(r.confidence).toBe("low");
  });
});

describe("T04 valid, duplicate, rejected and ambiguous filling events", () => {
  const events = [
    ev("e1", at("07:00")),
    ev("e2", at("07:01")),
    ev("e1", at("07:02")), // same id again
    ev("e3", at("07:03"), { status: "reject" }),
    ev("e4", at("07:04"), { status: "weird" }),
    ev(null, at("07:05")),
  ];

  it("counts only unique accepted events", () => {
    const r = forecastShift(input({ jobs: [fullDay("J1", "SKU-A")], events, eventSemantics: VERIFIED }), NO_BREAK);
    expect(r.events).toMatchObject({ received: 6, valid: 2, duplicate: 1, rejected: 1, ambiguous: 2 });
    expect(r.actualTotal).toBe(2);
  });

  it("counts nothing while the event meaning is unverified", () => {
    const r = forecastShift(input({ jobs: [fullDay("J1", "SKU-A")], events, eventSemantics: null }), NO_BREAK);
    expect(r.actualTotal).toBeNull();
    expect(r.events.valid).toBe(0);
    expect(r.jobs[0].actualContainers).toBeNull();
    expect(r.jobs[0].candidateEvents).toBe(4); // e1, e2, e3, e4: statuses are not read until verified
    expect(r.warnings.map((w) => w.code)).toContain("EVENT_SEMANTICS_UNVERIFIED");
  });
});

describe("T05 SKU, job and line association", () => {
  it("ties events by job id, then by time; refuses an SKU clash and another line", () => {
    const r = forecastShift(input({
      jobs: [
        job("J1", "SKU-A", 1, { plannedStart: at("06:00"), plannedEnd: at("12:00") }),
        job("J2", "SKU-B", 2, { plannedStart: at("12:00"), plannedEnd: at("18:00") }),
      ],
      eventSemantics: VERIFIED,
      events: [
        ev("a", at("08:00"), { jobId: "J2" }), // explicit id wins over time
        ev("b", at("09:00")),
        ev("c", at("13:00")),
        ev("d", at("10:00"), { jobId: "J1", sku: "SKU-B" }), // SKU disagrees with job
        ev("e", at("10:30"), { jobId: "J9" }), // not a planned job
        ev("f", at("10:45"), { line: "Line 2" }),
      ],
    }), NO_BREAK);
    expect(r.jobs[0].actualContainers).toBe(1);
    expect(r.jobs[1].actualContainers).toBe(2);
    expect(r.events).toMatchObject({ ambiguous: 1, unassociated: 1, wrongLine: 1 });
    expect(r.actualTotal).toBe(4);
  });
});

describe("T06 repeated SKU versus an actual SKU change", () => {
  const jobs = [
    job("J1", "SKU-A", 1, { plannedStart: at("06:00"), plannedEnd: at("10:00") }),
    job("J2", "SKU-A-B7", 2, { plannedStart: at("10:00"), plannedEnd: at("14:00") }), // same SKU, batch suffix
    job("J3", "SKU-B", 3, { plannedStart: at("14:00"), plannedEnd: at("18:00") }),
  ];

  it("charges changeover and mixing only where the SKU changes", () => {
    const r = forecastShift(input({ jobs }), NO_BREAK);
    expect(r.jobs.map((j) => j.transition)).toEqual(["same_sku", "same_sku", "sku_change"]);
    expect(r.jobs.map((j) => j.changeoverMinutes)).toEqual([0, 0, 25]);
    expect(r.jobs.map((j) => j.mixingMinutes)).toEqual([0, 0, 30]);
    expect(r.jobs.map((j) => j.allocation!.productiveMinutes)).toEqual([240, 240, 185]);
  });

  it("treats the first job as a change when another SKU ran before the shift", () => {
    const r = forecastShift(input({ jobs, previousSku: "SKU-B" }), NO_BREAK);
    expect(r.jobs[0].transition).toBe("sku_change");
    expect(r.jobs[0].changeoverMinutes).toBe(25);
  });

  it("charges no changeover when the previous SKU is unknown, and warns", () => {
    const r = forecastShift(input({ jobs, previousSku: undefined }), NO_BREAK);
    expect(r.jobs[0].transition).toBe("first_unknown");
    expect(r.jobs[0].changeoverMinutes).toBe(0);
    expect(r.warnings.map((w) => w.code)).toContain("PREVIOUS_SKU_UNKNOWN");
    expect(r.confidence).toBe("low");
  });
});

describe("T07 changeover at 20, 25 and 30 minutes", () => {
  it.each([
    [20, 670, 6700],
    [25, 665, 6650],
    [30, 660, 6600],
  ])("%i min changeover → %i productive minutes → %i containers", (changeoverMinutes, productive, total) => {
    const r = forecastShift(input({ jobs: [fullDay("J1", "SKU-B")] }), { ...NO_BREAK, changeoverMinutes });
    expect(r.jobs[0].allocation!.productiveMinutes).toBe(productive);
    expect(r.expectedTotal).toBe(total);
  });
});

describe("T08 mixing defaults for lines 1–4 and 5–6", () => {
  it.each([[1, 30], [2, 30], [3, 30], [4, 30], [5, 40], [6, 40]])("Line %i mixes for %i minutes", (line, minutes) => {
    const r = forecastShift(input({
      line: `Line ${line}`,
      previousSku: null,
      jobs: [fullDay("J1", "SKU-A")],
      rates: [rate("SKU-A", { line: `Line ${line}` })],
    }), NO_BREAK);
    expect(r.jobs[0].transition).toBe("first_empty");
    expect(r.jobs[0].changeoverMinutes).toBe(0);
    expect(r.jobs[0].mixingMinutes).toBe(minutes);
    expect(r.jobs[0].allocation!.productiveMinutes).toBe(720 - minutes);
  });

  it("uses a SKU-specific mixing time when the job gives one", () => {
    const r = forecastShift(input({ previousSku: null, jobs: [{ ...fullDay("J1", "SKU-A"), mixingMinutes: 35 }] }), NO_BREAK);
    expect(r.jobs[0].mixingMinutes).toBe(35);
  });
});

describe("T09 mixing overlapping a break", () => {
  const base = input({ previousSku: null, jobs: [fullDay("J1", "SKU-A")], breaks: [{ start: at("06:00"), end: at("06:30") }] });

  it("loses 30 minutes, not 60, when mixing may run during the break", () => {
    const r = forecastShift(base, { breakMinutes: 30, mixingMayOverlapBreak: true });
    expect(r.jobs[0].allocation!.setupEnd).toBe(30);
    expect(r.jobs[0].allocation!.productiveMinutes).toBe(690);
    expect(r.expectedTotal).toBe(6900);
  });

  it("waits for the break to end when it may not", () => {
    const r = forecastShift(base, { breakMinutes: 30, mixingMayOverlapBreak: false });
    expect(r.jobs[0].allocation!.setupEnd).toBe(60);
    expect(r.jobs[0].allocation!.productiveMinutes).toBe(660);
    expect(r.expectedTotal).toBe(6600);
  });
});

describe("T10 no double-counting of overlapping intervals", () => {
  it("merges overlapping and repeated intervals", () => {
    const list = [{ start: 240, end: 300 }, { start: 270, end: 315 }, { start: 240, end: 300 }, { start: 400, end: 400 }];
    expect(mergeIntervals(list)).toEqual([{ start: 240, end: 315 }]);
    expect(totalMinutes(list)).toBe(75);
    expect(freeMinutes(0, 720, list)).toBe(645);
  });

  it("subtracts a stop that overlaps a break once", () => {
    const r = forecastShift(input({
      jobs: [fullDay("J1", "SKU-A")],
      breaks: [{ start: at("10:30"), end: at("11:15") }],
      downtime: [
        { start: at("10:00"), end: at("11:00"), reason: "planned clean" },
        { start: at("10:00"), end: at("11:00"), reason: "same clean, entered twice" },
      ],
    }), { breakMinutes: 45 });
    // Blocked 10:00–11:15 = 75 min, not 60 + 60 + 45 = 165.
    expect(r.jobs[0].allocation!.productiveMinutes).toBe(645);
  });
});

describe("T11 missing timestamps and incomplete data", () => {
  it("sets aside events with no usable timestamp", () => {
    const r = forecastShift(input({
      jobs: [fullDay("J1", "SKU-A")],
      eventSemantics: VERIFIED,
      events: [ev("x1", null), ev("x2", "not a date"), ev("x3", at("07:00"))],
    }), NO_BREAK);
    expect(r.events.incomplete).toBe(2);
    expect(r.actualTotal).toBe(1);
  });

  it("does not invent a duration for a job with no window and no quantity", () => {
    const r = forecastShift(input({
      jobs: [
        job("J1", "SKU-A", 1, { plannedStart: at("06:00"), plannedEnd: at("12:00") }),
        job("J2", "SKU-B", 2),
        job("J3", "SKU-A", 3, { orderQty: 500 }),
      ],
    }), NO_BREAK);
    expect(r.jobs[0].expectedContainers).toBe(3600);
    expect(r.jobs[1].allocation).toBeNull();
    expect(r.jobs[1].reasons[0]).toMatch(/cannot be worked out/);
    expect(r.jobs[2].allocation).toBeNull();
    expect(r.jobs[2].reasons[0]).toMatch(/earlier job's time is unknown/);
    expect(r.status).toBe("partial");
    expect(r.expectedTotal).toBeNull();
    expect(r.expectedKnownSubtotal).toBe(3600);
    expect(r.jobCoverage).toEqual({ forecast: 1, total: 3 });
    expect(r.confidence).toBe("none");
  });
});

describe("T12 order quantity differing from observed quantity", () => {
  it("forecasts from rate × time and counts from events, never from the order", () => {
    const events = Array.from({ length: 450 }, (_, i) =>
      ev(`f${i}`, new Date(Date.parse(at("06:00")) + i * 8000).toISOString()));
    const r = forecastShift(input({
      jobs: [job("J1", "SKU-A", 1, { plannedStart: at("06:00"), plannedEnd: at("07:00"), orderQty: 1000 })],
      eventSemantics: VERIFIED,
      events,
    }), NO_BREAK);
    expect(r.jobs[0].orderQty).toBe(1000);
    expect(r.jobs[0].expectedContainers).toBe(600);
    expect(r.jobs[0].actualContainers).toBe(450);
    expect(r.jobs[0].difference).toBe(-150);
    expect(r.jobs[0].observedPerHour).toBe(450);
  });

  it("places a job without a window by order ÷ rate, but does not forecast the order back", () => {
    const r = forecastShift(input({ jobs: [job("J1", "SKU-A", 1, { orderQty: 300 })] }), NO_BREAK);
    expect(r.jobs[0].allocation).toMatchObject({ start: 0, end: 30, productiveMinutes: 30, basis: "order_qty_at_rate" });
    expect(r.jobs[0].expectedContainers).toBeNull();
    expect(r.jobs[0].reasons[0]).toMatch(/would only repeat the order/);
    expect(r.expectedTotal).toBeNull();
    expect(r.warnings.map((w) => w.code)).toEqual(expect.arrayContaining(["DURATION_FROM_ORDER_QTY", "UNPLANNED_TIME"]));
  });

  it("forecasts the part of an order-sized job that the shift cuts off", () => {
    // 9000 at 600/h needs 900 min; the shift has 720, so the shift caps it.
    const r = forecastShift(input({ jobs: [job("J1", "SKU-A", 1, { orderQty: 9000 })] }), NO_BREAK);
    expect(r.jobs[0].expectedContainers).toBe(7200);
    expect(r.warnings.map((w) => w.code)).toContain("ORDER_RUNS_PAST_SHIFT");
    expect(r.confidence).toBe("low");
  });
});

describe("T13 SKU without enough history", () => {
  it("gives no number below the minimum sample, even for a 'validated' rate", () => {
    const r = forecastShift(input({ jobs: [fullDay("J1", "SKU-A")], rates: [rate("SKU-A", { sampleShifts: 3 })] }), NO_BREAK);
    expect(r.jobs[0].rateStatus).toBe("insufficient_history");
    expect(r.jobs[0].expectedContainers).toBeNull();
    expect(r.status).toBe("insufficient_data");
    expect(r.confidence).toBe("none");
  });

  it("keeps provisional rates apart, with low confidence", () => {
    const r = forecastShift(input({ jobs: [fullDay("J1", "SKU-A")], rates: [rate("SKU-A", { status: "provisional", sampleShifts: 8 })] }), NO_BREAK);
    expect(r.jobs[0].rateStatus).toBe("provisional");
    expect(r.expectedTotal).toBe(7200);
    expect(r.confidence).toBe("low");
  });

  it("refuses to pick between two validated rates that disagree", () => {
    const r = forecastShift(input({ jobs: [fullDay("J1", "SKU-A")], rates: [rate("SKU-A"), rate("SKU-A", { value: 650, source: "other" })] }), NO_BREAK);
    expect(r.jobs[0].rateStatus).toBe("conflict");
    expect(r.expectedTotal).toBeNull();
  });
});

describe("T14 inconsistent units and line identifiers", () => {
  it("reads the line spellings the factory uses and nothing else", () => {
    expect(parseLineNo("Line 3")).toBe(3);
    expect(parseLineNo("L3")).toBe(3);
    expect(parseLineNo("Filler Line 5")).toBe(5);
    expect(parseLineNo(6)).toBe(6);
    expect(parseLineNo("Line 1A")).toBeNull();
    expect(parseLineNo("Line 7")).toBeNull();
    expect(parseLineNo(0)).toBeNull();
    expect(normaliseSku(" 'carbpm-b12' ")).toBe("CARBPM");
  });

  it("refuses a rate in the wrong unit or for an unknown line, and converts per-minute", () => {
    const r = forecastShift(input({
      jobs: [fullDay("J1", "SKU-A"), job("J2", "SKU-B", 2)],
      rates: [
        rate("SKU-A", { unit: "kg/hour" }),
        rate("SKU-A", { line: "Line 7" }),
        rate("SKU-B", { value: 10, unit: "containers/min" }),
      ],
    }), NO_BREAK);
    const codes = r.warnings.map((w) => w.code);
    expect(codes).toEqual(expect.arrayContaining(["RATE_BAD_UNIT", "RATE_BAD_LINE"]));
    expect(r.jobs[0].rateStatus).toBe("missing");
    expect(r.jobs[1].rateStatus).toBe("validated");
    expect(r.jobs[1].rate!.perHour).toBe(600);
  });

  it("refuses a shift for a line that is not 1–6", () => {
    const r = forecastShift(input({ line: "Line 9", jobs: [fullDay("J1", "SKU-A")] }));
    expect(r.status).toBe("invalid_input");
    expect(r.warnings[0].code).toBe("BAD_LINE");
  });
});

describe("T15 deterministic repeated results", () => {
  const make = (): ShiftForecastInput => input({
    jobs: [
      job("J1", "SKU-A", 1, { plannedStart: at("06:00"), plannedEnd: at("12:00") }),
      job("J2", "SKU-B", 2, { plannedStart: at("12:00"), plannedEnd: at("18:00") }),
    ],
    breaks: [{ start: at("09:00"), end: at("09:45") }, { start: at("14:00"), end: at("14:30") }],
    eventSemantics: VERIFIED,
    events: [ev("a", at("07:00")), ev("b", at("13:00")), ev("a", at("07:00")), ev("c", at("15:00"))],
  });

  it("gives the same output every time, whatever order the input arrives in", () => {
    const first = forecastShift(make());
    const again = forecastShift(make());
    const shuffled = make();
    shuffled.jobs.reverse();
    shuffled.events!.reverse();
    expect(again).toEqual(first);
    expect(forecastShift(shuffled)).toEqual(first);
  });

  it("does not change its input", () => {
    const original = make();
    const copy = structuredClone(original);
    forecastShift(original);
    expect(original).toEqual(copy);
  });
});

describe("T16 read-only: the engine cannot read or write anything", () => {
  const source = readFileSync(resolve(__dirname, "smartTargetEngine.ts"), "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");

  it("imports only the shift clock", () => {
    const imports = [...source.matchAll(/^import .* from "(.*)";$/gm)].map((m) => m[1]);
    expect(imports).toEqual(["./shifts"]);
  });

  it("has no database, network, clock or random calls", () => {
    for (const forbidden of [
      /supabase/i, /\bfetch\s*\(/, /XMLHttpRequest/, /\.(insert|update|upsert|delete|rpc)\s*\(/,
      /Date\.now/, /new Date\(\)/, /Math\.random/, /localStorage|sessionStorage|indexedDB/,
    ]) {
      expect(source, String(forbidden)).not.toMatch(forbidden);
    }
  });

  it("the module it imports reads nothing either", () => {
    const shifts = readFileSync(resolve(__dirname, "shifts.ts"), "utf8");
    expect(shifts).not.toMatch(/^import /m);
  });
});

describe("T17 backtest by completed shift", () => {
  it("scores sufficient and insufficient history apart, and lists exclusions", () => {
    const res = backtest([
      { key: "s1", forecast: 100, actual: 110, historySufficient: true },
      { key: "s2", forecast: 200, actual: 180, historySufficient: true },
      { key: "s3", forecast: 50, actual: 0, historySufficient: true },
      { key: "s4", forecast: 90, actual: 95, historySufficient: true, excludeReason: "line stopped all shift" },
      { key: "i1", forecast: null, actual: 100, historySufficient: false },
      { key: "i2", forecast: 90, actual: 100, historySufficient: false },
    ]);
    expect(res.sufficient).toEqual({
      shifts: 4, scored: 3, coverage: 75, meanAbsError: 26.7, medianAbsError: 20, medianAbsPctError: 10.1, pctScored: 2,
    });
    expect(res.insufficient).toMatchObject({ shifts: 2, scored: 1, medianAbsError: 10, medianAbsPctError: 10 });
    expect(res.excluded).toEqual([
      { key: "s4", reason: "line stopped all shift" },
      { key: "i1", reason: "no forecast" },
    ]);
  });

  it("flags an outlier without removing it", () => {
    const res = backtest([101, 102, 103, 102, 200].map((f, i) => ({ key: `k${i}`, forecast: f, actual: 100, historySufficient: true })));
    expect(res.outliers).toEqual([{ key: "k4", pctError: 100 }]);
    expect(res.sufficient.scored).toBe(5);
  });
});

describe("R regression: review of 04/11", () => {
  it("R1 an unplaced break is not soaked up by setup time", () => {
    // 720 − 25 changeover − 30 mixing − 75 break = 590 productive → 5900.
    const r = forecastShift(input({ previousSku: "X", jobs: [fullDay("J1", "SKU-A")], breaks: null }));
    expect(r.jobs[0].allocation!.productiveMinutes).toBe(590);
    expect(r.expectedTotal).toBe(5900);
  });

  it("R1 nor by downtime", () => {
    const r = forecastShift(input({ jobs: [fullDay("J1", "SKU-A")], breaks: null, downtime: [{ start: at("10:00"), end: at("12:00") }] }));
    expect(r.jobs[0].allocation!.productiveMinutes).toBe(525);
  });

  it("R3 an order-sized job stops at the next job's planned start", () => {
    const r = forecastShift(input({
      jobs: [
        job("J1", "SKU-A", 1, { orderQty: 6000 }),
        job("J2", "SKU-B", 2, { plannedStart: at("08:00"), plannedEnd: at("18:00") }),
      ],
    }), NO_BREAK);
    expect(r.jobs[0].allocation!.end).toBe(120);
    expect(r.jobs[0].expectedContainers).toBe(1200);
    expect(r.warnings.map((w) => w.code)).toContain("ORDER_RUNS_INTO_NEXT_JOB");
    expect(r.jobs[1].allocation).toMatchObject({ start: 120, end: 720 });
    // 600 min window − 25 changeover − 30 mixing = 545 productive → 5450.
    expect(r.jobs[1].expectedContainers).toBe(5450);
  });

  it("R3 says so when a planned window is unusable", () => {
    const r = forecastShift(input({ jobs: [job("J1", "SKU-A", 1, { plannedStart: at("12:00"), plannedEnd: at("08:00") })] }), NO_BREAK);
    expect(r.warnings.map((w) => w.code)).toContain("WINDOW_IGNORED");
  });

  it("R4 a job with no SKU is not a SKU change, and the job after it is not 'the same SKU'", () => {
    const r = forecastShift(input({
      previousSku: "SKU-A",
      jobs: [
        job("J1", "SKU-A", 1, { plannedStart: at("06:00"), plannedEnd: at("10:00") }),
        job("J2", "", 2, { plannedStart: at("10:00"), plannedEnd: at("14:00") }),
        job("J3", "SKU-A", 3, { plannedStart: at("14:00"), plannedEnd: at("18:00") }),
      ],
    }), NO_BREAK);
    expect(r.jobs.map((j) => j.transition)).toEqual(["same_sku", "sku_unknown", "sku_unknown"]);
    expect(r.jobs.map((j) => j.changeoverMinutes + j.mixingMinutes)).toEqual([0, 0, 0]);
    expect(r.confidence).toBe("none"); // J2 has no SKU, so no rate and no total
  });

  it("R6 a sequence that is not a number goes last, deterministically", () => {
    const jobs = [job("J1", "SKU-A", Number.NaN, { plannedStart: at("06:00"), plannedEnd: at("07:00") }), job("J2", "SKU-A", 1, { plannedStart: at("07:00"), plannedEnd: at("08:00") })];
    const a = forecastShift(input({ jobs }), NO_BREAK);
    const b = forecastShift(input({ jobs: [...jobs].reverse() }), NO_BREAK);
    expect(a.jobs.map((j) => j.jobId)).toEqual(["J2", "J1"]);
    expect(b).toEqual(a);
    expect(a.warnings.map((w) => w.code)).toContain("BAD_SEQUENCE");
  });
});
