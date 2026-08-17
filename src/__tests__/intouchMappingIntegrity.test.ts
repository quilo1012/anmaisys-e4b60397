import { describe, it, expect } from "vitest";
// Fora de `src` pela mesma razão que `readStop`: a regra é do poller e vive com
// ele, para não existir uma segunda cópia na app a dizer outra coisa.
import { checkMachineLine } from "../../supabase/functions/intouch-poll/mappingIntegrity";

/**
 * O caso que deu origem a isto, 17/08 às 19:07: o iTouching mostrava "Label
 * Issue" na FILLER LINE 1, e a WO-2026-000900 nasceu na GEL Line, na Gel
 * Machine, com "GEL Line Leader" como requerente.
 *
 * A ordem não inventou nada — copiou `machine_name` e `line_id` da linha do
 * `intouch_machine_map` tal como lá estavam. Os dois campos são escolhidos em
 * dois dropdowns independentes, sem constraint na base e sem nada que os
 * confronte, por isso uma máquina pode estar apontada a uma linha a que não
 * pertence e todos os ecrãs a jusante herdam o engano sem o poderem ver.
 *
 * `machines.line_id` é, nesta base, a única coluna que diz a que linha uma
 * máquina pertence. É contra ela que o mapa é confrontado.
 */
describe("checkMachineLine", () => {
  it("bloqueia a máquina apontada a uma linha que não é a dela — o caso da WO-900", () => {
    const r = checkMachineLine({
      machineName: "Gel Machine",
      mapLineId: "line-gel",
      machineLineId: "line-filler-1",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("Gel Machine");
  });

  it("deixa passar quando a máquina pertence mesmo à linha mapeada", () => {
    const r = checkMachineLine({
      machineName: "Gel Machine",
      mapLineId: "line-gel",
      machineLineId: "line-gel",
    });
    expect(r.ok).toBe(true);
  });

  it("não bloqueia quando o mapa não nomeia máquina nenhuma", () => {
    // O poll cai no nome do iTouching nesse caso; não há contradição para achar.
    const r = checkMachineLine({
      machineName: null,
      mapLineId: "line-gel",
      machineLineId: null,
    });
    expect(r.ok).toBe(true);
  });

  it("não bloqueia uma máquina que a tabela `machines` não conhece", () => {
    // Não saber não é o mesmo que discordar: uma máquina sem linha registada
    // não contradiz o mapa, e travar aqui seria calar ordens legítimas.
    const r = checkMachineLine({
      machineName: "Gel Machine",
      mapLineId: "line-gel",
      machineLineId: undefined,
    });
    expect(r.ok).toBe(true);
  });

  it("não bloqueia uma máquina registada sem linha", () => {
    const r = checkMachineLine({
      machineName: "Gel Machine",
      mapLineId: "line-gel",
      machineLineId: null,
    });
    expect(r.ok).toBe(true);
  });

  it("não se pronuncia quando o mapa ainda não tem linha — esse caso já é travado antes", () => {
    const r = checkMachineLine({
      machineName: "Gel Machine",
      mapLineId: null,
      machineLineId: "line-filler-1",
    });
    expect(r.ok).toBe(true);
  });

  it("diz as duas linhas em conflito, para a mensagem servir de instrução", () => {
    const r = checkMachineLine({
      machineName: "Gel Machine",
      mapLineId: "line-gel",
      machineLineId: "line-filler-1",
      mapLineName: "GEL Line",
      machineLineName: "Filler Line 1",
    });
    expect(r.ok).toBe(false);
    expect(r.reason).toContain("GEL Line");
    expect(r.reason).toContain("Filler Line 1");
  });
});
