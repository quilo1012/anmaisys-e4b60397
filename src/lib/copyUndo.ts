/**
 * The receipt a copy leaves behind, so it can be taken back.
 *
 * "Copy from the last day" is the one press on this screen that writes seventy rows,
 * and until now it was also the only one with no way back: a Sunday copied onto a
 * Monday by mistake had to be undone card by card, seventy times, on a tablet. The
 * button that made the mess in one gesture asked for twenty minutes to clean it up.
 *
 * What makes an undo safe is that it is *not* "clear the board". A board after a copy
 * holds three kinds of people — the ones who were already on it, the ones the copy
 * brought, and the ones placed by hand since — and only the middle group is the
 * mistake. So the copy writes down exactly which rows it created, and the undo deletes
 * those and nothing else. Attendance is recorded the same way and for the same reason:
 * the copy fills payroll too, but only for people payroll had nothing on yet, and a
 * row that was already there is not the copy's to delete.
 *
 * It lives in `localStorage` rather than in React state because "I copied the wrong
 * day" is usually noticed a minute later, after the board has been paged, refreshed or
 * handed to somebody else. It is per-browser, which is the honest limit: a copy made on
 * the office PC cannot be undone from the tablet on the floor.
 */

export interface CopyReceipt {
  /** Employees whose `daily_allocations` row this copy created. */
  allocations: string[];
  /** Employees whose `employee_attendance` row this copy created — never one it found. */
  attendance: string[];
  /** What it was copied from, oldest first: an ISO date or a matrix's name. */
  sources: string[];
  /** When the most recent copy onto this board ran. */
  at: string;
}

const PREFIX = "headcount_copy_undo";

export function receiptKey(onDate: string, shift: string): string {
  return `${PREFIX}:${onDate}:${shift}`;
}

/** Ids in the order first seen, each one once. */
function union(a: readonly string[], b: readonly string[]): string[] {
  return [...new Set([...a, ...b])];
}

function isReceipt(v: unknown): v is CopyReceipt {
  if (typeof v !== "object" || v === null) return false;
  const r = v as Record<string, unknown>;
  const strings = (x: unknown) => Array.isArray(x) && x.every((s) => typeof s === "string");
  return strings(r.allocations) && strings(r.attendance) && strings(r.sources) && typeof r.at === "string";
}

/**
 * Two copies onto one board, read as one thing to undo.
 *
 * Someone who copies the wrong day usually presses the button again rather than
 * stopping, and an Undo that only reached the second press would strand the first with
 * nothing pointing at it.
 */
export function mergeReceipt(prev: CopyReceipt | null, next: CopyReceipt): CopyReceipt {
  if (!prev) return next;
  return {
    allocations: union(prev.allocations, next.allocations),
    attendance: union(prev.attendance, next.attendance),
    sources: union(prev.sources, next.sources),
    at: next.at,
  };
}

/**
 * What can still be taken back off this board.
 *
 * Anything unreadable answers null. A key written by an older version of this file, or
 * half-written by a tab that was closed mid-save, must mean "nothing to undo" — a
 * board that throws on a stale string is a board nobody can open.
 */
export function readReceipt(store: Storage, onDate: string, shift: string): CopyReceipt | null {
  let raw: string | null = null;
  try { raw = store.getItem(receiptKey(onDate, shift)); } catch { return null; }
  if (!raw) return null;
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isReceipt(parsed)) return null;
    return parsed.allocations.length === 0 ? null : parsed;
  } catch {
    return null;
  }
}

/**
 * Records a copy, folded into whatever this board already had.
 *
 * A copy that wrote nothing — "everybody is already accounted for" — leaves no receipt
 * and does not disturb the one before it. Offering Undo after that press would be
 * offering to delete the people who were already there.
 */
export function saveReceipt(store: Storage, onDate: string, shift: string, next: CopyReceipt): CopyReceipt | null {
  const merged = mergeReceipt(readReceipt(store, onDate, shift), next);
  if (merged.allocations.length === 0) return null;
  // A private-mode Safari or a full quota throws here. Losing the undo is a smaller
  // failure than losing the copy that has already been written to the database.
  try { store.setItem(receiptKey(onDate, shift), JSON.stringify(merged)); } catch { /* no undo, still copied */ }
  return merged;
}

export function dropReceipt(store: Storage, onDate: string, shift: string): void {
  try { store.removeItem(receiptKey(onDate, shift)); } catch { /* nothing to drop */ }
}
