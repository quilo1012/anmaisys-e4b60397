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

describe("ragBoardLines", () => {
  it("põe a fábrica por ordem: enchimento, packing, máquinas", () => {
    expect(ragBoardLines(PROD)).toEqual([
      "Line 1", "Line 2", "Line 3", "Line 4", "Line 5", "Line 6",
      "Tablet Line", "GEL Line",
      "Capsules Machine 1", "Capsules Machine 2",
    ]);
  });

  it("não inventa postos fora da tabela `lines` — o quadro fala os mesmos nomes do Production Control", () => {
    const out = ragBoardLines(PROD);
    expect(out).not.toContain("Gel Packing");
    expect(out).toContain("GEL Line");
  });

  it("GEL Line vem logo depois da Tablet Line e acaba nas máquinas", () => {
    expect(ragBoardLines(PROD).slice(-4)).toEqual([
      "Tablet Line", "GEL Line", "Capsules Machine 1", "Capsules Machine 2",
    ]);
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

  it("uma linha nova entra acima das máquinas, não por baixo", () => {
    const out = ragBoardLines([...PROD, { name: "Sachet Line", active: true }]);
    expect(out.indexOf("Sachet Line")).toBeLessThan(out.indexOf("Capsules Machine 1"));
    expect(out.slice(-2)).toEqual(["Capsules Machine 1", "Capsules Machine 2"]);
  });

  it("aceita 'Gel Machine', a grafia da iTouching, no mesmo lugar da GEL Line", () => {
    const out = ragBoardLines(PROD.map((r) => (r.name === "GEL Line" ? { ...r, name: "Gel Machine" } : r)));
    expect(out[out.indexOf("Tablet Line") + 1]).toBe("Gel Machine");
  });
});
