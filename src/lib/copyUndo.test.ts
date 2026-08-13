import { describe, it, expect, beforeEach } from "vitest";
import {
  receiptKey,
  readReceipt,
  saveReceipt,
  dropReceipt,
  mergeReceipt,
  type CopyReceipt,
} from "./copyUndo";

/**
 * Taking back a copy that went onto the wrong day.
 *
 * "Copy from the last day" writes seventy rows in one press, and until now the only
 * way back was to open seventy cards. The receipt is what makes one press undo one
 * press: the copy records exactly which rows it created, so an undo can delete those
 * and nothing else — not the people who were already on the board, not the ones placed
 * by hand afterwards, and not an attendance row that was there before the copy ran.
 */

/** A Storage the tests can see into, without leaning on jsdom's localStorage. */
function fakeStore(): Storage & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    get length() { return map.size; },
    clear: () => map.clear(),
    getItem: (k: string) => map.get(k) ?? null,
    setItem: (k: string, v: string) => { map.set(k, v); },
    removeItem: (k: string) => { map.delete(k); },
    key: (i: number) => [...map.keys()][i] ?? null,
  } as Storage & { map: Map<string, string> };
}

const receipt = (over: Partial<CopyReceipt> = {}): CopyReceipt => ({
  allocations: ["a", "b"],
  attendance: ["a"],
  sources: ["08 Aug"],
  at: "2026-08-09T06:00:00.000Z",
  ...over,
});

let store: ReturnType<typeof fakeStore>;
beforeEach(() => { store = fakeStore(); });

describe("receiptKey", () => {
  it("keys by the day and the board, so Day and Night undo separately", () => {
    expect(receiptKey("2026-08-09", "Night")).not.toBe(receiptKey("2026-08-09", "Day"));
    expect(receiptKey("2026-08-09", "Night")).not.toBe(receiptKey("2026-08-10", "Night"));
  });
});

describe("saveReceipt / readReceipt", () => {
  it("gives back what was written", () => {
    saveReceipt(store, "2026-08-09", "Night", receipt());
    expect(readReceipt(store, "2026-08-09", "Night")).toEqual(receipt());
  });

  it("has nothing to say about a day nothing was copied onto", () => {
    expect(readReceipt(store, "2026-08-09", "Night")).toBeNull();
  });

  it("does not hand one board's receipt to another", () => {
    saveReceipt(store, "2026-08-09", "Night", receipt());
    expect(readReceipt(store, "2026-08-09", "Day")).toBeNull();
  });

  // A board that throws on a stale key is a board nobody can open. Whatever is in
  // there, the answer is "there is nothing to undo", not a white screen.
  it("treats a corrupt entry as nothing to undo", () => {
    store.setItem(receiptKey("2026-08-09", "Night"), "{not json");
    expect(readReceipt(store, "2026-08-09", "Night")).toBeNull();
  });

  it("treats an entry of the wrong shape as nothing to undo", () => {
    store.setItem(receiptKey("2026-08-09", "Night"), JSON.stringify({ allocations: "everyone" }));
    expect(readReceipt(store, "2026-08-09", "Night")).toBeNull();
  });

  it("survives a Storage that refuses to write", () => {
    const full = { ...store, setItem: () => { throw new Error("QuotaExceededError"); } } as Storage;
    expect(() => saveReceipt(full, "2026-08-09", "Night", receipt())).not.toThrow();
  });
});

describe("mergeReceipt", () => {
  it("is the new receipt when the board has never been copied onto", () => {
    expect(mergeReceipt(null, receipt())).toEqual(receipt());
  });

  // Two presses of Copy are two sets of rows on one board, and an undo that only
  // took back the second would leave the first behind with no way to reach it.
  it("carries both copies, so one Undo takes back both", () => {
    const merged = mergeReceipt(
      receipt({ allocations: ["a", "b"], attendance: ["a"], sources: ["08 Aug"] }),
      receipt({ allocations: ["c"], attendance: ["c"], sources: ["the Day Weekday matrix"], at: "2026-08-09T07:00:00.000Z" }),
    );
    expect(merged.allocations).toEqual(["a", "b", "c"]);
    expect(merged.attendance).toEqual(["a", "c"]);
    expect(merged.sources).toEqual(["08 Aug", "the Day Weekday matrix"]);
  });

  it("names somebody once even if two copies both claim them", () => {
    const merged = mergeReceipt(
      receipt({ allocations: ["a"], attendance: ["a"] }),
      receipt({ allocations: ["a", "b"], attendance: ["a"] }),
    );
    expect(merged.allocations).toEqual(["a", "b"]);
    expect(merged.attendance).toEqual(["a"]);
  });

  it("keeps the same source named once, however often it is copied from", () => {
    const merged = mergeReceipt(receipt({ sources: ["08 Aug"] }), receipt({ sources: ["08 Aug"] }));
    expect(merged.sources).toEqual(["08 Aug"]);
  });

  it("dates the merge by the latest copy, because that is what was just done", () => {
    const merged = mergeReceipt(receipt({ at: "2026-08-09T06:00:00.000Z" }), receipt({ at: "2026-08-09T07:00:00.000Z" }));
    expect(merged.at).toBe("2026-08-09T07:00:00.000Z");
  });

  it("merges on save, without the caller having to read first", () => {
    saveReceipt(store, "2026-08-09", "Night", receipt({ allocations: ["a"], attendance: [] }));
    saveReceipt(store, "2026-08-09", "Night", receipt({ allocations: ["b"], attendance: ["b"] }));
    expect(readReceipt(store, "2026-08-09", "Night")?.allocations).toEqual(["a", "b"]);
    expect(readReceipt(store, "2026-08-09", "Night")?.attendance).toEqual(["b"]);
  });
});

describe("dropReceipt", () => {
  it("leaves nothing to undo twice", () => {
    saveReceipt(store, "2026-08-09", "Night", receipt());
    dropReceipt(store, "2026-08-09", "Night");
    expect(readReceipt(store, "2026-08-09", "Night")).toBeNull();
  });

  it("does not touch the other board's receipt", () => {
    saveReceipt(store, "2026-08-09", "Night", receipt());
    saveReceipt(store, "2026-08-09", "Day", receipt());
    dropReceipt(store, "2026-08-09", "Night");
    expect(readReceipt(store, "2026-08-09", "Day")).not.toBeNull();
  });
});

describe("a copy that wrote nothing", () => {
  // "Everybody is already accounted for" is a real answer to the button, and it
  // leaves nothing behind. Offering Undo after it would be offering to delete the
  // people who were already there.
  it("is not worth a receipt", () => {
    saveReceipt(store, "2026-08-09", "Night", receipt({ allocations: [], attendance: [], sources: ["08 Aug"] }));
    expect(readReceipt(store, "2026-08-09", "Night")).toBeNull();
  });

  it("does not wipe a receipt an earlier copy left", () => {
    saveReceipt(store, "2026-08-09", "Night", receipt({ allocations: ["a"] }));
    saveReceipt(store, "2026-08-09", "Night", receipt({ allocations: [], attendance: [] }));
    expect(readReceipt(store, "2026-08-09", "Night")?.allocations).toEqual(["a"]);
  });
});
