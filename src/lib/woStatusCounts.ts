/**
 * The work orders of a period, read three ways.
 *
 * Analytics' first KPI row is about the selected period — every card in it says so
 * underneath. "Completed Today" was not: it counted the period's orders but filtered
 * them to the actual calendar day, so choosing last month produced a 0 sitting above
 * the words "No activity in selected period". Two claims, one card, and the figure
 * answered a question the reader had not asked.
 *
 * Open, In Progress and Completed now read the same set, which is what makes them
 * comparable. They do NOT add up to the total, and that is on purpose: see
 * DONE_STATUSES.
 */

/**
 * What counts as finished.
 *
 * `force_closed` is absent deliberately, matching `useMaintenanceKpis`. A force close
 * is a manager filing an order that was never done; counting it here would pad the
 * completed figure with exactly the orders nobody completed.
 */
export const DONE_STATUSES: readonly string[] = ["completed", "closed", "finished"];

export interface WoStatusCounts {
  open: number;
  inProgress: number;
  completed: number;
}

export function woStatusCounts(
  wos: Array<{ status?: string | null }>,
): WoStatusCounts {
  let open = 0, inProgress = 0, completed = 0;
  for (const w of wos) {
    const s = w.status ?? "";
    if (s === "open") open += 1;
    else if (s === "in_progress") inProgress += 1;
    else if (DONE_STATUSES.includes(s)) completed += 1;
  }
  return { open, inProgress, completed };
}
