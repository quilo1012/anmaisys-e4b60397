import { describe, expect, it, beforeEach } from "vitest";
import {
  MAINTENANCE_LABELS,
  QUALITY_LABELS,
  SAFETY_LABELS,
  CHARGING_LABEL_KINDS,
  chargingLabelPoints,
  labelsForDomain,
  labelBadge,
  labelKindOf,
  livePoints,
  standsAgainstLeader,
  pointsBreakdown,
  setHazardPoints,
  setLabelPoints,
  setSeverityPoints,
} from "@/lib/qualityConstants";
import { listGroups } from "@/lib/qualityListGroups";

const NONE = new Set<string>();

beforeEach(() => {
  setSeverityPoints({ low: 1, medium: 2, high: 3, critical: 4 });
  setLabelPoints({});
  setHazardPoints({});
});

describe("MAINTENANCE_LABELS", () => {
  it("names breakdowns, not deviations and not hazards", () => {
    // Three lists, one table, one log. They may never share a vocabulary — that is
    // the whole reason the log can colour a chip by where it came from.
    expect([...MAINTENANCE_LABELS].length).toBeGreaterThan(0);
    for (const l of MAINTENANCE_LABELS) {
      expect([...QUALITY_LABELS]).not.toContain(l);
      expect([...SAFETY_LABELS]).not.toContain(l);
    }
  });
});

describe("labelsForDomain", () => {
  const lists = {
    labels: ["CCP", "GMP"],
    safetyLabels: ["PPE"],
    maintenanceLabels: ["Bearing failure"],
  };

  it("offers the quality form its own labels AND the maintenance ones", () => {
    // Maintenance is a list inside the quality log, not a domain of its own: the same
    // deviation is logged once and can be both a quality problem and a machine one.
    expect(labelsForDomain("quality", lists)).toEqual(["CCP", "GMP", "Bearing failure"]);
  });

  it("leaves the safety form alone", () => {
    expect(labelsForDomain("safety", lists)).toEqual(["PPE"]);
  });
});

describe("a priced hazard charges the leader", () => {
  it("charges a safety occurrence exactly what its hazard is priced at", () => {
    setHazardPoints({ ppe: 2 });
    expect(livePoints({ domain: "safety", severity: "low", labels: ["PPE"] }, NONE)).toBe(2);
  });

  it("leaves an unpriced hazard free — reporting a near miss still costs nothing", () => {
    setHazardPoints({ ppe: 2 });
    expect(livePoints({ domain: "safety", severity: "high", labels: ["Housekeeping"] }, NONE)).toBe(0);
    expect(livePoints({ domain: "safety", severity: "critical", labels: [] }, NONE)).toBe(0);
  });

  it("never lets the severity grade charge a safety occurrence", () => {
    // Only the price on the hazard counts. A Critical near miss with no priced hazard
    // is still 0 — otherwise every occurrence starts charging the moment somebody
    // grades it, which is not what was asked for.
    setHazardPoints({ ppe: 2 });
    expect(livePoints({ domain: "safety", severity: "critical", labels: ["PPE"] }, NONE)).toBe(2);
  });

  it("still voids a hazard Quality rejected", () => {
    setHazardPoints({ ppe: 2 });
    expect(
      livePoints({ domain: "safety", severity: "low", labels: ["PPE"], validation_status: "rejected" }, NONE),
    ).toBe(0);
  });

  it("stands against the leader exactly when it costs them", () => {
    // The twin of livePoints. These two have gone out of step once already; the
    // invariant is that anything worth points must also count.
    setHazardPoints({ ppe: 2 });
    expect(standsAgainstLeader({ domain: "safety", labels: ["PPE"] }, NONE)).toBe(true);
    expect(standsAgainstLeader({ domain: "safety", labels: ["Housekeeping"] }, NONE)).toBe(false);
    expect(standsAgainstLeader({ domain: "safety", labels: [] }, NONE)).toBe(false);
  });

  it("says on the card which of the two a zero is", () => {
    setHazardPoints({ ppe: 2 });
    const free = pointsBreakdown({ domain: "safety", severity: "high", labels: ["Housekeeping"] }, NONE);
    expect(free.points).toBe(0);
    expect(free.basis).toBe("safety");
  });
});

