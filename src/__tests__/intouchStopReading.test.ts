import { describe, it, expect } from "vitest";
// Fora de `src` de propósito: a regra é do poller e vive com ele, para que não
// exista uma segunda cópia na app a dizer outra coisa. O teste atravessa a
// fronteira; a regra não.
import { readStop } from "../../supabase/functions/intouch-poll/stopReading";

/**
 * A leitura que o poller faz de cada máquina, com a resposta REAL de
 * `getmachineStatuses` a 12/08 às 10:45 UTC como caso de prova.
 */
describe("readStop", () => {
  it("keeps a stop code that arrives on a healthy status — Filler Line 4, Deep Clean", () => {
    // O caso que deu origem a isto: o ecrã do iTouching mostrava "Deep Clean"
    // há 1:35:45 e o quadro dizia RUNNING, porque o código era deitado fora
    // por o estado ser 1.
    const r = readStop({ status: 1, rawCode: "23EEA244-D79C-4D43-AA7E-05C25D69CC64", requiresWo: false });
    expect(r.code).toBe("23EEA244-D79C-4D43-AA7E-05C25D69CC64");
    expect(r.isDown).toBe(true);
  });

  it("still treats a maintenance code on a healthy status as a stop", () => {
    const r = readStop({ status: 1, rawCode: "EDFAF8FA-D21D-4BB9-9841-807A5E0A936F", requiresWo: true });
    expect(r.isDown).toBe(true);
  });

  it("reads a stop with its own status — Filler Line 1, status 7", () => {
    const r = readStop({ status: 7, rawCode: "EDFAF8FA-D21D-4BB9-9841-807A5E0A936F", requiresWo: false });
    expect(r.code).toBe("EDFAF8FA-D21D-4BB9-9841-807A5E0A936F");
    expect(r.isDown).toBe(true);
  });

  it("does not invent a stop from the empty string iTouching sends when none is active", () => {
    // Filler Line 2, 3, 6, Capsules MC 1 e Tablet Line, todas a 4 com "".
    // É esta a prova de que o campo é vivo e não pegajoso: parada sem código
    // continua a chegar vazia, por isso um código preenchido é uma escolha.
    const r = readStop({ status: 4, rawCode: "", requiresWo: false });
    expect(r.code).toBe("");
    expect(r.isDown).toBe(false);
  });

  it("does not invent a stop from a missing field either", () => {
    const r = readStop({ status: 1, rawCode: null, requiresWo: false });
    expect(r.code).toBeNull();
    expect(r.isDown).toBe(false);
  });

  it("a machine standing still with no code is not a downtime record — it is STOPPED · NO CODE", () => {
    // Sem código não há razão para registar: `production_downtimes` guarda
    // motivos, e "4" não é um motivo. O quadro é que nomeia este estado.
    const r = readStop({ status: 4, rawCode: null, requiresWo: false });
    expect(r.isDown).toBe(false);
  });

  it("keeps the code even when the status is unreadable", () => {
    const r = readStop({ status: null, rawCode: "23EEA244-D79C-4D43-AA7E-05C25D69CC64", requiresWo: false });
    expect(r.code).toBe("23EEA244-D79C-4D43-AA7E-05C25D69CC64");
    expect(r.isDown).toBe(true);
  });
});
