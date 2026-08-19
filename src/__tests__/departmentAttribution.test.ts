import { describe, it, expect, beforeEach } from "vitest";
import {
  actionPoints,
  livePoints,
  standsAgainstLeader,
  setExcludedDepartments,
  excludedDepartmentSet,
  countsAgainstLeaderDepartment,
} from "@/lib/qualityConstants";

/**
 * A department can be somebody else's, the same way a label can.
 *
 * Until this, attribution ran on labels alone and `department` was a filter and a bar
 * chart. The factory's own reading is the other way round: the person logging the
 * action picks the department FIRST, and picking "Maintenance" is them saying, in the
 * one field built for it, whose problem this is.
 *
 * The rule is a veto, and that is deliberately NOT what `countsAgainstLeader` does for
 * labels — see the history written above it, where a label veto was tried and reverted
 * because one label could silently clear a penalty. A department cannot do that: an
 * action has exactly ONE department, it is a required choice on the form, and it prints
 * in its own column on the list and in the action's history. There is no set to hide a
 * clearing value inside, so the lever a label veto created does not exist here.
 */

/** Quality has said Maintenance answers for its own machines. */
const EXCLUDED = new Set(["maintenance"]);
/** No label is excluded in these cases — the department is the whole question. */
const NO_LABELS = new Set<string>();

beforeEach(() => {
  // Module-level, like the label prices, so charts and PDF builders that are plain
  // functions see it. Reset between cases so one test cannot leak into the next.
  setExcludedDepartments({});
});

describe("countsAgainstLeaderDepartment", () => {
  it("charges an action whose department counts", () => {
    expect(countsAgainstLeaderDepartment({ department: "Production" }, EXCLUDED)).toBe(true);
  });

  it("does not charge an action whose department is excluded", () => {
    expect(countsAgainstLeaderDepartment({ department: "Maintenance" }, EXCLUDED)).toBe(false);
  });

  it("charges an action with no department at all", () => {
    // Same reasoning as the blank-labels case: leaving the field empty must not
    // quietly remove a deviation from somebody's score.
    expect(countsAgainstLeaderDepartment({ department: null }, EXCLUDED)).toBe(true);
    expect(countsAgainstLeaderDepartment({ department: "" }, EXCLUDED)).toBe(true);
  });

  it("matches on trimmed, case-folded text", () => {
    // The list is managed by hand in Lists & scoring and the actions carry free text.
    expect(countsAgainstLeaderDepartment({ department: "  maintenance " }, EXCLUDED)).toBe(false);
    expect(countsAgainstLeaderDepartment({ department: "MAINTENANCE" }, EXCLUDED)).toBe(false);
  });

  it("excludes nothing when the set is empty", () => {
    // Errs strict, and on purpose. An empty set is also what an unloaded query looks
    // like, so the wrong answer here has to be the visible, arguable one — a total
    // that is too high — never a leader quietly scoring green.
    expect(countsAgainstLeaderDepartment({ department: "Maintenance" }, new Set())).toBe(true);
  });
});

describe("livePoints, with the department in force", () => {
  const critical = {
    severity: "critical" as const,
    labels: ["Batch code"],
    validation_status: "validated",
  };

  it("charges the full grade when the department counts", () => {
    expect(livePoints({ ...critical, department: "Production" }, NO_LABELS, EXCLUDED)).toBe(4);
  });

  it("charges nothing when the department is excluded", () => {
    expect(livePoints({ ...critical, department: "Maintenance" }, NO_LABELS, EXCLUDED)).toBe(0);
  });

  it("lets the department veto an otherwise attributable label", () => {
    // The decision taken with the factory: any exclusion wins. A machine failure is
    // not the shift leader's, whichever line it stopped.
    expect(
      livePoints(
        { severity: "high", labels: ["Batch code"], validation_status: "validated", department: "Maintenance" },
        NO_LABELS,
        EXCLUDED,
      ),
    ).toBe(0);
  });

  it("still charges nothing for safety, whatever the department says", () => {
    expect(
      livePoints({ ...critical, domain: "safety", department: "Production" }, NO_LABELS, EXCLUDED),
    ).toBe(0);
  });
});

describe("standsAgainstLeader", () => {
  it("drops an action booked to an excluded department", () => {
    expect(
      standsAgainstLeader({ labels: ["Batch code"], department: "Maintenance" }, NO_LABELS, EXCLUDED),
    ).toBe(false);
  });

  it("keeps an action booked to a department that counts", () => {
    expect(
      standsAgainstLeader({ labels: ["Batch code"], department: "Production" }, NO_LABELS, EXCLUDED),
    ).toBe(true);
  });
});

describe("the freeze still wins", () => {
  it("keeps the figure frozen on the action, even under a new department rule", () => {
    // 20260822090000 is the whole point: a score is frozen at the scale of its day.
    // Excluding a department today must not silently re-price what it cost in July.
    expect(
      actionPoints(
        { severity: "critical", labels: [], validation_status: "validated", department: "Maintenance", points_at_creation: 4 },
        NO_LABELS,
        EXCLUDED,
      ),
    ).toBe(4);
  });
});

describe("setExcludedDepartments / excludedDepartmentSet", () => {
  it("reads the option rows into a lowercased set", () => {
    setExcludedDepartments({ Maintenance: false, Production: true, Warehouse: true });
    expect(excludedDepartmentSet()).toEqual(new Set(["maintenance"]));
  });

  it("defaults livePoints to the module-level set when no set is passed", () => {
    setExcludedDepartments({ Maintenance: false });
    expect(
      livePoints({ severity: "critical", labels: [], validation_status: "validated", department: "Maintenance" }, NO_LABELS),
    ).toBe(0);
    expect(
      livePoints({ severity: "critical", labels: [], validation_status: "validated", department: "Production" }, NO_LABELS),
    ).toBe(4);
  });
});
