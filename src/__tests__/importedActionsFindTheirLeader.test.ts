import { describe, it, expect } from "vitest";
import { resolveLeaderId } from "@/lib/leaderNameMatch";

/**
 * An imported action carries a leader's NAME and, until now, nobody's id.
 *
 * `QualityImportDialog` reads "Leader" from the spreadsheet into `leader_name` and
 * inserts the row as-is. `leader_id` is never set, so it lands null — and
 * `scorecard_safety_counts` counts `WHERE leader_id = _leader_id`. A bulk-imported
 * safety occurrence therefore counts against nobody: it is on the board, visible, and
 * absent from every weekly card.
 *
 * That failure flatters, which is why it goes unreported — the same asymmetry
 * `leaderNameMatch` was written about. A leader whose occurrences were all imported
 * reads as a leader with none.
 *
 * The rule below is deliberately the SAME rule the database migration used when it
 * rehomed the ids already stored (20260819092343): match on a folded name, and accept
 * it only when exactly ONE leader answers to it. Two rules for one question would
 * drift, and the drift would be silent.
 */
const LEADERS = [
  { id: "id-henrique", name: "HENRIQUE" },
  { id: "id-cainan", name: "Cainan" },
  { id: "id-kaz", name: "Kaz" },
];

describe("resolveLeaderId", () => {
  it("matches ignoring case — the whole reason this function exists", () => {
    // The log spells him HENRIQUE, the spreadsheet Henrique. Same person.
    expect(resolveLeaderId("Henrique", LEADERS)).toBe("id-henrique");
    expect(resolveLeaderId("CAINAN", LEADERS)).toBe("id-cainan");
  });

  it("forgives the spacing a hand-typed cell arrives with", () => {
    expect(resolveLeaderId("  Kaz  ", LEADERS)).toBe("id-kaz");
    expect(resolveLeaderId("Cainan", [{ id: "id-x", name: " Cainan " }])).toBe("id-x");
  });

  it("refuses to guess when two leaders answer to the name", () => {
    // A coin flip here puts one leader's occurrence on another's card. Null says
    // "unattributed", which is true, and leader_name still prints on the row.
    const twins = [{ id: "a", name: "Daniel" }, { id: "b", name: "daniel" }];
    expect(resolveLeaderId("Daniel", twins)).toBeNull();
  });

  it("returns null for a name nobody has, and for no name at all", () => {
    expect(resolveLeaderId("Someone Else", LEADERS)).toBeNull();
    expect(resolveLeaderId("", LEADERS)).toBeNull();
    expect(resolveLeaderId("   ", LEADERS)).toBeNull();
    expect(resolveLeaderId(null, LEADERS)).toBeNull();
    expect(resolveLeaderId(undefined, LEADERS)).toBeNull();
  });

  it("never matches a leader whose own name is blank", () => {
    // Otherwise an empty cell and an empty leader row would find each other and every
    // unnamed import would be attributed to the same accidental person.
    expect(resolveLeaderId("", [{ id: "blank", name: "  " }])).toBeNull();
    expect(resolveLeaderId("  ", [{ id: "blank", name: "" }])).toBeNull();
  });
});
