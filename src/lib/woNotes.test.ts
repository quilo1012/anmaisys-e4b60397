import { describe, it, expect } from "vitest";
import { splitWoNotes } from "./woNotes";

// The real note off WO-2026-000634, as the poll wrote it.
const REAL = "Metal Detected detected automatically by iTouching. Machine: Filler Line 4 Detected: 31/07/2026, 18:38:01 [Updated from iTouching @ 2026-07-31T17:39:01.361Z] Stop code changed → Label Issue (5397A309-E25D-4DB9-A13B-DA64491BF8ED)";

describe("splitWoNotes", () => {
  it("leaves nothing human in an order nobody has written on", () => {
    const { human, machine } = splitWoNotes(REAL);
    expect(human).toBe("");
    expect(machine).toContain("Metal Detected detected automatically");
    expect(machine).toContain("Stop code changed");
  });

  it("keeps the engineer's own words, and only those", () => {
    const { human, machine } = splitWoNotes(
      `${REAL}\nReplaced the sensor and re-ran the magnet check with the leader watching.`,
    );
    expect(human).toBe("Replaced the sensor and re-ran the magnet check with the leader watching.");
    expect(human).not.toContain("iTouching");
    expect(human).not.toContain("5397A309");
    expect(machine).toContain("Stop code changed");
  });

  it("does not swallow a note that merely mentions the machine's name", () => {
    // "Machine:" at the start is the poll's format; a sentence about a machine is not.
    const { human } = splitWoNotes("The machine was already running when I arrived.");
    expect(human).toBe("The machine was already running when I arrived.");
  });

  it("handles an order with no notes at all", () => {
    expect(splitWoNotes(null)).toEqual({ human: "", machine: "" });
    expect(splitWoNotes("   ")).toEqual({ human: "", machine: "" });
  });

  it("separates the automatic resume line too", () => {
    const { human, machine } = splitWoNotes(
      "Line resumed automatically: iTouching reports the machine running.\nWaiting on a spare.",
    );
    expect(human).toBe("Waiting on a spare.");
    expect(machine).toContain("Line resumed automatically");
  });
});
