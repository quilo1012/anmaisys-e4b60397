import { describe, it, expect } from "vitest";
import { personNameCase } from "./personName";

describe("personNameCase", () => {
  it("lowers a name typed in capitals", () => {
    expect(personNameCase("JOAO SPINELLI")).toBe("Joao Spinelli");
    expect(personNameCase("KAMILLA ZAPELINI")).toBe("Kamilla Zapelini");
  });

  it("raises a name typed in small letters", () => {
    expect(personNameCase("josiley rocon")).toBe("Josiley Rocon");
  });

  it("leaves a name already written right as it was", () => {
    expect(personNameCase("Juliano Santos")).toBe("Juliano Santos");
    expect(personNameCase("Pedro De Assis")).toBe("Pedro De Assis");
  });

  it("keeps accents, in both directions", () => {
    expect(personNameCase("JOÃO CONCEIÇÃO")).toBe("João Conceição");
    expect(personNameCase("éLIO")).toBe("Élio");
  });

  it("starts a word after a hyphen or an apostrophe, as initcap does", () => {
    expect(personNameCase("ANA-MARIA O'BRIEN")).toBe("Ana-Maria O'Brien");
  });

  it("does not raise a letter that follows a digit", () => {
    expect(personNameCase("MARCIO CARVALHO 1")).toBe("Marcio Carvalho 1");
  });

  it("trims and collapses spaces", () => {
    expect(personNameCase("  ana   silva ")).toBe("Ana Silva");
  });
});
