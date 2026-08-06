/**
 * How old the iTouching reading is, and whether it can still be called a status.
 *
 * The mapping page prints `last_status` as a red badge with no date beside it, so six
 * machines reading "7" look like six machines stopped right now. They were stopped at
 * 15:49 on 04/08 and nothing has been read since — the poller has not run for two
 * days. A two-day-old reading shown as a status is worse than showing nothing: it is
 * the screen answering a question it cannot answer.
 *
 * The thresholds are about what the number is being used for rather than about the
 * poller's schedule. It runs every minute, so five minutes late is a hiccup; an hour
 * is a fault worth chasing; a day is not a reading at all.
 */
export type Freshness = "live" | "late" | "stale" | "dead" | "never";

export interface FreshnessVerdict {
  state: Freshness;
  /** Minutes since the reading, or null when there has never been one. */
  ageMinutes: number | null;
  /** What to put beside the number, in the words somebody reads at a glance. */
  label: string;
  /** Whether the status may still be presented as the machine's current state. */
  trustworthy: boolean;
}

export function freshnessOf(lastSeenAt: string | null | undefined, now: Date): FreshnessVerdict {
  if (!lastSeenAt) {
    return { state: "never", ageMinutes: null, label: "never read", trustworthy: false };
  }
  const t = Date.parse(lastSeenAt);
  if (Number.isNaN(t)) {
    return { state: "never", ageMinutes: null, label: "never read", trustworthy: false };
  }
  const ageMinutes = Math.max(0, Math.round((now.getTime() - t) / 60000));

  if (ageMinutes <= 5) return { state: "live", ageMinutes, label: "live", trustworthy: true };
  if (ageMinutes <= 60) {
    return { state: "late", ageMinutes, label: `${ageMinutes}m old`, trustworthy: true };
  }
  const hours = Math.round(ageMinutes / 60);
  if (ageMinutes <= 24 * 60) {
    // Still shown, because an hour-old stop is usually still stopped — but no longer
    // presented as the current state without the age beside it.
    return { state: "stale", ageMinutes, label: `${hours}h old`, trustworthy: false };
  }
  const days = Math.round(ageMinutes / (60 * 24));
  return {
    state: "dead",
    ageMinutes,
    label: `${days} day${days === 1 ? "" : "s"} old — poller stopped`,
    trustworthy: false,
  };
}

/**
 * The one line to put at the top of a screen that reads from the poller.
 *
 * Null when everything is current, so a healthy day says nothing at all.
 */
export function pollerBanner(
  rows: { last_seen_at?: string | null }[],
  now: Date,
): string | null {
  const seen = rows.map((r) => r.last_seen_at).filter(Boolean) as string[];
  if (seen.length === 0) return "iTouching has never reported. Nothing on this page is a live reading.";
  // The newest reading is the kindest measure: one dead machine among many is a
  // mapping problem, but the newest going cold means the poller itself has stopped.
  const newest = seen.reduce((a, b) => (Date.parse(a) > Date.parse(b) ? a : b));
  const v = freshnessOf(newest, now);
  if (v.trustworthy) return null;
  return v.state === "dead"
    ? `iTouching last reported ${v.label}. Every status below is from then, not from now.`
    : `iTouching last reported ${v.label}. The statuses below may have moved on.`;
}
