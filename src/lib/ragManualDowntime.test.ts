import { describe, it, expect } from "vitest";
import { manualDowntimeFallbackMinutes, shiftWasWorked } from "./ragManualDowntime";

/**
 * O caso que deu origem a isto: domingo, 06/09/2026. A Line 4 só tem turno de dia ao
 * fim-de-semana — não há `production_sessions` para a noite, nem plano, nem actual —
 * e mesmo assim a grelha imprimia 1:30 de "Maint Downtime (iTouching)" na coluna
 * NIGHT, minutos que entravam no total da linha e no total da semana. O mesmo se
 * passava na Line 1 (1:38), Line 2 (1:30), Line 3 (2:00) e Line 6 (4:00).
 */
describe("shiftWasWorked", () => {
  it("counts a shift with a production session", () => {
    expect(shiftWasWorked({ hasSession: true, planQty: 0, actualQty: 0 })).toBe(true);
  });

  it("counts a shift that was planned even if nothing came off it", () => {
    // Line 4, 04/09 noite: plano 7.388, actual 0. Parada a noite inteira é downtime
    // verdadeiro — é exactamente a célula que a regra não pode apagar.
    expect(shiftWasWorked({ hasSession: false, planQty: 7388, actualQty: 0 })).toBe(true);
  });

  it("counts a shift that produced without a plan", () => {
    expect(shiftWasWorked({ hasSession: false, planQty: 0, actualQty: 4494 })).toBe(true);
  });

  it("does not count a shift the line never ran", () => {
    expect(shiftWasWorked({ hasSession: false, planQty: 0, actualQty: 0 })).toBe(false);
  });
});

describe("manualDowntimeFallbackMinutes", () => {
  const cell = {
    manualMinutes: 90,
    autoMinutes: 0,
    hasSession: false,
    planQty: 0,
    actualQty: 0,
  };

  it("drops hand-typed minutes on a shift the line never ran", () => {
    expect(manualDowntimeFallbackMinutes(cell)).toBe(0);
  });

  it("keeps hand-typed minutes on a shift that ran", () => {
    expect(manualDowntimeFallbackMinutes({ ...cell, hasSession: true })).toBe(90);
  });

  it("keeps hand-typed minutes on a planned shift with no output", () => {
    expect(manualDowntimeFallbackMinutes({ ...cell, planQty: 7388 })).toBe(90);
  });

  it("stands aside when the work orders already answered", () => {
    // A regra antiga: o manual só entra quando não há downtime automático nenhum.
    expect(manualDowntimeFallbackMinutes({ ...cell, hasSession: true, autoMinutes: 53 })).toBe(0);
  });

  it("returns zero when nothing was typed", () => {
    expect(manualDowntimeFallbackMinutes({ ...cell, hasSession: true, manualMinutes: 0 })).toBe(0);
  });

  it("ignores a negative or unusable manual value", () => {
    expect(manualDowntimeFallbackMinutes({ ...cell, hasSession: true, manualMinutes: -30 })).toBe(0);
    expect(
      manualDowntimeFallbackMinutes({ ...cell, hasSession: true, manualMinutes: NaN }),
    ).toBe(0);
  });
});
