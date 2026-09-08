import { describe, it, expect } from "vitest";
import { warehouseWaitMinutes, formatWarehouseWait } from "@/lib/warehouseWait";

const NOW = new Date("2026-09-08T10:47:00.000Z").getTime();

describe("warehouseWaitMinutes", () => {
  it("conta até agora enquanto a ordem está aberta", () => {
    expect(warehouseWaitMinutes({ created_at: "2026-09-08T10:00:00.000Z" }, NOW)).toBe(47);
  });

  it("pára no fecho quando a linha já voltou a andar", () => {
    expect(warehouseWaitMinutes({
      created_at: "2026-09-08T10:00:00.000Z",
      closed_at: "2026-09-08T10:12:00.000Z",
    }, NOW)).toBe(12);
  });

  it("aceita o finished_at quando o closed_at não veio", () => {
    expect(warehouseWaitMinutes({
      created_at: "2026-09-08T10:00:00.000Z",
      closed_at: null,
      finished_at: "2026-09-08T10:09:00.000Z",
    }, NOW)).toBe(9);
  });

  it("mostra zero na espera que acabou de começar, em vez de nada", () => {
    expect(warehouseWaitMinutes({ created_at: "2026-09-08T10:46:50.000Z" }, NOW)).toBe(0);
  });

  it("não devolve negativo quando os relógios discordam", () => {
    expect(warehouseWaitMinutes({
      created_at: "2026-09-08T10:00:00.000Z",
      closed_at: "2026-09-08T09:55:00.000Z",
    }, NOW)).toBe(0);
  });

  it("devolve null quando a data não se lê", () => {
    expect(warehouseWaitMinutes({ created_at: "não é uma data" }, NOW)).toBeNull();
  });
});

describe("formatWarehouseWait", () => {
  it("escreve os minutos sem o '0h' à frente", () => {
    expect(formatWarehouseWait({ created_at: "2026-09-08T10:35:00.000Z" }, NOW)).toBe("12m");
  });

  it("passa a horas quando a espera passa da hora", () => {
    expect(formatWarehouseWait({ created_at: "2026-09-08T09:40:00.000Z" }, NOW)).toBe("1h 07m");
  });

  it("dá um travessão quando não há data para ler", () => {
    expect(formatWarehouseWait({ created_at: "" }, NOW)).toBe("—");
  });
});
