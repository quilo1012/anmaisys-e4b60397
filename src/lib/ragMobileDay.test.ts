import { describe, it, expect } from "vitest";
import { format } from "date-fns";
import { WEEK, defaultMobileDay, stepMobileDay, swipeDirection } from "./ragMobileDay";

const mon = new Date(2026, 9, 19); // Monday 19 Oct 2026
const iso = (d: Date) => format(d, "yyyy-MM-dd");

describe("defaultMobileDay", () => {
  it("opens on today when today is in the week", () => {
    expect(defaultMobileDay(mon, "2026-10-22")).toBe(3);
    expect(defaultMobileDay(mon, "2026-10-25")).toBe(6);
  });
  it("opens on Monday for any other week", () => {
    expect(defaultMobileDay(mon, "2026-10-26")).toBe(0);
  });
});

describe("stepMobileDay", () => {
  it("moves within the week", () => {
    const r = stepMobileDay(mon, 2, 1);
    expect(iso(r.weekStart)).toBe("2026-10-19");
    expect(r.day).toBe(3);
  });
  it("Monday back is the previous Sunday", () => {
    const r = stepMobileDay(mon, 0, -1);
    expect(iso(r.weekStart)).toBe("2026-10-12");
    expect(r.day).toBe(6);
  });
  it("Sunday forward is next Monday", () => {
    const r = stepMobileDay(mon, 6, 1);
    expect(iso(r.weekStart)).toBe("2026-10-26");
    expect(r.day).toBe(0);
  });
  it("from the week view the arrows land on days, not on the total", () => {
    expect(stepMobileDay(mon, WEEK, -1)).toEqual({ weekStart: mon, day: 6 });
    const r = stepMobileDay(mon, WEEK, 1);
    expect(iso(r.weekStart)).toBe("2026-10-26");
    expect(r.day).toBe(0);
  });
});

describe("swipeDirection", () => {
  it("a long horizontal drag turns the day", () => {
    expect(swipeDirection(-90, 10)).toBe(1);
    expect(swipeDirection(90, -10)).toBe(-1);
  });
  it("a tap or a vertical scroll does not", () => {
    expect(swipeDirection(-20, 0)).toBe(0);
    expect(swipeDirection(-80, 120)).toBe(0);
  });
});
