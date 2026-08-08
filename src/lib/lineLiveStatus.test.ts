import { describe, it, expect } from "vitest";
import { classifyLive, STALE_AFTER_SECONDS, type LiveReading } from "./lineLiveStatus";

const now = new Date("2026-08-08T17:00:00.000Z");
const secondsAgo = (s: number) => new Date(now.getTime() - s * 1000);

const reading = (over: Partial<LiveReading> = {}): LiveReading => ({
  status: 4,
  reason: null,
  planned: null,
  seenAt: secondsAgo(20),
  ...over,
});

describe("classifyLive", () => {
  it("reads no stop code as running", () => {
    const r = classifyLive(reading(), now);
    expect(r.state).toBe("RUNNING");
    expect(r.label).toBe("Running");
    expect(r.ageSeconds).toBe(20);
  });

  it("names a planned stop and keeps it quiet", () => {
    // Line 6 today: Deep Clean, planned in the catalogue.
    const r = classifyLive(reading({ status: 7, reason: "Deep Clean", planned: true }), now);
    expect(r.state).toBe("PLANNED_STOP");
    expect(r.label).toBe("Deep Clean");
  });

  it("names an unplanned stop", () => {
    const r = classifyLive(reading({ status: 7, reason: "Mechanical Stop", planned: false }), now);
    expect(r.state).toBe("UNPLANNED_STOP");
    expect(r.label).toBe("Mechanical Stop");
  });

  it("still shows a code the catalogue does not know, and flags it", () => {
    // "Electrical Stop" is one of 7 mapped labels with no catalogue row. Losing
    // the label would leave the card blank on exactly the stop that matters most.
    const r = classifyLive(reading({ status: 7, reason: "Electrical Stop", planned: null }), now);
    expect(r.label).toBe("Electrical Stop");
    expect(r.uncatalogued).toBe(true);
    expect(r.state).toBe("UNPLANNED_STOP");
  });

  it("does not treat a known planned code as uncatalogued", () => {
    const r = classifyLive(reading({ reason: "Breaks", planned: true }), now);
    expect(r.uncatalogued).toBe(false);
  });

  it("treats blank and whitespace reasons as no stop at all", () => {
    expect(classifyLive(reading({ reason: "" }), now).state).toBe("RUNNING");
    expect(classifyLive(reading({ reason: "   " }), now).state).toBe("RUNNING");
  });
});

describe("classifyLive — freshness", () => {
  it("goes to no signal past the threshold", () => {
    const r = classifyLive(reading({ seenAt: secondsAgo(STALE_AFTER_SECONDS + 1) }), now);
    expect(r.state).toBe("NO_SIGNAL");
  });

  it("stays live right up to the threshold", () => {
    const r = classifyLive(reading({ seenAt: secondsAgo(STALE_AFTER_SECONDS) }), now);
    expect(r.state).toBe("RUNNING");
  });

  it("keeps the last known reason when the signal drops", () => {
    const r = classifyLive(
      reading({ status: 7, reason: "Electrical Stop", planned: null, seenAt: secondsAgo(600) }),
      now,
    );
    expect(r.state).toBe("NO_SIGNAL");
    expect(r.label).toContain("Electrical Stop");
    expect(r.ageSeconds).toBe(600);
  });

  it("a machine that was never read is no signal, not running", () => {
    const r = classifyLive(reading({ seenAt: null }), now);
    expect(r.state).toBe("NO_SIGNAL");
    expect(r.ageSeconds).toBeNull();
  });

  it("never reports a negative age if a clock skews", () => {
    const r = classifyLive(reading({ seenAt: new Date(now.getTime() + 5000) }), now);
    expect(r.ageSeconds).toBe(0);
  });
});

describe("classifyLive — nothing to read", () => {
  it("says so when the line has no mapped machine", () => {
    expect(classifyLive(null, now).state).toBe("NOT_MAPPED");
    expect(classifyLive(undefined, now).state).toBe("NOT_MAPPED");
  });

  it("carries the raw status through without interpreting it", () => {
    // 4, 6 and 7 are the values this installation actually returns, and their
    // meaning is an open question with the vendor. Nothing here depends on them.
    for (const status of [4, 6, 7]) {
      const r = classifyLive(reading({ status }), now);
      expect(r.rawStatus).toBe(status);
      expect(r.state).toBe("RUNNING");
    }
  });
});
