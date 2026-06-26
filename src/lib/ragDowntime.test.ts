import { describe, it, expect } from "vitest";
import {
  mapWoToStop,
  shiftMinutesForLine,
  TERMINAL_WO_STATUSES,
} from "@/lib/ragDowntime";

// London BST window for 2025-06-25 DAY shift (06:00-18:00 local = 05:00-17:00 UTC)
const DAY_START = Date.parse("2025-06-25T05:00:00Z");
const DAY_END = Date.parse("2025-06-25T17:00:00Z");
const NIGHT_START = DAY_END;
const NIGHT_END = Date.parse("2025-06-26T05:00:00Z");

/** Work Orders list duration: line_stopped_at → line_resumed_at (clamped to now). */
function woListMinutes(r: {
  line_stopped_at?: string | null;
  line_resumed_at?: string | null;
  status?: string | null;
  finished_at?: string | null;
  closed_at?: string | null;
}, nowMs: number) {
  if (!r.line_stopped_at) return 0;
  const isTerminal = TERMINAL_WO_STATUSES.has(String(r.status ?? "").toLowerCase());
  const endIso =
    r.line_resumed_at ??
    r.finished_at ??
    r.closed_at ??
    (isTerminal ? r.line_stopped_at : null);
  const end = endIso ? Date.parse(endIso) : nowMs;
  return Math.max(0, Math.round((end - Date.parse(r.line_stopped_at)) / 60_000));
}

describe("RAG Weekly downtime mapping", () => {
  it("ignores WOs without line_stopped_at", () => {
    expect(mapWoToStop({ status: "open", line_at_time: "Line 4" })).toBeNull();
    expect(
      shiftMinutesForLine(
        [{ status: "open", line_at_time: "Line 4", line_resumed_at: "2025-06-25T10:00:00Z" }],
        "Line 4",
        DAY_START,
        DAY_END,
      ),
    ).toBe(0);
  });

  it("uses finished_at as fallback when line_resumed_at is null", () => {
    const stop = mapWoToStop({
      status: "finished",
      line_at_time: "Line 4",
      line_stopped_at: "2025-06-25T08:00:00Z",
      finished_at: "2025-06-25T08:30:00Z",
    });
    expect(stop?.end).toBe("2025-06-25T08:30:00Z");
  });

  it("uses closed_at when both resume and finish are null", () => {
    const stop = mapWoToStop({
      status: "closed",
      line_at_time: "Line 4",
      line_stopped_at: "2025-06-25T08:00:00Z",
      closed_at: "2025-06-25T09:00:00Z",
    });
    expect(stop?.end).toBe("2025-06-25T09:00:00Z");
  });

  it("terminal WO with no end timestamps collapses to zero (not ongoing)", () => {
    const stop = mapWoToStop({
      status: "force_closed",
      line_at_time: "Line 4",
      line_stopped_at: "2025-06-25T08:00:00Z",
    });
    expect(stop?.end).toBe("2025-06-25T08:00:00Z");
    expect(
      shiftMinutesForLine(
        [
          {
            status: "force_closed",
            line_at_time: "Line 4",
            line_stopped_at: "2025-06-25T08:00:00Z",
          },
        ],
        "Line 4",
        DAY_START,
        DAY_END,
      ),
    ).toBe(0);
  });

  it("non-terminal WO without resume stays ongoing (end=null)", () => {
    const stop = mapWoToStop({
      status: "in_progress",
      line_at_time: "Line 4",
      line_stopped_at: "2025-06-25T08:00:00Z",
    });
    expect(stop?.end).toBeNull();
  });

  it("RAG Weekly total matches sum of Work Orders durations when stops do not overlap", () => {
    const rows = [
      { // 9 min
        status: "finished",
        line_at_time: "Line 4",
        line_stopped_at: "2025-06-25T09:00:00Z",
        line_resumed_at: "2025-06-25T09:09:00Z",
      },
      { // 27 min
        status: "finished",
        line_at_time: "Line 4",
        line_stopped_at: "2025-06-25T11:00:00Z",
        line_resumed_at: "2025-06-25T11:27:00Z",
      },
      { // 21 min, end via finished_at fallback
        status: "finished",
        line_at_time: "Line 4",
        line_stopped_at: "2025-06-25T13:00:00Z",
        finished_at: "2025-06-25T13:21:00Z",
      },
    ];
    const now = Date.parse("2025-06-26T12:00:00Z");
    const ragTotal = shiftMinutesForLine(rows, "Line 4", DAY_START, DAY_END, now);
    const woTotal = rows.reduce((a, r) => a + woListMinutes(r, now), 0);
    expect(ragTotal).toBe(woTotal);
    expect(ragTotal).toBe(57);
  });

  it("overlapping stops are unioned (RAG total <= naive sum, prevents double counting)", () => {
    const rows = [
      {
        status: "finished",
        line_at_time: "Line 4",
        line_stopped_at: "2025-06-25T09:00:00Z",
        line_resumed_at: "2025-06-25T09:30:00Z",
      },
      {
        status: "finished",
        line_at_time: "Line 4",
        line_stopped_at: "2025-06-25T09:15:00Z",
        line_resumed_at: "2025-06-25T09:45:00Z",
      },
    ];
    const now = Date.parse("2025-06-26T00:00:00Z");
    const ragTotal = shiftMinutesForLine(rows, "Line 4", DAY_START, DAY_END, now);
    const naive = rows.reduce((a, r) => a + woListMinutes(r, now), 0);
    expect(ragTotal).toBe(45); // union 09:00 → 09:45
    expect(ragTotal).toBeLessThan(naive); // naive would double count 15 min
  });

  it("clamps stops crossing shift boundaries", () => {
    const rows = [
      { // 17:30 → 18:30 UTC = 30 min in DAY, 30 min in NIGHT
        status: "finished",
        line_at_time: "Line 4",
        line_stopped_at: "2025-06-25T16:30:00Z",
        line_resumed_at: "2025-06-25T17:30:00Z",
      },
    ];
    const now = Date.parse("2025-06-26T00:00:00Z");
    const day = shiftMinutesForLine(rows, "Line 4", DAY_START, DAY_END, now);
    const night = shiftMinutesForLine(rows, "Line 4", NIGHT_START, NIGHT_END, now);
    expect(day).toBe(30);
    expect(night).toBe(30);
  });

  it("filters by line — other lines do not bleed in", () => {
    const rows = [
      {
        status: "finished",
        line_at_time: "Line 1",
        line_stopped_at: "2025-06-25T09:00:00Z",
        line_resumed_at: "2025-06-25T10:00:00Z",
      },
    ];
    expect(shiftMinutesForLine(rows, "Line 4", DAY_START, DAY_END)).toBe(0);
    expect(shiftMinutesForLine(rows, "Line 1", DAY_START, DAY_END)).toBe(60);
  });
});
