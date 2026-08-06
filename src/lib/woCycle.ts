/**
 * The three times on a maintenance order, and which one "Total" means.
 *
 * WO-2026-000511 reads Response 4m, Execution 51m, Total 362h 56m. The repair took
 * fifty-five minutes; the order was signed off fifteen days later. The card says
 * "opened → finished" and shows `closed_at - created_at`, which is a different
 * question with a different answer, and the answer it gives is the one that makes a
 * one-hour repair look like a fortnight.
 *
 * Both figures are worth having. A repair that took an hour and sat two weeks waiting
 * for a signature is a real problem — it is just not a maintenance problem, and
 * printing it under "Total Time" beside the repair times buries it as arithmetic
 * nobody can reconcile.
 */
export interface WoTimes {
  created_at: string;
  finished_at?: string | null;
  completed_at?: string | null;
  closed_at?: string | null;
  status?: string | null;
}

export interface CycleTotal {
  /** Minutes, or null when the order is still running. */
  minutes: number | null;
  /** What the figure is, in the words printed under the heading. */
  label: string;
  /** Minutes between the repair finishing and somebody signing it off. */
  signOffWaitMinutes: number | null;
}

const minutesBetween = (from: string, to: string): number | null => {
  const a = Date.parse(from), b = Date.parse(to);
  if (Number.isNaN(a) || Number.isNaN(b)) return null;
  return Math.round((b - a) / 60000);
};

export function cycleTotal(wo: WoTimes): CycleTotal {
  const finished = wo.finished_at || wo.completed_at || null;
  const closed = wo.closed_at || null;

  // Force-closed orders were never finished; the figure is how long one sat there
  // before a manager gave up on it, and calling that "finished" flatters it.
  if (wo.status === "force_closed") {
    return {
      minutes: closed ? minutesBetween(wo.created_at, closed) : null,
      label: "opened → force closed",
      signOffWaitMinutes: null,
    };
  }

  if (finished) {
    return {
      minutes: minutesBetween(wo.created_at, finished),
      label: "opened → finished",
      // Only worth naming once it is more than an hour: minutes between finishing a
      // job and pressing the button are how the job actually ends.
      signOffWaitMinutes: closed
        ? (() => { const w = minutesBetween(finished, closed); return w != null && w > 60 ? w : null; })()
        : null,
    };
  }

  if (closed) {
    // Closed without ever being finished. Says so rather than borrowing the word.
    return {
      minutes: minutesBetween(wo.created_at, closed),
      label: "opened → closed",
      signOffWaitMinutes: null,
    };
  }

  return { minutes: null, label: "opened → finished", signOffWaitMinutes: null };
}
