import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import {
  parseRagTemplateFile,
  parseDowntimeMinutes,
  parseDateCell,
  metricOf,
  mondayOf,
  yearFromSheetName,
  cleanLineKey,
  isHeaderText,
} from "./ragTemplateImport";

// The factory workbook ("August Production RAG Performance v1.xlsx") is the layout
// nobody controls: labels in column B, seven Day/Night/Total blocks, the date as the
// text "24-Aug-26" two rows above, and the line name sitting in the header row itself.
// The round-trip test next door covers our own template; this one covers theirs.

function asFile(buf: ArrayBuffer): File {
  return { arrayBuffer: async () => buf } as unknown as File;
}

const DAY_COL = (i: number) => 2 + i * 3; // Mon = C, then Day/Night/Total per day
const WEEKDAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];
const DATES = [
  "24-Aug-26", "25-Aug-26", "26-Aug-26", "27-Aug-26", "28-Aug-26", "29-Aug-26", "30-Aug-26",
];

type Cell = string | number | null;
/** One line's seven days: [day, night, total] per metric, `null` where the sheet is blank. */
interface LineBlock {
  name: string;
  plan: Cell[][];
  actual: Cell[][];
  upmTarget: Cell[][];
  upmActual: Cell[][];
  downtime: Cell[][];
  comments: Cell[];
}

const blank = (): Cell[][] => Array.from({ length: 7 }, () => [null, null, null]);

function spread(rows: Cell[][]): Cell[] {
  return rows.flat();
}

/**
 * Build a workbook shaped like the factory one. Each line gets its own weekday row,
 * date row and Day/Night/Total header row, exactly as the real file repeats them.
 * Returns the sheet and the merges it needs, ready for `!merges`.
 */
function buildFactorySheet(blocks: LineBlock[]) {
  const aoa: Cell[][] = [];
  const merges: XLSX.Range[] = [];
  const errorCells: string[] = [];

  for (const b of blocks) {
    const weekdayRow: Cell[] = [null, null];
    const dateRow: Cell[] = [null, null];
    const headerRow: Cell[] = [null, b.name];
    for (let i = 0; i < 7; i++) {
      weekdayRow.push(WEEKDAYS[i], null, null);
      dateRow.push(DATES[i], null, null);
      headerRow.push("Day", "Night", "Total");
    }

    const r0 = aoa.length;
    aoa.push(weekdayRow, dateRow, headerRow);
    for (let i = 0; i < 7; i++) {
      const c = DAY_COL(i);
      merges.push({ s: { r: r0, c }, e: { r: r0, c: c + 2 } });
      merges.push({ s: { r: r0 + 1, c }, e: { r: r0 + 1, c: c + 2 } });
    }

    aoa.push([null, "Plan", ...spread(b.plan)]);
    aoa.push([null, "Actual", ...spread(b.actual)]);
    aoa.push([null, "Variance %", ...spread(blank())]);
    aoa.push([null, "UPM Target", ...spread(b.upmTarget)]);
    aoa.push([null, "UPM Actual", ...spread(b.upmActual)]);
    aoa.push([null, "Downtime", ...spread(b.downtime)]);

    const commentRow: Cell[] = [null, "Comments"];
    for (let i = 0; i < 7; i++) commentRow.push(b.comments[i] ?? null, null, null);
    aoa.push(commentRow);
    aoa.push([]); // the blank row between line blocks
  }

  return { aoa, merges, errorCells };
}

function workbookFile(
  sheets: { name: string; aoa: Cell[][]; merges?: XLSX.Range[]; errors?: string[] }[],
): File {
  const wb = XLSX.utils.book_new();
  for (const s of sheets) {
    const ws = XLSX.utils.aoa_to_sheet(s.aoa as unknown[][]);
    if (s.merges?.length) ws["!merges"] = s.merges;
    // #DIV/0! is a real cell in the factory sheet, not a blank: it must be dropped,
    // not read as 0 and not read as the text "#DIV/0!".
    for (const addr of s.errors ?? []) ws[addr] = { t: "e", v: 0x07, w: "#DIV/0!" };
    XLSX.utils.book_append_sheet(wb, ws, s.name);
  }
  const buf = XLSX.write(wb, { type: "array", bookType: "xlsx" }) as ArrayBuffer;
  return asFile(buf);
}

