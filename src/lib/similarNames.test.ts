import { describe, it, expect } from "vitest";
import { nameKey, similarNames } from "@/lib/similarNames";

/**
 * The two pairs in the real employee record on 04/10/2026. Both are one person
 * written twice; the first pair is still live and still being planned.
 */
const ON_FILE = [
  { id: "1", full_name: "FELIPE DE ARAUJO", active: true },
  { id: "2", full_name: "FELIPE ARAUJO", active: true },
  { id: "3", full_name: "Ezaquiel dos Santos", active: true },
  { id: "4", full_name: "Ezaquiel Santos", active: false },
  { id: "5", full_name: "Ezaquiel Silva", active: true },
  { id: "6", full_name: "Ailton Carlos Rigoto Junior", active: true },
];

describe("nameKey", () => {
  it("reads a connective as spelling, not as a name", () => {
    // The whole of this bug: the office typed the same man twice, once with the
    // "DE" the payroll list carries and once without it.
    expect(nameKey("FELIPE DE ARAUJO")).toBe(nameKey("FELIPE ARAUJO"));
    expect(nameKey("Ezaquiel dos Santos")).toBe(nameKey("Ezaquiel Santos"));
  });

  it("ignores case, accents and double spaces", () => {
    expect(nameKey("josé  da SILVA")).toBe(nameKey("Jose Silva"));
  });

  it("does not make two different surnames the same name", () => {
    expect(nameKey("Ezaquiel dos Santos")).not.toBe(nameKey("Ezaquiel Silva"));
  });
});

describe("similarNames", () => {
  it("finds the person already on file when the connective is the only difference", () => {
    const hits = similarNames("Felipe Araujo", ON_FILE);
    expect(hits.map((h) => h.full_name)).toEqual(["FELIPE DE ARAUJO", "FELIPE ARAUJO"]);
    expect(hits[0].strength).toBe("same");
  });

  it("finds a leaver too — rehiring somebody is not a new record", () => {
    // Ezaquiel Santos left on 04/08 and came back as a second row. The leaver is
    // the record to reopen, not one to type again.
    const hits = similarNames("Ezaquiel Santos", ON_FILE);
    expect(hits.map((h) => h.id)).toContain("4");
    expect(hits.map((h) => h.id)).toContain("3");
  });

  it("keeps a different surname out of it", () => {
    // Ezaquiel Silva is a third person and must not be offered as a duplicate.
    const hits = similarNames("Ezaquiel Silva", ON_FILE);
    expect(hits.map((h) => h.full_name)).toEqual(["Ezaquiel Silva"]);
  });

  it("says nothing about a name sharing only a first name", () => {
    expect(similarNames("Felipe Souza", ON_FILE)).toEqual([]);
  });

  it("flags a name the record holds with middle names, but less strongly", () => {
    const hits = similarNames("Ailton Junior", ON_FILE);
    expect(hits.map((h) => h.id)).toEqual(["6"]);
    expect(hits[0].strength).toBe("close");
  });

  it("flags a one-letter typo", () => {
    // How "Bruneto" for "Brunetto" gets a second record out of one man.
    const hits = similarNames("Ailton Carlos Rigoto Juniour", ON_FILE);
    expect(hits.map((h) => h.id)).toEqual(["6"]);
    expect(hits[0].strength).toBe("close");
  });

  it("is quiet on an empty or one-word-blank name", () => {
    expect(similarNames("", ON_FILE)).toEqual([]);
    expect(similarNames("   ", ON_FILE)).toEqual([]);
  });

  it("puts the strongest match first", () => {
    const hits = similarNames("Ailton Carlos Rigoto Junior", [
      { id: "a", full_name: "Ailton Rigoto", active: true },
      { id: "b", full_name: "Ailton Carlos Rigoto Junior", active: true },
    ]);
    expect(hits.map((h) => h.id)).toEqual(["b", "a"]);
  });
});
