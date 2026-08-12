import { describe, it, expect, vi } from "vitest";

// O módulo traz o cliente do Supabase e o react-query pelo topo. Nada disto é
// tocado por `getShiftWindows`, que é aritmética pura, mas importar o ficheiro
// executa-os na mesma.
vi.mock("@/integrations/supabase/client", () => ({ supabase: {} }));

import { getShiftWindows } from "./useShiftDowntime";
import { shiftClockPct } from "@/lib/linePerformance";

/**
 * A janela do turno, e o relógio que corre dentro dela.
 *
 * As duas funções não se conheciam até o ecrã de linha passar a usá-las juntas.
 * `getShiftWindows` não tinha teste nenhum, e é ela que decide o denominador de
 * `shiftClockPct` — se a janela da noite estiver errada, o tablet do chão de
 * fábrica pinta-se de vermelho de madrugada e ninguém consegue dizer porquê.
 *
 * Agosto é hora de Verão britânica: as 18:00 de Londres são as 17:00 UTC, e um
 * turno construído em UTC puro teria uma hora a mais ou a menos consoante o mês.
 */
describe("a janela do turno e o relógio que lá corre", () => {
  it("o turno do dia vai das 06:00 às 18:00 de Londres", () => {
    const { dayStart, dayEnd } = getShiftWindows("2026-08-12");
    expect(dayStart.toISOString()).toBe("2026-08-12T05:00:00.000Z");
    expect(dayEnd.toISOString()).toBe("2026-08-12T17:00:00.000Z");
    expect((dayEnd.getTime() - dayStart.getTime()) / 3_600_000).toBe(12);
  });

  // A noite pertence ao dia em que começou — é assim que `session_date` a grava
  // e é assim que o líder que a trabalhou lhe chama.
  it("o turno da noite atravessa a meia-noite e continua a durar doze horas", () => {
    const { nightStart, nightEnd } = getShiftWindows("2026-08-12");
    expect(nightStart.toISOString()).toBe("2026-08-12T17:00:00.000Z");
    expect(nightEnd.toISOString()).toBe("2026-08-13T05:00:00.000Z");
    expect((nightEnd.getTime() - nightStart.getTime()) / 3_600_000).toBe(12);
  });

  it("às 02:00 de uma noite de Agosto o relógio marca dois terços, e não o que der em UTC", () => {
    const { nightStart, nightEnd } = getShiftWindows("2026-08-12");
    // 02:00 em Londres, que em BST são as 01:00 UTC. Oito horas de doze.
    const pct = shiftClockPct(nightStart, nightEnd, new Date("2026-08-13T01:00:00Z"));
    expect(pct).toBeCloseTo(66.7, 1);
  });

  it("no Inverno a mesma hora de parede dá o mesmo relógio", () => {
    // Janeiro: Londres está em UTC, por isso as 18:00 de parede são as 18:00 UTC.
    // A percentagem tem de ser a mesma — é a hora do turno que conta, não o fuso.
    const { nightStart, nightEnd } = getShiftWindows("2026-01-12");
    expect(nightStart.toISOString()).toBe("2026-01-12T18:00:00.000Z");
    const pct = shiftClockPct(nightStart, nightEnd, new Date("2026-01-13T02:00:00Z"));
    expect(pct).toBeCloseTo(66.7, 1);
  });

  // Um tablet fica ligado a noite inteira e ninguém o fecha às 18:00. A partir do
  // fim do turno o plano todo era devido, e o relógio fica nos 100 em vez de
  // passar a contar um turno que já não corre.
  it("fecha nas duas pontas", () => {
    const { dayStart, dayEnd } = getShiftWindows("2026-08-12");
    expect(shiftClockPct(dayStart, dayEnd, new Date("2026-08-12T03:00:00Z"))).toBe(0);
    expect(shiftClockPct(dayStart, dayEnd, new Date("2026-08-12T23:00:00Z"))).toBe(100);
  });
});
