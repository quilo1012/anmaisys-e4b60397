import { describe, expect, it } from "vitest";
import { approvalBlockers, capaStatusLabel } from "@/lib/capaGate";
import { emptyDraft } from "@/lib/scorecardEntry";

const draft = emptyDraft("l", "n", "2026-07-05");
// Estes casos medem a CAPA. Uma semana por submeter e bloqueada mais acima,
// pelo caso proprio logo a seguir.
const SUBMITTED = "2026-07-06T08:00:00.000Z";

describe("approvalBlockers", () => {
  it("names every missing CAPA field when the week carries a Fail", () => {
    const blockers = approvalBlockers(draft, { quality_fail_type: "Fail", submitted_at: SUBMITTED });
    expect(blockers).toEqual(["Root cause", "Corrective action", "CAPA owner", "CAPA due date"]);
  });

  it("blocks nothing on a Not Done, which has no product deviation to investigate", () => {
    expect(approvalBlockers(draft, { quality_fail_type: "Not Done", submitted_at: SUBMITTED })).toEqual([]);
  });

  // Espelha o trigger, que passou a recusar `approved_at` sobre um `submitted_at` nulo.
  it("blocks a week that was never submitted, whatever the quality verdict", () => {
    expect(approvalBlockers(draft, { quality_fail_type: null })).toEqual(["Submission"]);
    expect(approvalBlockers(draft, { quality_fail_type: "Not Done" })).toEqual(["Submission"]);
    // E acumula: por submeter E sem CAPA sao as duas coisas, nao uma.
    expect(approvalBlockers(draft, { quality_fail_type: "Fail" })).toEqual([
      "Submission", "Root cause", "Corrective action", "CAPA owner", "CAPA due date",
    ]);
  });

  it("clears once the investigation is written down", () => {
    const filled = { ...draft, root_cause: "x", corrective_action: "y", capa_owner: "z", capa_due_date: "2026-07-31" };
    expect(approvalBlockers(filled, { quality_fail_type: "Fail", submitted_at: SUBMITTED })).toEqual([]);
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
