import { describe, it, expect } from "vitest";
import { loggingShiftOptions, shiftLoggingDeadline, SHIFT_GRACE_MINUTES } from "@/lib/shifts";

/**
 * A tolerância de fim de turno.
 *
 * A produção é escrita no fim de uma corrida, não enquanto a máquina enche, por isso
 * quem acaba às 17:55 ainda está a lançar às 18:05. A base de dados já aceitava essa
 * escrita, mas o ecrã já lhe tinha aberto a sessão da Noite — a quantidade do turno do
 * Dia caía no turno seguinte sem ninguém ver. Estes testes fixam a janela em que os
 * dois turnos estão abertos e a pergunta é feita.
 *
 * Agosto é hora de Verão britânica: as 18:00 de Londres são as 17:00 UTC. Janeiro é
 * GMT: as 18:00 de Londres são as 18:00 UTC. Ambos estão aqui de propósito — a versão
 * antiga desta aritmética assumia que uma hora de parede são sempre 3600 segundos.
 */
describe("loggingShiftOptions", () => {
  it("a tolerância é de trinta minutos", () => {
    expect(SHIFT_GRACE_MINUTES).toBe(30);
  });

  it("a meio do turno do dia só há um turno para registar", () => {
    // 12:00 de Londres em Agosto (BST) = 11:00 UTC.
    const r = loggingShiftOptions(new Date("2026-08-12T11:00:00Z"));
    expect(r.incoming).toEqual({ sessionDate: "2026-08-12", shiftCode: "day" });
    expect(r.outgoing).toBeNull();
    expect(r.graceEndsAt).toBeNull();
  });

  it("às 17:59 ainda não há passagem de turno nenhuma", () => {
    const r = loggingShiftOptions(new Date("2026-08-12T16:59:00Z"));
    expect(r.incoming.shiftCode).toBe("day");
    expect(r.outgoing).toBeNull();
  });

  it("às 18:05 o turno do dia continua aberto a par do da noite", () => {
    // O caso que motivou tudo isto.
    const r = loggingShiftOptions(new Date("2026-08-12T17:05:00Z"));
    expect(r.incoming).toEqual({ sessionDate: "2026-08-12", shiftCode: "night" });
    expect(r.outgoing).toEqual({ sessionDate: "2026-08-12", shiftCode: "day" });
    expect(r.graceEndsAt!.toISOString()).toBe("2026-08-12T17:30:00.000Z"); // 18:30 Londres
  });

  it("às 18:00 em ponto a janela já está aberta", () => {
    const r = loggingShiftOptions(new Date("2026-08-12T17:00:00Z"));
    expect(r.outgoing).toEqual({ sessionDate: "2026-08-12", shiftCode: "day" });
  });

  it("às 18:31 a janela fechou e só resta a noite", () => {
    const r = loggingShiftOptions(new Date("2026-08-12T17:31:00Z"));
    expect(r.incoming.shiftCode).toBe("night");
    expect(r.outgoing).toBeNull();
    expect(r.graceEndsAt).toBeNull();
  });

  it("às 06:05 a noite que se registou é a de ONTEM", () => {
    // 06:05 de Londres a 13/08 (BST) = 05:05 UTC. A noite começou às 18:00 do dia 12
    // e é o dia 12 que a fábrica lhe chama de fio a pavio.
    const r = loggingShiftOptions(new Date("2026-08-13T05:05:00Z"));
    expect(r.incoming).toEqual({ sessionDate: "2026-08-13", shiftCode: "day" });
    expect(r.outgoing).toEqual({ sessionDate: "2026-08-12", shiftCode: "night" });
    expect(r.graceEndsAt!.toISOString()).toBe("2026-08-13T05:30:00.000Z"); // 06:30 Londres
  });

  it("às 05:59 ainda se está dentro da noite, não em tolerância", () => {
    const r = loggingShiftOptions(new Date("2026-08-13T04:59:00Z"));
    expect(r.incoming).toEqual({ sessionDate: "2026-08-12", shiftCode: "night" });
    expect(r.outgoing).toBeNull();
  });

  it("em GMT a fronteira é a mesma hora de parede, não o mesmo instante UTC", () => {
    // Janeiro: as 18:05 de Londres são as 18:05 UTC.
    const r = loggingShiftOptions(new Date("2026-01-12T18:05:00Z"));
    expect(r.outgoing).toEqual({ sessionDate: "2026-01-12", shiftCode: "day" });
    expect(r.graceEndsAt!.toISOString()).toBe("2026-01-12T18:30:00.000Z");
  });

  it("a tolerância acaba exatamente quando a escrita fecha", () => {
    // Uma janela que sobrevivesse ao prazo de escrita ofereceria ao operador um turno
    // que a base de dados já recusa — que é como ele descobriu o problema da última vez.
    const r = loggingShiftOptions(new Date("2026-08-12T17:05:00Z"));
    const deadline = shiftLoggingDeadline(r.outgoing!.sessionDate, "DAY");
    expect(r.graceEndsAt!.getTime()).toBe(deadline.getTime());
  });
});

describe("shiftLoggingDeadline", () => {
  it("o dia fecha às 18:30 de Londres", () => {
    expect(shiftLoggingDeadline("2026-08-12", "DAY").toISOString()).toBe("2026-08-12T17:30:00.000Z");
  });

  it("a noite fecha às 06:30 da manhã seguinte", () => {
    expect(shiftLoggingDeadline("2026-08-12", "NIGHT").toISOString()).toBe("2026-08-13T05:30:00.000Z");
  });
});
