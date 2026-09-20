import { describe, it, expect } from "vitest";
import { shiftTimeToIso, runMinutes, inRunOrder, runTimings, formatRunMinutes } from "@/lib/productionTime";

/** A time on the session of 17/09/2026, as the app stores it. */
const sameDay = (hm: string) => shiftTimeToIso(hm, "2026-09-17", "DAY")!;
/** A time on the NIGHT session of 17/09 — the small hours land on the 18th. */
const nightOf = (hm: string) => shiftTimeToIso(hm, "2026-09-17", "NIGHT")!;

/** What the London wall clock reads at that instant — what the operator typed. */
const wall = (iso: string | null) =>
  iso == null ? null : new Intl.DateTimeFormat("en-GB", {
    timeZone: "Europe/London", hour12: false,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit",
  }).format(new Date(iso));

describe("shiftTimeToIso", () => {
  it("keeps a day-shift time on the session's own day", () => {
    expect(wall(shiftTimeToIso("07:10", "2026-08-06", "DAY"))).toBe("06/08/2026, 07:10");
    expect(wall(shiftTimeToIso("17:50", "2026-08-06", "DAY"))).toBe("06/08/2026, 17:50");
  });

  it("puts the evening of a night shift on the session's day", () => {
    expect(wall(shiftTimeToIso("17:20", "2026-08-06", "NIGHT"))).toBe("06/08/2026, 17:20");
    expect(wall(shiftTimeToIso("23:10", "2026-08-06", "NIGHT"))).toBe("06/08/2026, 23:10");
  });

  it("puts the small hours of a night shift on the morning after", () => {
    expect(wall(shiftTimeToIso("01:40", "2026-08-06", "NIGHT"))).toBe("07/08/2026, 01:40");
    expect(wall(shiftTimeToIso("05:45", "2026-08-06", "NIGHT"))).toBe("07/08/2026, 05:45");
  });

  it("fixes the record that started this — R26216 on Line 1", () => {
    // Stored as 07/08 17:20 → 06/08 23:10, a duration of minus eighteen hours, because
    // the start was saved after midnight and took that day's date.
    const start = shiftTimeToIso("17:20", "2026-08-06", "NIGHT");
    const finish = shiftTimeToIso("23:10", "2026-08-06", "NIGHT");
    expect(runMinutes(start, finish)).toBe(350);
  });

  it("does not depend on when the form was submitted", () => {
    // The whole bug: `new Date()` meant the answer changed with the clock.
    const a = shiftTimeToIso("20:50", "2026-08-06", "NIGHT");
    const b = shiftTimeToIso("20:50", "2026-08-06", "NIGHT");
    expect(a).toBe(b);
    expect(wall(a)).toBe("06/08/2026, 20:50");
  });

  it("holds the wall clock across the British Summer Time boundary", () => {
    // London is UTC+1 in August and UTC in December. A naive build shifts by an hour.
    expect(wall(shiftTimeToIso("09:00", "2026-12-15", "DAY"))).toBe("15/12/2026, 09:00");
    expect(wall(shiftTimeToIso("09:00", "2026-08-15", "DAY"))).toBe("15/08/2026, 09:00");
  });

  it("returns null rather than a guess for anything unparseable", () => {
    for (const bad of ["", "  ", "abc", "25:00", "12:60", null, undefined]) {
      expect(shiftTimeToIso(bad as any, "2026-08-06", "NIGHT")).toBeNull();
    }
    expect(shiftTimeToIso("09:00", "not-a-date", "DAY")).toBeNull();
  });
});

describe("runMinutes", () => {
  it("measures a run that crosses midnight", () => {
    const start = shiftTimeToIso("23:30", "2026-08-06", "NIGHT");
    const finish = shiftTimeToIso("00:30", "2026-08-06", "NIGHT");
    expect(runMinutes(start, finish)).toBe(60);
  });

  it("refuses a negative duration instead of passing it on", () => {
    // Twenty-three records hold one. A negative that survives gets averaged into a
    // line's speed, where it quietly cancels out real minutes.
    expect(runMinutes("2026-08-07T17:20:00Z", "2026-08-06T23:10:00Z")).toBeNull();
  });

  it("is null when either end is missing", () => {
    expect(runMinutes(null, "2026-08-06T23:10:00Z")).toBeNull();
    expect(runMinutes("2026-08-06T17:20:00Z", null)).toBeNull();
  });
});