/** The fixture: Line 1 across a full week, plus a line that is not in the Lines table. */
function fixture() {
  const line1: LineBlock = {
    name: "Line 1",
    plan: blank(),
    actual: blank(),
    upmTarget: blank(),
    upmActual: blank(),
    downtime: blank(),
    comments: [],
  };
  // Monday: both shifts ran; UPM only in the day's Total column, as the factory fills it.
  line1.plan[0] = [1000, 800, 1800];
  line1.actual[0] = [950, 820, 1770];
  line1.upmTarget[0] = [null, null, 60];
  line1.upmActual[0] = [null, null, 57];
  line1.downtime[0] = ["2:00", "1:20", null];
  // Tuesday: day only. The Actual carries a number here so that patching the cell
  // to #DIV/0! below is what makes it disappear — a blank would prove nothing.
  line1.plan[1] = [1200, null, 1200];
  line1.actual[1] = [777, null, 777];
  line1.downtime[1] = ["0:45", null, null];
  // Wednesday: a comment merged across Wednesday and Thursday.
  line1.plan[2] = [900, 700, 1600];
  line1.comments[2] = "Blender B down all afternoon";
  // Saturday: day shift only — no night shift to invent.
  line1.plan[5] = [500, null, 500];
  line1.actual[5] = [480, null, 480];
  line1.upmActual[5] = [null, null, 40];
  // Sunday: nothing ran.

  const unknown: LineBlock = {
    name: "Line 99",
    plan: blank(),
    actual: blank(),
    upmTarget: blank(),
    upmActual: blank(),
    downtime: blank(),
    comments: [],
  };
  unknown.plan[0] = [111, 222, 333];

  const built = buildFactorySheet([line1, unknown]);

  // Line 1's Actual row is the 5th row of its block (0-based row 4) — Tuesday's Day column.
  const actualRow = 4;
  const errors = [XLSX.utils.encode_cell({ r: actualRow, c: DAY_COL(1) })];

  // The comment spans Wednesday's Day column through Thursday's Total column.
  const commentRow = 9;
  built.merges.push({
    s: { r: commentRow, c: DAY_COL(2) },
    e: { r: commentRow, c: DAY_COL(3) + 2 },
  });

  return workbookFile([
    { name: "Instructions", aoa: [["How to fill this in"], ["Do not edit the totals"]] },
    { name: "WC 240826", aoa: built.aoa, merges: built.merges, errors },
  ]);
}

const LINES = ["Line 1", "Capsules & Tablets"];

describe("RAG import — factory workbook layout", () => {
  it("reads downtime written as h:mm", async () => {
    const r = await parseRagTemplateFile(fixture(), LINES);
    const by = new Map(r.rows.map((x) => [`${x.entry_date}|${x.line}|${x.shift}`, x]));
    expect(by.get("2026-08-24|Line 1|DAY")!.downtime_min).toBe(120);
    expect(by.get("2026-08-24|Line 1|NIGHT")!.downtime_min).toBe(80);
    expect(by.get("2026-08-25|Line 1|DAY")!.downtime_min).toBe(45);
  }, 20_000);

  it("drops #DIV/0! instead of importing it as a value", async () => {
    const r = await parseRagTemplateFile(fixture(), LINES);
    const tue = r.rows.find((x) => x.entry_date === "2026-08-25" && x.shift === "DAY")!;
    expect(tue.plan_qty).toBe(1200);
    expect(tue.actual_qty).toBeUndefined();
  }, 20_000);

  it("leaves blank cells undefined so the merge never writes a 0 over stored data", async () => {
    const r = await parseRagTemplateFile(fixture(), LINES);
    const wed = r.rows.find((x) => x.entry_date === "2026-08-26" && x.shift === "NIGHT")!;
    expect(wed.plan_qty).toBe(700);
    expect(wed.actual_qty).toBeUndefined();
    expect(wed.downtime_min).toBeUndefined();
  }, 20_000);

  it("spreads the daily UPM over the shifts that ran, and only those", async () => {
    const r = await parseRagTemplateFile(fixture(), LINES);
    const by = new Map(r.rows.map((x) => [`${x.entry_date}|${x.line}|${x.shift}`, x]));
    expect(by.get("2026-08-24|Line 1|DAY")!.upm_target).toBe(60);
    expect(by.get("2026-08-24|Line 1|NIGHT")!.upm_target).toBe(60);
    expect(by.get("2026-08-24|Line 1|DAY")!.upm_actual).toBe(57);

    // Saturday's night shift did not run: no row, so nothing to carry the UPM.
    expect(by.get("2026-08-29|Line 1|DAY")!.upm_actual).toBe(40);
    expect(by.has("2026-08-29|Line 1|NIGHT")).toBe(false);
  }, 20_000);

  it("invents no rows for a day nothing ran", async () => {
    const r = await parseRagTemplateFile(fixture(), LINES);
    expect(r.rows.some((x) => x.entry_date === "2026-08-30")).toBe(false);
  }, 20_000);

  it("files a merged comment against its first day only", async () => {
    const r = await parseRagTemplateFile(fixture(), LINES);
    const mine = r.comments.filter((c) => c.line === "Line 1");
    expect(mine).toHaveLength(1);
    expect(mine[0].entry_date).toBe("2026-08-26");
    expect(mine[0].week_start).toBe("2026-08-24");
    expect(mine[0].comment).toBe("Blender B down all afternoon");
  }, 20_000);

  it("reports a line it does not know instead of importing it", async () => {
    const r = await parseRagTemplateFile(fixture(), LINES);
    expect(r.linesDetected).toEqual(["Line 1"]);
    expect(r.linesIgnored.map((l) => l.name)).toContain("Line 99");
    expect(r.rows.every((x) => x.line === "Line 1")).toBe(true);
  }, 20_000);

  it("skips the instructions sheet and reports the week it read", async () => {
    const r = await parseRagTemplateFile(fixture(), LINES);
    expect(r.sheetsProcessed).toEqual(["WC 240826"]);
    expect(r.datesDetected[0]).toBe("2026-08-24");
    expect(r.datesDetected[r.datesDetected.length - 1]).toBe("2026-08-30");
  }, 20_000);
});

