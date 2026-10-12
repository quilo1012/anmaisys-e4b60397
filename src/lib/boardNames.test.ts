import { describe, it, expect } from "vitest";
import { disambiguators } from "@/lib/boardNames";

describe("disambiguators", () => {
  it("leaves a unique name alone", () => {
    const m = disambiguators([{ id: "a", full_name: "Lucas Gloor" }, { id: "b", full_name: "Lucas Silva" }]);
    expect(m.get("a")).toBeNull();
    expect(m.get("b")).toBeNull();
  });

  it("gives two people with the same name their employee number", () => {
    const m = disambiguators([
      { id: "a", full_name: "Pedro Assis", employee_ref: "1021" },
      { id: "b", full_name: "pedro  ássis", employee_ref: "1188" },
    ]);
    expect(m.get("a")).toBe("#1021");
    expect(m.get("b")).toBe("#1188");
  });

  it("falls back to the department, then to the id, never to nothing", () => {
    const m = disambiguators([
      { id: "abcdef123", full_name: "Ana Lima", department: "Hygiene" },
      { id: "zyxwvu987", full_name: "Ana Lima" },
    ]);
    expect(m.get("abcdef123")).toBe("Hygiene");
    expect(m.get("zyxwvu987")).toBe("zyxwvu");
  });

  it("does not count the same person twice as a twin", () => {
    const m = disambiguators([{ id: "a", full_name: "Ana" }, { id: "a", full_name: "Ana" }]);
    expect(m.get("a")).toBeNull();
  });
});
