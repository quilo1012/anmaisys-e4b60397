import { describe, it, expect } from "vitest";
import { parseProductNote, resolveSkuFromNote } from "../../supabase/functions/_shared/safetyculture/productNote";

/**
 * Every string below is a real `quality_actions.description` read off the live base
 * on 11/09/2026 — the 18 SafetyCulture rows that carry one, out of 106.
 */
describe("parseProductNote — the product hidden in the note", () => {
  it("splits the shape the operators actually type", () => {
    expect(parseProductNote("Muscle Moose Whey Protein Vanilla 900g / MM26252 / 09-2026  ,  09-2028"))
      .toEqual({ product: "Muscle Moose Whey Protein Vanilla 900g", batch: "MM26252" });
  });

  it("keeps the emoji out of the batch and the padding out of the name", () => {
    expect(parseProductNote("ABE PUMP Tigers Blood 🩸 500g / H26251 / 09-2026 09-2028"))
      .toEqual({ product: "ABE PUMP Tigers Blood 🩸 500g", batch: "H26251" });
  });

  it("reads a note whose best-before is written with slashes of its own", () => {
    expect(parseProductNote("Creatine Monohydrate Unflavoured 1kg / H26246 / 09/2026 09/2028"))
      .toEqual({ product: "Creatine Monohydrate Unflavoured 1kg", batch: "H26246" });
  });

  it("refuses a title that merely contains a slash", () => {
    expect(parseProductNote("GMP- Temporary Fix Used to Position Air Extractor ( L6/ Maintenance)")).toBeNull();
  });

  it("refuses the notes that are not about a product at all", () => {
    for (const s of ["Battery died", "Production", "Flashing strobe broken", "Emergency light not working.\nAisle P-Q AC1", "", null, undefined]) {
      expect(parseProductNote(s)).toBeNull();
    }
  });
});

describe("resolveSkuFromNote — a batch is not a SKU", () => {
  it("takes the only SKU the batch was run as", () => {
    const note = parseProductNote("ABE PUMP Tigers Blood 🩸 500g / H26251 / 09-2026 09-2028")!;
    expect(resolveSkuFromNote(note, [{ code: "PUMPABETB", name: "ABE PUMP 500G - TIGERS BLOOD     [HS CODE:2106909285]" }]))
      .toBe("PUMPABETB");
  });

  it("lets the operator's own words pick the pack size", () => {
    const note = parseProductNote("Creatine Monohydrate Unflavoured 250g / A26213 / 08-2026 ,  08-2028")!;
    expect(resolveSkuFromNote(note, [
      { code: "CRE250", name: "CREATINE MONOHYDRATE POWDER 250g     [HS CODE: 2106909285]" },
      { code: "CRE500", name: "CREATINE MONOHYDRATE POWDER 500g     [HS CODE: 2106909285]" },
    ])).toBe("CRE250");
  });

  it("does not send a UK note to the Australia pack", () => {
    const note = parseProductNote("Creatine Monohydrate Strawberry and Raspberry 250g / Y26245 / 09/2026 09/2028")!;
    expect(resolveSkuFromNote(note, [
      { code: "AUCRE250SR", name: "AUSTRALIA CREATINE 250G - STRAWBERRY AND RASPBERRY" },
      { code: "CRE250SR", name: "CREATINE 250G - STRAWBERRY AND RASPBERRY     [HS CODE:2106909285]" },
    ])).toBe("CRE250SR");
  });

  it("tells Energy from Breathe, which share a batch and differ by one word", () => {
    const note = parseProductNote("Endurance Energy Blackcurrant 🫐 1.5Kg / F26247 / 09-2026 09-2028")!;
    expect(resolveSkuFromNote(note, [
      { code: "BREATHEENDUBC", name: "ENDURANCE CARB & ELECTROLYTE - BREATHE 1.5Kg - BLACKCURRANT     [HS CODE:2106909285]" },
      { code: "ENERGYENDUBC", name: "ENDURANCE  CARB & ELECTROLYTE - ENERGY 1.5Kg - BLACKCURRANT     [HS CODE:2106909285]" },
    ])).toBe("ENERGYENDUBC");
  });

  it("returns nothing rather than a coin toss when the words decide nothing", () => {
    const note = parseProductNote("Whey 1kg / H26246 / 09-2026")!;
    expect(resolveSkuFromNote(note, [
      { code: "AAA", name: "WHEY 1KG" },
      { code: "BBB", name: "WHEY 1KG" },
    ])).toBeNull();
  });

  it("returns nothing when the batch was never produced", () => {
    const note = parseProductNote("Basix Clear Peach Iced Tea 998g / L26244 / 09-2026 09-2028")!;
    expect(resolveSkuFromNote(note, [])).toBeNull();
  });
});
