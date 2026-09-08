import { describe, it, expect } from "vitest";
// Fora de `src` de propósito, como em `intouchStopReading.test.ts`: a regra é do
// poller e vive com ele. O teste atravessa a fronteira; a regra não.
import { decideWarehouseStop, warehouseStopMinutes } from "../../supabase/functions/intouch-poll/warehouseStop";

/** O código real do iTouching para "Warehouse/Awaiting Packaging". */
const WAREHOUSE = "5dd6a44d-9f0a-4c00-8ccb-f65691a5bc5d";
/** "Changeover" — activo, não pede ordem de manutenção nem de warehouse. */
const CHANGEOVER = "c63bb2c7-21dd-4925-95d8-ba94834d9dc7";

function openWo(code: string, openedAt = "2026-09-08T10:00:00.000Z") {
  return { id: "wo-1", woNumber: 901, code, openedAt };
}

describe("decideWarehouseStop", () => {
  it("abre a ordem quando a linha entra em Warehouse/Awaiting Packaging", () => {
    const d = decideWarehouseStop({
      isDown: true,
      codeKey: WAREHOUSE,
      raisesWarehouseWo: true,
      openWo: null,
    });
    expect(d.open).toBe(true);
    expect(d.close).toBeNull();
  });

  it("não abre uma segunda ordem enquanto a mesma paragem dura", () => {
    // O poll corre de 60 em 60 segundos. Uma espera de 47 minutos veria este
    // caminho 47 vezes; só a primeira pode abrir alguma coisa.
    const d = decideWarehouseStop({
      isDown: true,
      codeKey: WAREHOUSE,
      raisesWarehouseWo: true,
      openWo: openWo(WAREHOUSE),
    });
    expect(d.open).toBe(false);
    expect(d.close).toBeNull();
  });

  it("fecha a ordem quando a máquina volta a andar", () => {
    const d = decideWarehouseStop({
      isDown: false,
      codeKey: "",
      raisesWarehouseWo: false,
      openWo: openWo(WAREHOUSE),
    });
    expect(d.close).toEqual({ woId: "wo-1", woNumber: 901, openedAt: "2026-09-08T10:00:00.000Z" });
    expect(d.open).toBe(false);
  });

  it("fecha a ordem quando a paragem passa a ser outra coisa", () => {
    // A espera do warehouse acabou e a linha ficou em changeover: a ordem do
    // warehouse já não mede nada, e deixá-la aberta contaria o changeover como
    // tempo de espera de embalagem.
    const d = decideWarehouseStop({
      isDown: true,
      codeKey: CHANGEOVER,
      raisesWarehouseWo: false,
      openWo: openWo(WAREHOUSE),
    });
    expect(d.close).not.toBeNull();
    expect(d.open).toBe(false);
  });

  it("fecha uma e abre outra quando um código de warehouse sucede a outro", () => {
    const OUTRO = "aaaaaaaa-0000-0000-0000-000000000000";
    const d = decideWarehouseStop({
      isDown: true,
      codeKey: OUTRO,
      raisesWarehouseWo: true,
      openWo: openWo(WAREHOUSE),
    });
    expect(d.close?.woId).toBe("wo-1");
    expect(d.open).toBe(true);
  });

  it("não faz nada numa paragem que não é do warehouse", () => {
    const d = decideWarehouseStop({
      isDown: true,
      codeKey: CHANGEOVER,
      raisesWarehouseWo: false,
      openWo: null,
    });
    expect(d.open).toBe(false);
    expect(d.close).toBeNull();
  });

  it("não faz nada numa máquina a trabalhar sem ordem aberta", () => {
    const d = decideWarehouseStop({
      isDown: false,
      codeKey: "",
      raisesWarehouseWo: false,
      openWo: null,
    });
    expect(d.open).toBe(false);
    expect(d.close).toBeNull();
  });

  it("compara os códigos sem se importar com maiúsculas nem espaços", () => {
    // O iTouching devolve o GUID em maiúsculas; o mapa guarda-o em minúsculas.
    // Se a comparação falhasse, cada poll fechava a ordem e abria outra — uma
    // ordem por minuto durante toda a espera.
    const d = decideWarehouseStop({
      isDown: true,
      codeKey: WAREHOUSE,
      raisesWarehouseWo: true,
      openWo: openWo(" 5DD6A44D-9F0A-4C00-8CCB-F65691A5BC5D "),
    });
    expect(d.open).toBe(false);
    expect(d.close).toBeNull();
  });

  it("fecha uma ordem órfã que ficou sem código nenhum gravado", () => {
    const d = decideWarehouseStop({
      isDown: true,
      codeKey: WAREHOUSE,
      raisesWarehouseWo: true,
      openWo: openWo(""),
    });
    expect(d.close?.woId).toBe("wo-1");
    expect(d.open).toBe(true);
  });
});

describe("warehouseStopMinutes", () => {
  it("conta os minutos da espera", () => {
    expect(warehouseStopMinutes("2026-09-08T10:00:00.000Z", "2026-09-08T10:47:00.000Z")).toBe(47);
  });

  it("arredonda para o minuto mais próximo", () => {
    expect(warehouseStopMinutes("2026-09-08T10:00:00.000Z", "2026-09-08T10:05:40.000Z")).toBe(6);
  });

  it("nunca devolve zero — uma paragem que aconteceu durou pelo menos um minuto", () => {
    // Mesma regra que `closeProdDowntime` já aplica. Uma ordem com 0 minutos
    // lê-se como uma ordem que não mediu nada, e esta existe para medir.
    expect(warehouseStopMinutes("2026-09-08T10:00:00.000Z", "2026-09-08T10:00:10.000Z")).toBe(1);
  });

  it("nunca devolve um número negativo quando os relógios discordam", () => {
    expect(warehouseStopMinutes("2026-09-08T10:05:00.000Z", "2026-09-08T10:00:00.000Z")).toBe(1);
  });
});
