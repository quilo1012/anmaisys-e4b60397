import { describe, expect, it } from "vitest";
import { leaderNameKey } from "@/lib/leaderNameMatch";

/**
 * The regression this exists for.
 *
 * Analytics' Leader Performance card joins production to quality on the leader's name,
 * in memory, with three separate `(x.leader_name || "").trim()` keys and no case
 * folding. `leader_pins` holds HENRIQUE, CAINAN, FILIPI, KAZ and JULIANO in capitals
 * while the tablet writes Henrique, Cainan, Filipi, Kaz and Juliano, so for those five
 * the join silently missed: their row appeared with the production they had run, Open
 * Actions 0, and a score built on no quality actions at all — Quality 100%,
 * Documentation 100%.
 *
 * The failure always flatters, which is why nobody reports it. Meanwhile the
 * documentation panel beside it counts the same people's errors, because it reads the
 * actions directly and never joins by name — so the two halves of one card disagreed.
 */

describe("leaderNameKey", () => {
  it("matches the same person written two ways", () => {
    expect(leaderNameKey("CAINAN")).toBe(leaderNameKey("Cainan"));
    expect(leaderNameKey("HENRIQUE")).toBe(leaderNameKey("Henrique"));
  });

  it("ignores the whitespace a hand-typed name arrives with", () => {
    expect(leaderNameKey("  Kaz ")).toBe(leaderNameKey("Kaz"));
    expect(leaderNameKey("Rafael  Tosta")).toBe(leaderNameKey("Rafael Tosta"));
  });

  it("keeps different people apart", () => {
    expect(leaderNameKey("Marcio")).not.toBe(leaderNameKey("Marcelo"));
    expect(leaderNameKey("Filipi")).not.toBe(leaderNameKey("Filipe"));
  });

  it("reads a missing name as empty, for the caller to skip", () => {
    // Never a key: grouping the unnamed rows together would invent a leader called
    // nothing and hang everybody's orphaned actions on them.
    expect(leaderNameKey(null)).toBe("");
    expect(leaderNameKey(undefined)).toBe("");
    expect(leaderNameKey("   ")).toBe("");
  });
});
