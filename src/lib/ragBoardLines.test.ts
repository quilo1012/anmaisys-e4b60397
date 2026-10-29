import { describe, it, expect } from "vitest";
import { ragBoardLines } from "./ragBoardLines";

/** A tabela `lines` tal como está em produção a 2026-08-27, por nome como o `.order("name")` a devolve. */
const PROD = [
  { name: "Capsules Machine 1", active: true },
  { name: "Capsules Machine 2", active: true },
  { name: "GEL Line", active: true },
  { name: "Line 1", active: true },
  { name: "Line 2", active: true },
  { name: "Line 3", active: true },
  { name: "Line 4", active: true },
  { name: "Line 5", active: true },
  { name: "Line 6", active: true },
  { name: "Tablet Line", active: true },
];

/** O que o quadro passou a ter a 29/10: Gel Machine e Gel Packing como linhas próprias. */
const PROD_OCT = [...PROD, { name: "Gel Machine", active: true }, { name: "Gel Packing", active: true }];

describe("ragBoardLines", () => {
  it("põe a fábrica por ordem: enchimento, depois packing", () => {
    expect(ragBoardLines(PROD_OCT)).toEqual([
      "Line 1", "Line 2", "Line 3", "Line 4", "Line 5", "Line 6",
      "Tablet Line", "Gel Packing",
    ]);
  });

  it("GEL Line, Gel Machine e as duas Capsules Machine não vão ao quadro", () => {
    const out = ragBoardLines(PROD_OCT);
    for (const n of ["GEL Line", "Gel Machine", "Capsules Machine 1", "Capsules Machine 2"]) {
      expect(out).not.toContain(n);
    }
  });

  it("tira-as por nome, seja qual for a grafia", () => {
    const out = ragBoardLines([
      { name: "GEL MACHINE", active: true },
      { name: "gel line ", active: true },
      { name: "CAPSULES MACHINE 1", active: true },
      { name: "Gel Packing", active: true },
    ]);
    expect(out).toEqual(["Gel Packing"]);
  });

  it("não inventa postos fora da tabela `lines` — o quadro fala os mesmos nomes do Production Control", () => {
    expect(ragBoardLines(PROD)).not.toContain("Gel Packing");
  });

  it("deixa cair as inactivas e os consumíveis", () => {
    const out = ragBoardLines([
      ...PROD,
      { name: "Sealer", active: true },
      { name: "Printer Ink", active: true },
      { name: "Line 7", active: false },
    ]);
    expect(out).not.toContain("Sealer");
    expect(out).not.toContain("Printer Ink");
    expect(out).not.toContain("Line 7");
  });

  it("uma linha nova entra depois da Tablet Line", () => {
    const out = ragBoardLines([...PROD, { name: "Sachet Line", active: true }]);
    expect(out.indexOf("Sachet Line")).toBeGreaterThan(out.indexOf("Tablet Line"));
  });
});
