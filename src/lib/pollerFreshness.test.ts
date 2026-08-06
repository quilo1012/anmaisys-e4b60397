import { describe, it, expect } from "vitest";
import { freshnessOf, pollerBanner } from "@/lib/pollerFreshness";

const NOW = new Date("2026-08-06T19:47:00Z");
const ago = (minutes: number) => new Date(NOW.getTime() - minutes * 60000).toISOString();

describe("freshnessOf", () => {
  it("calls a reading from the last few minutes live", () => {
    expect(freshnessOf(ago(0), NOW).state).toBe("live");
    expect(freshnessOf(ago(5), NOW).state).toBe("live");
    expect(freshnessOf(ago(5), NOW).trustworthy).toBe(true);
  });

  it("still trusts an hour-old reading, but says how old", () => {
    // An hour-old stop is usually still stopped. It just stops being presented as
    // the current state without the age beside it.
    const v = freshnessOf(ago(45), NOW);
    expect(v.state).toBe("late");
    expect(v.trustworthy).toBe(true);
    expect(v.label).toBe("45m old");
  });

  it("stops trusting a reading older than an hour", () => {
    expect(freshnessOf(ago(3 * 60), NOW).trustworthy).toBe(false);
    expect(freshnessOf(ago(3 * 60), NOW).label).toBe("3h old");
  });

  it("names the real case: two days, poller stopped", () => {
    // Six machines read "7" on the mapping page as though they were stopped now.
    // They were stopped at 15:49 on 04/08 and nothing has been read since.
    const v = freshnessOf("2026-08-04T15:49:00Z", NOW);
    expect(v.state).toBe("dead");
    expect(v.trustworthy).toBe(false);
    expect(v.label).toContain("2 days old");
    expect(v.label).toContain("poller stopped");
  });

  it("treats never-read and unreadable the same, and neither as zero", () => {
    for (const bad of [null, undefined, "", "not a date"]) {
      const v = freshnessOf(bad as any, NOW);
      expect(v.state).toBe("never");
      expect(v.ageMinutes).toBeNull();
      expect(v.trustworthy).toBe(false);
    }
  });

  it("never reports a negative age when a clock runs ahead", () => {
    expect(freshnessOf(ago(-30), NOW).ageMinutes).toBe(0);
  });
});

describe("pollerBanner", () => {
  it("says nothing on a healthy day", () => {
    expect(pollerBanner([{ last_seen_at: ago(2) }, { last_seen_at: ago(4) }], NOW)).toBeNull();
  });

  it("judges by the newest reading, not the oldest", () => {
    // One machine gone quiet is a mapping problem. The newest going cold is the
    // poller itself having stopped, which is a different thing to say.
    expect(pollerBanner([{ last_seen_at: ago(3) }, { last_seen_at: ago(9000) }], NOW)).toBeNull();
  });

  it("says the statuses are from then and not from now", () => {
    const msg = pollerBanner([{ last_seen_at: "2026-08-04T15:49:00Z" }], NOW);
    expect(msg).toContain("not from now");
  });

  it("has something to say when nothing was ever reported", () => {
    expect(pollerBanner([{ last_seen_at: null }], NOW)).toContain("never reported");
    expect(pollerBanner([], NOW)).toContain("never reported");
  });
});