describe("runMinutes refuses a pair that cannot describe a run", () => {
  it("refuses zero, which is not a short run", () => {
    // Nine records hold a start and a finish on the same minute — five on 27/07 alone,
    // at 09:59, 10:01, 10:02, 11:09 and 16:40. Saving stamped the finish with the clock
    // while the operator had typed the clock into the start.
    const t = "2026-08-06T09:59:00Z";
    expect(runMinutes(t, t)).toBeNull();
  });

  it("refuses a run longer than the shift it belongs to", () => {
    // An item belongs to a session and a session is one shift. K26217 claims 1050
    // minutes on Line 3; averaged in, it makes the line look half as fast as it is.
    const start = "2026-08-07T02:20:00Z";
    expect(runMinutes(start, "2026-08-07T19:50:00Z")).toBeNull();   // 1050 min
    expect(runMinutes(start, "2026-08-07T14:20:00Z")).toBe(720);    // exactly 12 h
    expect(runMinutes(start, "2026-08-07T14:21:00Z")).toBeNull();   // a minute over
  });

  it("still measures an ordinary run", () => {
    expect(runMinutes("2026-08-06T06:00:00Z", "2026-08-06T10:05:00Z")).toBe(245);
  });
});

describe("inRunOrder puts a shift's runs in the order they happened", () => {
  // The order the API happens to return them in: no `order` on the embedded
  // resource, so Postgres gives back whatever the heap holds that minute.
  const asFetched = [
    { id: "c", started_at: sameDay("14:45"), finished_at: sameDay("16:45"), display_order: 2, created_at: "2026-09-17T09:00:00Z" },
    { id: "a", started_at: sameDay("06:20"), finished_at: sameDay("07:07"), display_order: 0, created_at: "2026-09-17T06:00:00Z" },
    { id: "b", started_at: sameDay("07:50"), finished_at: sameDay("14:25"), display_order: 1, created_at: "2026-09-17T07:00:00Z" },
  ];

  it("reads the Tablet Line of 17/09 down the clock", () => {
    // What the screen showed: 14:45, then 06:20, then 07:50.
    expect(inRunOrder(asFetched, "DAY").map((i) => i.id)).toEqual(["a", "b", "c"]);
  });

  it("does not disturb the array it was handed", () => {
    const before = asFetched.map((i) => i.id);
    inRunOrder(asFetched, "DAY");
    expect(asFetched.map((i) => i.id)).toEqual(before);
  });

  it("keeps the small hours of a night at the END of that night", () => {
    // 01:20 is not the first run of the night, it is the last: the shift starts at
    // 18:00 and the clock rolls over inside it. Sorting on the number alone would
    // open the shift with the small hours.
    const night = [
      { id: "small-hours", started_at: nightOf("01:20"), finished_at: nightOf("03:35"), display_order: 2, created_at: "2026-09-17T23:00:00Z" },
      { id: "evening", started_at: sameDay("18:40"), finished_at: sameDay("22:05"), display_order: 0, created_at: "2026-09-17T18:00:00Z" },
      { id: "late", started_at: sameDay("22:10"), finished_at: nightOf("00:50"), display_order: 1, created_at: "2026-09-17T22:00:00Z" },
    ];
    expect(inRunOrder(night, "NIGHT").map((i) => i.id)).toEqual(["evening", "late", "small-hours"]);
  });

  it("sorts by the time the row shows, not by the day it was stamped with", () => {
    // The twenty-three records with a start saved after midnight and stamped with
    // that day: the cell reads 17:20, the column reads a day later. The sheet has to
    // read the way its own numbers read, so the clock decides, not the date.
    const stampedADayLate = [
      { id: "wrong-day", started_at: "2026-09-18T17:20:00Z", finished_at: null, display_order: 1, created_at: "2026-09-17T23:30:00Z" },
      { id: "right-day", started_at: "2026-09-17T19:10:00Z", finished_at: null, display_order: 0, created_at: "2026-09-17T19:00:00Z" },
    ];
    expect(inRunOrder(stampedADayLate, "NIGHT").map((i) => i.id)).toEqual(["wrong-day", "right-day"]);
  });

  it("sends a run with no start to the end, in the order the line planned it", () => {
    // A row nobody has timed yet has no place in a chronology. It keeps the sequence
    // the line gave it (display_order), so the sheet still shows the planned run.
    const half = [
      { id: "untimed-second", started_at: null, finished_at: null, display_order: 5, created_at: "2026-09-17T08:00:00Z" },
      { id: "timed", started_at: sameDay("09:00"), finished_at: sameDay("11:00"), display_order: 9, created_at: "2026-09-17T09:00:00Z" },
      { id: "untimed-first", started_at: null, finished_at: null, display_order: 3, created_at: "2026-09-17T10:00:00Z" },
    ];
    expect(inRunOrder(half, "DAY").map((i) => i.id)).toEqual(["timed", "untimed-first", "untimed-second"]);
  });

  it("breaks a tie on the finish, then on the plan", () => {
    const tied = [
      { id: "longer", started_at: sameDay("09:00"), finished_at: sameDay("12:00"), display_order: 4, created_at: "2026-09-17T09:00:00Z" },
      { id: "shorter", started_at: sameDay("09:00"), finished_at: sameDay("10:00"), display_order: 7, created_at: "2026-09-17T09:00:00Z" },
      { id: "no-finish", started_at: sameDay("09:00"), finished_at: null, display_order: 1, created_at: "2026-09-17T09:00:00Z" },
    ];
    expect(inRunOrder(tied, "DAY").map((i) => i.id)).toEqual(["shorter", "longer", "no-finish"]);
  });
});

