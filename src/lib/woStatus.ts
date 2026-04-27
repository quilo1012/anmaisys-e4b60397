// Centralized status helpers for Work Orders.
// "Open WOs" counts ONLY work orders with status === "open".
// Other active statuses (received, arrived, in_progress) are NOT counted as "open".
// Terminal states (informational): closed, finished, completed, force_closed
export const WO_TERMINAL_STATUSES = ["closed", "finished", "completed", "force_closed"] as const;

export function isWoOpen(status: string | null | undefined): boolean {
  return status === "open";
}

export function countOpenWOs<T extends { status: string }>(wos: T[] | null | undefined): number {
  if (!wos) return 0;
  return wos.filter((w) => w.status === "open").length;
}
