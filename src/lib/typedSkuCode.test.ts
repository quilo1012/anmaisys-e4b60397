import { describe, expect, it } from "vitest";
import { literalIlikePattern, pickSkuForTypedCode, skuCodeKey } from "./typedSkuCode";

const BAGCW6C = { id: "bag", code: "BAGCW6C", name: "BAG CRITICAL WHEY 6KG CHOCOLATE", active: true };
const CORGS = { id: "corgs", code: "CORGS", name: "CREAM OF RICE 2KG GOLDEN SYRUP", active: true };

describe("a typed part code is linked to the catalogue by its code", () => {
  it("links a code typed in lower or mixed case (Line 5 night, 28/10: 'Bagcw6c')", () => {
    expect(pickSkuForTypedCode([BAGCW6C], "Bagcw6c")).toBe(BAGCW6C);
    expect(pickSkuForTypedCode([BAGCW6C], "bagcw6c")).toBe(BAGCW6C);
  });

  it("links a code typed exactly but saved without tapping the list (Line 3 night, 28/10: 'CORGS')", () => {
    expect(pickSkuForTypedCode([CORGS], "CORGS")).toBe(CORGS);
  });

  it("ignores surrounding and repeated spaces", () => {
    expect(pickSkuForTypedCode([{ id: "s", code: "SAMPLE CWV", name: "", active: true }], "  sample   cwv ")?.id).toBe("s");
  });

  it("does not match a product by its name, nor a typo, nor a longer code", () => {
    expect(pickSkuForTypedCode([BAGCW6C], "Bag critical whey 6kg chocolate")).toBeNull();
    expect(pickSkuForTypedCode([BAGCW6C], "BAGCW6")).toBeNull();
    expect(pickSkuForTypedCode([BAGCW6C], "BAGCW6CC")).toBeNull();
    expect(pickSkuForTypedCode([BAGCW6C], "   ")).toBeNull();
  });

  it("prefers the active row over a retired one with the same code", () => {
    const retired = { ...BAGCW6C, id: "old", active: false };
    expect(pickSkuForTypedCode([retired, BAGCW6C], "bagcw6c")?.id).toBe("bag");
    expect(pickSkuForTypedCode([retired], "bagcw6c")?.id).toBe("old");
  });

  it("with two active rows for one code, takes the one spelled as typed, otherwise leaves it as typed", () => {
    const lower = { id: "a", code: "kSABEEFXPBM", name: "", active: true };
    const upper = { id: "b", code: "KSABEEFXPBM", name: "", active: true };
    expect(pickSkuForTypedCode([lower, upper], "KSABEEFXPBM")?.id).toBe("b");
    expect(pickSkuForTypedCode([lower, upper], "ksabeefxpbm")).toBeNull();
  });
});

describe("the lookup pattern", () => {
  it("treats ILIKE wildcards in a code as plain characters", () => {
    expect(literalIlikePattern("AB_C%D\\E")).toBe("AB\\_C\\%D\\\\E");
    expect(literalIlikePattern("AUHYDRO+LL")).toBe("AUHYDRO+LL");
  });

  it("normalises a key the same way for code and typed text", () => {
    expect(skuCodeKey(" Bagcw6c ")).toBe(skuCodeKey("BAGCW6C"));
  });
});
