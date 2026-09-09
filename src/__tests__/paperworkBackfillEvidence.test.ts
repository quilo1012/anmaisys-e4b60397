import { describe, it, expect } from "vitest";
import { computeLeaderScore } from "@/lib/leaderScore";
import { DOCUMENTATION_LABEL } from "@/lib/qualityConstants";

/**
 * Evidence for the 2026-W36 Paperwork backfill: labelling an OPEN paperwork action
 * moves no figure on the card. Real rows, copied from the base on 09/09/2026.
 */
type Row = {
  id: string;
  leader_name: string;
  labels: string[];
  validation_status: string;
  severity: string | null;
  points_at_creation: number;
  domain: string;
  department: string | null;
};

const W36: Row[] = [
  { id: "93e738af", leader_name: "Cainan", labels: [], validation_status: "open", severity: null, points_at_creation: 0, domain: "quality", department: null },
  { id: "8f8c480b", leader_name: "Everton", labels: [], validation_status: "open", severity: "low", points_at_creation: 2, domain: "quality", department: null },
  { id: "550fc6c8", leader_name: "Guilherme", labels: [], validation_status: "open", severity: null, points_at_creation: 0, domain: "quality", department: null },
  { id: "c4167c0d", leader_name: "Guilherme", labels: [], validation_status: "open", severity: null, points_at_creation: 0, domain: "quality", department: null },
  { id: "be0f2c84", leader_name: "Henrique", labels: [], validation_status: "open", severity: null, points_at_creation: 0, domain: "quality", department: null },
  { id: "200efc1b", leader_name: "Henrique", labels: [], validation_status: "open", severity: null, points_at_creation: 0, domain: "quality", department: null },
  { id: "2144c615", leader_name: "Henrique", labels: [], validation_status: "open", severity: "low", points_at_creation: 2, domain: "quality", department: null },
  { id: "fe8863c1", leader_name: "Henrique", labels: [], validation_status: "open", severity: "critical", points_at_creation: 5, domain: "quality", department: null },
  { id: "bb3c524e", leader_name: "Rafael Tosta", labels: [], validation_status: "open", severity: null, points_at_creation: 0, domain: "quality", department: null },
];

/** The nine safe candidates, by id prefix. */
const TO_LABEL = new Set(["93e738af", "8f8c480b", "c4167c0d", "2144c615", "fe8863c1", "bb3c524e"]);

const LEADERS = ["Cainan", "Everton", "Guilherme", "Henrique", "Rafael Tosta"];

function card(rows: Row[]) {
  const score = computeLeaderScore({
    actual: 90_000,
    target: 100_000,
    avgOEE: null,
    actions: rows,
    excludedLabels: new Set(["maintenance"]),
    gateLabels: new Set<string>(),
  });
  return {
    production: score.production.value,
    quality: score.quality.value,
    documentation: score.documentation.value,
    final: score.final,
  };
}

describe("2026-W36 Paperwork backfill moves no figure", () => {
  for (const leader of LEADERS) {
    it(`${leader}: before === after`, () => {
      const before = W36.filter((r) => r.leader_name === leader);
      const after = before.map((r) =>
        TO_LABEL.has(r.id) ? { ...r, labels: [...r.labels, DOCUMENTATION_LABEL] } : r,
      );
      const a = card(before);
      const b = card(after);
      expect(b).toEqual(a);
      expect(b.documentation).toBeNull();
    });
  }
});
