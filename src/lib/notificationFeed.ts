import { askHasStarted } from "@/lib/overtimeRequests";

/**
 * The persisted half of the bell: rows in `notifications`, which six server functions
 * and (since BLOCO 100) the overtime trigger write, and which no screen used to read.
 */
export interface StoredNotification {
  id: string;
  title: string;
  body: string;
  priority: string;
  action_url: string | null;
  wo_id: string | null;
  read_at: string | null;
  created_at: string;
  kind: string | null;
  overtime_request_id: string | null;
}

export interface AskState {
  id: string;
  status: string;
  on_date: string;
  starts_at: string;
}

export type Availability = "open" | "unavailable";

/**
 * Whether the ask a notification is about can still be answered. Mirrors what the
 * database accepts: open and not started. A deleted ask takes its notification with it
 * (`on delete cascade`), so a missing ask is only a row read before the delete landed.
 */
export function askAvailability(ask: AskState | undefined, now: Date = new Date()): Availability {
  if (!ask || ask.status !== "open") return "unavailable";
  return askHasStarted(ask, now) ? "unavailable" : "open";
}

/** How many days of the bell are kept on screen. Older rows stay in the table. */
export const FEED_DAYS = 14;

/** Where a click goes: only a path inside this app, never an address from a row. */
export function notificationTarget(n: Pick<StoredNotification, "action_url" | "wo_id">): string | null {
  if (n.action_url && n.action_url.startsWith("/") && !n.action_url.startsWith("//")) return n.action_url;
  if (n.wo_id) return `/dashboard/wo/${n.wo_id}`;
  return null;
}
