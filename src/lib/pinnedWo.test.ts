import { describe, it, expect } from "vitest";

/**
 * `?wo=799` picks exactly one order.
 *
 * The rule this holds is that the match is on the number, not on the rendered
 * reference. Filtering by text meant "799" also answered for WO-1799 and WO-7990,
 * and the page would show three orders for a link that named one.
 */
const parsePinned = (raw: string | null): number | null =>
  raw && /^\d+$/.test(raw) ? Number(raw) : null;

const pick = (orders: { wo_number: number }[], pinned: number | null) =>
  pinned === null ? orders : orders.filter((w) => Number(w.wo_number) === pinned);

const ORDERS = [{ wo_number: 799 }, { wo_number: 1799 }, { wo_number: 7990 }, { wo_number: 800 }];

describe("pinned work order", () => {
  it("reads a plain number", () => {
    expect(parsePinned("799")).toBe(799);
  });

  it("ignores anything that is not one", () => {
    // A malformed param must fall back to the normal list rather than filtering
    // everything away and looking like an empty database.
    expect(parsePinned(null)).toBeNull();
    expect(parsePinned("")).toBeNull();
    expect(parsePinned("WO-799")).toBeNull();
    expect(parsePinned("799; drop")).toBeNull();
    expect(parsePinned("-1")).toBeNull();
  });

  it("returns exactly the order asked for", () => {
    expect(pick(ORDERS, 799).map((o) => o.wo_number)).toEqual([799]);
  });

  it("does not half-match a longer number", () => {
    const got = pick(ORDERS, 799).map((o) => o.wo_number);
    expect(got).not.toContain(1799);
    expect(got).not.toContain(7990);
  });

  it("shows everything when nothing is pinned", () => {
    expect(pick(ORDERS, null)).toHaveLength(4);
  });

  it("returns nothing when the order is not in the loaded set", () => {
    // Better an empty list under a banner naming the order than silently showing
    // the whole list, which is what the page did before.
    expect(pick(ORDERS, 12345)).toEqual([]);
  });
});
