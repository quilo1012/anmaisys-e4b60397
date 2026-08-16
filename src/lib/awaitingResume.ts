import type { KpiAccent } from "@/components/reports/KpiCard";

/**
 * How to label the count of maintenance orders holding a line down.
 *
 * WHAT THIS NUMBER IS. `useStoppedLinesCount` counts work orders with
 * `line_stopped = true` and no `line_resumed_at`. Its own docstring says so plainly.
 * It answers: an engineer was called out, and nobody has resumed the line.
 *
 * WHAT IT IS NOT. It does not know which machines are moving. That fact comes from
 * iTouching through `classifyLive` and `v_line_live_status`, and the two are not the
 * same fact at the same minutes — `lineStatusPanel.ts` says it in as many words, and
 * keeps this count deliberately, "beside the state as its own count".
 *
 * WHY THE LABEL CHANGED. It used to read "Lines stopped", with "All lines running"
 * underneath whenever the number was zero, in green, on every screen in the app. On
 * 13/08 at 09:27 UTC that produced ten green lines while six machines stood still on
 * the vendor's panel one desk away — the GEL Line since 17:06 the previous day. None
 * of them had a work order, because none of them was a breakdown, and a table of
 * callouts has no way to know that a line nobody phoned about is not therefore
 * running.
 *
 * The panel was moved onto iTouching then. This label was not, and went on making
 * the factory-wide claim from a table that cannot support it. So it now says what it
 * counts and nothing else, and zero is grey rather than green: no callout is waiting
 * is not the same sentence as everything is fine.
 */
export function awaitingResumeSummary(count: number): {
  label: string;
  sublabel: string;
  ariaLabel: string;
  accent: KpiAccent;
} {
  const orders = count === 1 ? "1 maintenance order" : `${count} maintenance orders`;
  return {
    label: "Awaiting line resume",
    sublabel:
      count > 0
        ? "Called out, line not resumed"
        : "No callout waiting on a resume · line status is on the board",
    ariaLabel:
      count > 0
        ? `${orders} awaiting a line resume`
        : "No maintenance order is awaiting a line resume",
    accent: count > 0 ? "warning" : "muted",
  };
}
