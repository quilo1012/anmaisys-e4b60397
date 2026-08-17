import { describe, expect, it } from "vitest";
import { approvalBlockers, capaStatusLabel } from "@/lib/capaGate";
import { emptyDraft } from "@/lib/scorecardEntry";

const draft = emptyDraft("l", "n", "2026-07-05");

describe("approvalBlockers", () => {
  it("names every missing CAPA field when the week carries a Fail", () => {
    const blockers = approvalBlockers(draft, { quality_fail_type: "Fail" });
    expect(blockers).toEqual(["Root cause", "Corrective action", "CAPA owner", "CAPA due date"]);
  });

  it("blocks nothing on a Not Done, which has no product deviation to investigate", () => {
    expect(approvalBlockers(draft, { quality_fail_type: "Not Done" })).toEqual([]);
  });

  it("clears once the investigation is written down", () => {
    const filled = { ...draft, root_cause: "x", corrective_action: "y", capa_owner: "z", capa_due_date: "2026-07-31" };
    expect(approvalBlockers(filled, { quality_fail_type: "Fail" })).toEqual([]);
  });
});

describe("capaStatusLabel", () => {
  it("translates every database enum value to English, leaving the underlying value untranslated data", () => {
    expect(capaStatusLabel("Aberta")).toBe("Open");
    expect(capaStatusLabel("Em Andamento")).toBe("In Progress");
    expect(capaStatusLabel("Concluida")).toBe("Completed");
    expect(capaStatusLabel("Verificada")).toBe("Verified");
  });

  it("reads a null status as an absent dash, never a guess", () => {
    expect(capaStatusLabel(null)).toBe("—");
  });

  it("falls back to the raw value for something unrecognised, rather than hiding it", () => {
    expect(capaStatusLabel("Unexpected")).toBe("Unexpected");
  });
});
