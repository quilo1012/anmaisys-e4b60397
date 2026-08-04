import { describe, it, expect } from "vitest";

/**
 * How the Production Impact card counts a stoppage.
 *
 * Mirrors the rule in WorkOrderDetail. The trap it guards: `wo_auto_insert_downtime_event`
 * writes a downtime event FROM the order's own `line_stopped_at`, so the two describe
 * one stoppage, not two. Adding them made WO-804 read "2 stoppages · 23m" while the
 * stop history directly below it read "1 stop · 11m" — the same eleven minutes,
 * counted twice, on the same screen.
 */
interface Ev { stopped_at: string; resumed_at: string | null }

function impact(wo: { line_stopped_at: string | null; line_resumed_at: string | null }, events: Ev[], now: Date) {
  const secs = (from: string, to: string | null) =>
    Math.max(0, Math.round(((to ? new Date(to) : now).getTime() - new Date(from).getTime()) / 1000));
  const useEvents = events.length > 0;
  const stopCount = useEvents ? events.length : (wo.line_stopped_at ? 1 : 0);
  const seconds = useEvents
    ? events.reduce((a, e) => a + secs(e.stopped_at, e.resumed_at), 0)
    : (wo.line_stopped_at ? secs(wo.line_stopped_at, wo.line_resumed_at) : 0);
  return { stopCount, minutes: Math.round(seconds / 60) };
}

const NOW = new Date("2026-08-04T16:00:00Z"); // 17:00 London

describe("production impact", () => {
  it("counts one stoppage when the order and its event are the same stop", () => {
    // WO-804 exactly: stopped 16:48:02 London, one open event from the same moment.
    const r = impact(
      { line_stopped_at: "2026-08-04T15:48:02Z", line_resumed_at: null },
      [{ stopped_at: "2026-08-04T15:48:02Z", resumed_at: null }],
      NOW,
    );
    expect(r.stopCount).toBe(1);
    expect(r.minutes).toBe(12);
  });

  it("counts a second stoppage that is genuinely a second one", () => {
    const r = impact(
      { line_stopped_at: "2026-08-04T14:00:00Z", line_resumed_at: "2026-08-04T14:30:00Z" },
      [
        { stopped_at: "2026-08-04T14:00:00Z", resumed_at: "2026-08-04T14:30:00Z" },
        { stopped_at: "2026-08-04T15:00:00Z", resumed_at: "2026-08-04T15:10:00Z" },
      ],
      NOW,
    );
    expect(r.stopCount).toBe(2);
    expect(r.minutes).toBe(40);
  });

  it("does not count the running minutes between two stops", () => {
    // The half hour the line was working between 14:30 and 15:00 is not downtime.
    const r = impact(
      { line_stopped_at: "2026-08-04T14:00:00Z", line_resumed_at: "2026-08-04T15:10:00Z" },
      [
        { stopped_at: "2026-08-04T14:00:00Z", resumed_at: "2026-08-04T14:30:00Z" },
        { stopped_at: "2026-08-04T15:00:00Z", resumed_at: "2026-08-04T15:10:00Z" },
      ],
      NOW,
    );
    expect(r.minutes).toBe(40);
    expect(r.minutes).not.toBe(70);
  });

  it("falls back to the order's own timestamps when it has no event", () => {
    // Orders old enough to predate the trigger still have to report something.
    const r = impact(
      { line_stopped_at: "2026-08-04T15:00:00Z", line_resumed_at: "2026-08-04T15:45:00Z" },
      [],
      NOW,
    );
    expect(r.stopCount).toBe(1);
    expect(r.minutes).toBe(45);
  });

  it("reports nothing for an order that never stopped the line", () => {
    expect(impact({ line_stopped_at: null, line_resumed_at: null }, [], NOW))
      .toEqual({ stopCount: 0, minutes: 0 });
  });
});
