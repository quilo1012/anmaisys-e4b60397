import { describe, expect, it } from "vitest";
import {
  boardCounts,
  formatScore,
  scoreCell,
  stateLabel,
  weekEndingFor,
  type ScorecardBoardRow,
} from "@/lib/scorecardWeek";

const row = (over: Partial<ScorecardBoardRow>): ScorecardBoardRow => ({
  leader_id: "l",
  leader_name: "LIDER",
  line_id: "n",
  line_name: "LINHA",
  entry_id: null,
  state: "por preencher",
  volume_rag: null,
  quality_rag: null,
  hs_rag: null,
  overall_rag: null,
  rag_driver: null,
  capa_required: null,
  score_final: null,
  score_bruto: null,
  cap_reason: null,
  cap_applied: null,
  ...over,
});

describe("weekEndingFor", () => {
  it("gives the Sunday that closes the week", () => {
    expect(weekEndingFor(new Date("2026-07-01T10:00:00Z"))).toBe("2026-07-05");
  });

  it("leaves a Sunday where it is", () => {
    expect(weekEndingFor(new Date("2026-07-05T10:00:00Z"))).toBe("2026-07-05");
  });
});

describe("boardCounts", () => {
  it("counts what is still owed", () => {
    const counts = boardCounts([
      row({ state: "por preencher" }),
      row({ state: "submetida" }),
      row({ state: "submetida", capa_required: true }),
      row({ state: "aprovada" }),
    ]);
    expect(counts).toEqual({ toFill: 1, toApprove: 2, capasOpen: 1 });
  });

  it("counts nothing when there is nothing, rather than guessing", () => {
    expect(boardCounts([])).toEqual({ toFill: 0, toApprove: 0, capasOpen: 0 });
  });
});

describe("formatScore", () => {
  it("never prints a null score as zero", () => {
    expect(formatScore(null)).toBe("—");
  });

  it("floors 99.7 to 99, never rounds to nearest", () => {
    expect(formatScore(99.7)).toBe("99");
  });
});

describe("scoreCell", () => {
  it("exposes the cap reason when a ceiling applied", () => {
    const capped = row({ score_final: 60, cap_applied: true, cap_reason: "Falha de segurança alimentar" });
    expect(scoreCell(capped)).toEqual({ text: "60", capReason: "Falha de segurança alimentar" });
  });

  it("hides the cap reason when no ceiling applied", () => {
    const uncapped = row({ score_final: 84.9, cap_applied: false, cap_reason: null });
    expect(scoreCell(uncapped)).toEqual({ text: "84", capReason: null });
  });

  it("shows a dash and no cap reason for a week with nothing filled in", () => {
    expect(scoreCell(row({}))).toEqual({ text: "—", capReason: null });
  });
});

describe("stateLabel", () => {
  it("maps 'por preencher' to 'To fill'", () => {
    expect(stateLabel("por preencher")).toBe("To fill");
  });

  it("maps 'rascunho' to 'Draft'", () => {
    expect(stateLabel("rascunho")).toBe("Draft");
  });

  it("maps 'submetida' to 'Submitted'", () => {
    expect(stateLabel("submetida")).toBe("Submitted");
  });

  it("maps 'aprovada' to 'Approved'", () => {
    expect(stateLabel("aprovada")).toBe("Approved");
  });
});