describe("a quality label on an old safety row does not start charging", () => {
  it("prices a safety occurrence off the hazard list only", () => {
    // Occurrences logged before the two lists split carry quality labels, and
    // `labelsForDomain` still shows them so they can be unticked. Pricing Foreign Body
    // for the quality log must not reach back and charge those.
    setLabelPoints({ "foreign body": 5 });
    setHazardPoints({ ppe: 2 });
    expect(livePoints({ domain: "safety", severity: "high", labels: ["Foreign Body"] }, NONE)).toBe(0);
    expect(livePoints({ domain: "quality", severity: "high", labels: ["Foreign Body"] }, NONE)).toBe(5);
  });

  it("does not let a hazard price reach a quality action either", () => {
    setHazardPoints({ ppe: 9 });
    expect(livePoints({ domain: "quality", severity: "low", labels: ["PPE"] }, NONE)).toBe(1);
  });
});

describe("a maintenance label is shown but never charged", () => {
  it("keeps maintenance out of the prices that charge", () => {
    // The kind decides. A price typed on a maintenance label is for whoever reads the
    // log, never for the leader's total.
    expect([...CHARGING_LABEL_KINDS]).toEqual(["label", "safety_label"]);
    const points = chargingLabelPoints([
      { kind: "label", value: "CCP", points: 3 },
      { kind: "safety_label", value: "PPE", points: 2 },
      { kind: "maintenance_label", value: "Bearing failure", points: 5 },
      { kind: "department", value: "Quality", points: 0 },
    ]);
    expect(points).toEqual({ labels: { CCP: 3 }, hazards: { PPE: 2 } });
  });

  it("leaves a quality action on its severity when only maintenance is priced", () => {
    // Fed through chargingLabelPoints, "Bearing failure" is not in the map at all, so
    // a Low action carrying it is worth its grade and nothing more.
    setLabelPoints(chargingLabelPoints([
      { kind: "maintenance_label", value: "Bearing failure", points: 5 },
    ]).labels);
    expect(livePoints({ domain: "quality", severity: "low", labels: ["Bearing failure"] }, NONE)).toBe(1);
  });
});

describe("the log tells the three lists apart by colour", () => {
  const kinds = { ccp: "label", ppe: "safety_label", "bearing failure": "maintenance_label" } as const;

  it("finds a label's list whatever the casing", () => {
    expect(labelKindOf("CCP", kinds)).toBe("label");
    expect(labelKindOf(" bearing FAILURE ", kinds)).toBe("maintenance_label");
    expect(labelKindOf("Something nobody configured", kinds)).toBeNull();
  });

  it("gives each list its own badge, and the unknown one the neutral badge", () => {
    const quality = labelBadge("label");
    const maintenance = labelBadge("maintenance_label");
    const safety = labelBadge("safety_label");
    const unknown = labelBadge(null);
    expect(new Set([quality, maintenance, safety, unknown]).size).toBe(4);
  });
});

describe("the lists manager", () => {
  it("shows a maintenance list beside the other three", () => {
    const groups = listGroups("quality");
    expect(groups.map((g) => g.kind)).toEqual(["label", "maintenance_label", "safety_label", "department"]);
  });

  it("gives every label list a points column and departments none", () => {
    const by = Object.fromEntries(listGroups("quality").map((g) => [g.kind, g]));
    expect(by.label.columns.points).toBe(true);
    expect(by.maintenance_label.columns.points).toBe(true);
    expect(by.safety_label.columns.points).toBe(true);
    expect(by.department.columns.points).toBe(false);
  });

  it("lets only the quality list cap a period", () => {
    // A gate is a food-safety ceiling. Widening the points column does not widen this.
    const by = Object.fromEntries(listGroups("quality").map((g) => [g.kind, g]));
    expect(by.label.columns.gate).toBe(true);
    expect(by.maintenance_label.columns.gate).toBe(false);
    expect(by.safety_label.columns.gate).toBe(false);
  });

  it("says out loud which prices charge and which do not", () => {
    const by = Object.fromEntries(listGroups("quality").map((g) => [g.kind, g]));
    expect(by.maintenance_label.effect).toMatch(/never charged|no leader/i);
    expect(by.safety_label.effect).toMatch(/charge/i);
  });
});