describe("runTimings measures the shift, run by run and gap by gap", () => {
  const item = (start: string | null, finish: string | null, shift: "DAY" | "NIGHT" = "DAY") => ({
    started_at: start === null ? null : (shift === "DAY" ? sameDay(start) : nightOf(start)),
    finished_at: finish === null ? null : (shift === "DAY" ? sameDay(finish) : nightOf(finish)),
  });

  it("gives each run its length and each gap its changeover", () => {
    // A Tablet Line de 17/09, já pela ordem do relógio.
    const t = runTimings([
      item("06:20", "07:07"),
      item("07:50", "14:25"),
      item("14:45", "16:45"),
    ], "DAY");
    expect(t.map((x) => x.runMin)).toEqual([47, 395, 120]);
    expect(t.map((x) => x.sinceMin)).toEqual([null, 43, 20]);
  });

  it("measures a changeover that crosses midnight", () => {
    // 22:10 → 01:20 são 190 minutos, não menos vinte horas e cinquenta.
    const t = runTimings([
      item("22:10", "23:40", "NIGHT"),
      item("01:20", "03:35", "NIGHT"),
    ], "NIGHT");
    expect(t[1].sinceMin).toBe(100);
    expect(t[1].runMin).toBe(135);
  });

  it("calls an overlap by its negative, because it is not a changeover", () => {
    // Duas corridas ao mesmo tempo na mesma linha: ou uma hora está errada, ou o
    // turno correu duas coisas de uma vez. As duas merecem ser vistas.
    const t = runTimings([item("06:00", "10:00"), item("09:35", "12:00")], "DAY");
    expect(t[1].sinceMin).toBe(-25);
  });

  it("mede desde o último fim registado, e não desde uma fila sem fim", () => {
    // A corrida do meio ficou por fechar. A seguinte não deixa de ter um intervalo
    // por causa disso: conta-se desde a última que fechou, que é o que se sabe.
    const t = runTimings([
      item("06:00", "08:00"),
      item("08:30", null),
      item("10:00", "11:00"),
    ], "DAY");
    expect(t.map((x) => x.sinceMin)).toEqual([null, 30, 120]);
    expect(t[1].runMin).toBeNull();
  });

  it("não inventa um intervalo quando não há hora", () => {
    const t = runTimings([item("06:00", "08:00"), item(null, null)], "DAY");
    expect(t[1].sinceMin).toBeNull();
    expect(t[1].runMin).toBeNull();
  });

  it("herda as três recusas do runMinutes", () => {
    // Zero não é uma corrida curta, e dezassete horas não são uma corrida lenta.
    const t = runTimings([item("09:59", "09:59"), item("10:30", null)], "DAY");
    expect(t[0].runMin).toBeNull();
    expect(t[1].runMin).toBeNull();
  });
});

describe("formatRunMinutes", () => {
  it("writes an hour as an hour", () => {
    expect(formatRunMinutes(47)).toBe("47m");
    expect(formatRunMinutes(60)).toBe("1h00");
    expect(formatRunMinutes(395)).toBe("6h35");
    expect(formatRunMinutes(0)).toBe("0m");
  });

  it("has nothing to write when there is no number", () => {
    expect(formatRunMinutes(null)).toBe("—");
  });
});