describe("RAG import — cell readers", () => {
  it("reads downtime from every shape the sheets use", () => {
    expect(parseDowntimeMinutes("2:00", "2:00")).toBe(120);
    expect(parseDowntimeMinutes("1:20", "1:20")).toBe(80);
    expect(parseDowntimeMinutes("0:45", "0:45")).toBe(45);
    expect(parseDowntimeMinutes(45, "45")).toBe(45);
    // A time-of-day cell stores a fraction of a day: 2h = 1/12.
    expect(parseDowntimeMinutes(2 / 24, "")).toBe(120);
    expect(parseDowntimeMinutes(null, "")).toBeUndefined();
  });

  it("reads the date formats the two layouts use", () => {
    expect(parseDateCell("24-Aug-26", 2026)).toBe("2026-08-24");
    expect(parseDateCell("Mon 21/07", 2026)).toBe("2026-07-21"); // dd/MM, UK order
    expect(parseDateCell("2026-08-24", 2026)).toBe("2026-08-24");
    expect(parseDateCell(new Date(2026, 7, 24), 2026)).toBe("2026-08-24");
    expect(parseDateCell("Total", 2026)).toBeNull();
  });

  it("recognises the metric labels and refuses the calculated ones", () => {
    expect(metricOf("Plan")).toBe("plan");
    expect(metricOf("Actual")).toBe("actual");
    expect(metricOf("UPM Target")).toBe("upmTarget");
    expect(metricOf("UPM Actual")).toBe("upmActual");
    expect(metricOf("Downtime (hrs)")).toBe("downtime");
    expect(metricOf("Comments")).toBe("comment");
    expect(metricOf("Variance %")).toBeNull();
    expect(metricOf("")).toBeNull();
  });

  it("derives the week and the year the way the sheet names spell them", () => {
    expect(mondayOf("2026-08-26")).toBe("2026-08-24");
    expect(mondayOf("2026-08-30")).toBe("2026-08-24"); // Sunday belongs to the week before
    expect(yearFromSheetName("WC 240826")).toBe(2026);
    expect(yearFromSheetName("Instructions")).toBeNull();
  });

  it("matches line names past punctuation and case", () => {
    expect(cleanLineKey("Capsules & Tablets")).toBe(cleanLineKey("capsules and tablets"));
    expect(cleanLineKey("Line 1")).toBe(cleanLineKey("LINE-1"));
  });

  it("does not mistake a header for a comment", () => {
    expect(isHeaderText("Day", 2026)).toBe(true);
    expect(isHeaderText("Wednesday", 2026)).toBe(true);
    expect(isHeaderText("24-Aug-26", 2026)).toBe(true);
    expect(isHeaderText("Blender B down", 2026)).toBe(false);
  });
});
