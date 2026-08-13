import { describe, it, expect } from "vitest";
import { lineDowntimeSecFromStops } from "@/lib/downtimeExclusions";

const t = (s: string) => `2026-08-13T${s}.000Z`;

describe("lineDowntimeSecFromStops", () => {
  it("counts two overlapping stops once (WO-824)", () => {
    const sec = lineDowntimeSecFromStops(
      [
        { stopped_at: "2026-08-13T06:47:00Z", resumed_at: "2026-08-13T07:35:00Z" },
        { stopped_at: "2026-08-13T06:47:12Z", resumed_at: "2026-08-13T11:34:30Z" },
      ],
      [],
      null,
    );
    // 06:47:00 -> 11:34:30 = 287.5 min
    expect(sec).toBe(287 * 60 + 30);
  });

  it("counts two separate stops twice", () => {
    const sec = lineDowntimeSecFromStops(
      [
        { stopped_at: t("06:00:00"), resumed_at: t("06:10:00") },
        { stopped_at: t("07:00:00"), resumed_at: t("07:05:00") },
      ],
      [],
      null,
    );
    expect(sec).toBe(15 * 60);
  });

  it("subtracts an exclusion spanning both merged stops once", () => {
    const sec = lineDowntimeSecFromStops(
      [
        { stopped_at: t("06:00:00"), resumed_at: t("06:30:00") },
        { stopped_at: t("06:10:00"), resumed_at: t("06:40:00") },
      ],
      [{ started_at: t("06:05:00"), ended_at: t("06:15:00") }],
      null,
    );
    // merged 06:00-06:40 = 40 min, minus 10 min exclusion
    expect(sec).toBe(30 * 60);
  });

  it("ignores a reversed/corrupt interval (WO-498)", () => {
    const sec = lineDowntimeSecFromStops(
      [
        { stopped_at: t("08:00:00"), resumed_at: t("07:00:00") },
        { stopped_at: t("09:00:00"), resumed_at: t("09:09:00") },
      ],
      [],
      null,
    );
    expect(sec).toBe(9 * 60);
  });

  it("returns the fallback when there is no usable interval", () => {
    expect(lineDowntimeSecFromStops([], [], 123)).toBe(123);
    expect(
      lineDowntimeSecFromStops([{ stopped_at: t("08:00:00"), resumed_at: t("07:00:00") }], [], null),
    ).toBeNull();
  });
});
