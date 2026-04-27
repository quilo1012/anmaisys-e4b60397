// Centralized status helpers for Work Orders.
// "Open" means anything that is NOT in a terminal state.
// Terminal states: closed, finished, completed, force_closed
export const WO_TERMINAL_STATUSES = ["closed", "finished", "completed", "force_closed"] as const;

export function isWoOpen(status: string | null | undefined): boolean {
  if (!status) return false;
  return !WO_TERMINAL_STATUSES.includes(status as any);
}

export function countOpenWOs<T extends { status: string }>(wos: T[] | null | undefined): number {
  if (!wos) return 0;
  return wos.filter((w) => isWoOpen(w.status)).length;
}
