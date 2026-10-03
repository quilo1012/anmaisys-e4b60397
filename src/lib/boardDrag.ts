/**
 * Who is being dragged across the headcount board.
 *
 * The browser will not let a `dragover` handler read `dataTransfer` — the payload is
 * sealed until `drop` — so a board that wants to know anything while the card is still
 * in the air has to remember it separately. That memory is the whole reason this file
 * exists, and it is also the thing that went wrong.
 *
 * It used to be a bare module variable set on `dragStart` and never cleared. The value
 * outlived its drag: press Escape halfway, or let go over nothing, and the id stayed.
 * The next `drop` on any zone read it and placed that person — and the zone could be a
 * different board, because the split view runs two of them against this same memory.
 * Dragging a file in from the desktop was enough to fire it.
 *
 * So the read is `take`, not `get`. It is single-use by construction: once a drop has
 * had it, nothing else can. The bug is not fixed here so much as made unavailable.
 */

let held: string | null = null;

/** A card has been picked up. */
export function holdDrag(employeeId: string): void {
  held = employeeId;
}

/** The drag is over, however it ended — dropped, cancelled, abandoned. */
export function clearDrag(): void {
  held = null;
}

/**
 * The employee this drop is about, and the end of the memory either way.
 *
 * `fromEvent` is what the browser handed over, and it wins: it belongs to THIS drop,
 * where the remembered value only belongs to the last drag that started. The fallback
 * is for the drags where the payload does not survive the trip — jsdom, and some
 * touch shims on the floor tablets.
 *
 * Empty means "nothing of ours was dropped here", which is the honest answer when
 * somebody drags in a file, and the caller is expected to do nothing with it.
 */
export function takeDrag(fromEvent?: string | null): string {
  const id = (fromEvent && fromEvent.length > 0 ? fromEvent : held) ?? "";
  held = null;
  return id;
}

/** Only for tests that need to assert the memory is empty. */
export function peekDrag(): string | null {
  return held;
}
