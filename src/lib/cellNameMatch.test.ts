import { describe, it, expect } from "vitest";
import { matchCellName } from "@/lib/cellNameMatch";

const P = [
  { id: "1", full_name: "Lucas Gloor", sheet_aliases: "LUCAS GLOR", employee_ref: "1021" },
  { id: "2", full_name: "Lucas Leonel" },
  { id: "3", full_name: "Giovany Gava", sheet_aliases: "GYOVANI" },
  { id: "4", full_name: "João Pedro Solcia" },
  { id: "5", full_name: "Pedro De Assis" },
];

describe("matchCellName", () => {
  it("finds by the start of the name, first", () => {
    expect(matchCellName("luc", P).map((p) => p.id)).toEqual(["1", "2"]);
  });
  it("finds by any word of the name", () => {
    expect(matchCellName("gloor", P).map((p) => p.id)).toEqual(["1"]);
  });
  it("finds by the sheet's own spelling", () => {
    expect(matchCellName("gyov", P).map((p) => p.id)).toEqual(["3"]);
  });
  it("finds by employee number", () => {
    expect(matchCellName("102", P).map((p) => p.id)).toEqual(["1"]);
  });
  it("ignores accents and puts start-of-name before mid-name", () => {
    expect(matchCellName("joao", P).map((p) => p.id)).toEqual(["4"]);
    expect(matchCellName("pedro", P).map((p) => p.id)).toEqual(["5", "4"]);
  });
  it("offers nobody for nothing typed", () => {
    expect(matchCellName("  ", P)).toEqual([]);
  });
});
