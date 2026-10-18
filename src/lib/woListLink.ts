import type { DateRangePreset } from "@/components/DateRangeFilter";

/**
 * Links into the Maintenance Orders list, opened on what the link counted.
 *
 * The list reads three params: `status` (a single status, `active` for everything not
 * finished, or `stale`), `range` (a date preset) and `type` (`corrective` or
 * `preventive`). It used to read only `status` and open on today, so a dashboard card
 * saying "6 in progress" opened onto the one created today.
 */
export type WoListStatus =
  | "active" | "open" | "received" | "arrived" | "in_progress" | "finished" | "closed" | "force_closed" | "stale";

/** The presets a link may name. Custom needs dates, so a link cannot ask for it. */
const LINKABLE_RANGES: readonly DateRangePreset[] = ["today", "yesterday", "shift", "7d", "30d", "90d", "month", "all"];

export function readLinkedRange(raw: string | null): DateRangePreset | null {
  return LINKABLE_RANGES.includes(raw as DateRangePreset) ? (raw as DateRangePreset) : null;
}

export function woListHref(q: { status?: WoListStatus; range?: DateRangePreset; type?: "corrective" | "preventive" }): string {
  const p = new URLSearchParams();
  if (q.status) p.set("status", q.status);
  if (q.range && q.range !== "custom") p.set("range", q.range);
  if (q.type) p.set("type", q.type);
  const s = p.toString();
  return `/dashboard/work-orders${s ? `?${s}` : ""}`;
}
