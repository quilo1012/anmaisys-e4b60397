/**
 * A máquina que o mapa nomeia pertence à linha que o mapa nomeia?
 *
 * PORQUE É QUE ISTO É UM FICHEIRO. Uma ordem automática não escolhe linha nem
 * máquina: copia as duas da linha do `intouch_machine_map`, tal como lá estão
 * (`machine: m.machine_name ?? m.intouch_machine_name`, `line_id: m.line_id`).
 * Os dois campos são escolhidos em dois dropdowns independentes, gravados em
 * dois PATCHes separados, sem `unique` nem `check` na base e sem nada que os
 * confronte um com o outro — a página de mapeamento nem sequer lê o `line_id`
 * das máquinas que oferece. Uma escolha trocada num campo não deixa marca em
 * lado nenhum e todos os ecrãs a jusante herdam-na como se fosse leitura do
 * iTouching.
 *
 * O QUE ISSO CUSTOU. A 17/08 às 19:07 o ecrã do iTouching mostrava "Label
 * Issue" na FILLER LINE 1. A WO-2026-000900 abriu na GEL Line, na Gel Machine,
 * assinada por "GEL Line Leader" — porque é isso que a linha do mapa dizia. A
 * manutenção foi chamada a uma linha que estava a trabalhar e a que parou não
 * tinha ordem nenhuma.
 *
 * PORQUE É `machines.line_id` O ÁRBITRO. É a única coluna desta base que diz a
 * que linha uma máquina pertence — `machines.line` e `machines.current_line`
 * são texto solto e o mapa é precisamente o que está sob suspeita.
 *
 * PORQUE É QUE UM CONFLITO TRAVA A ORDEM EM VEZ DE A CORRIGIR. Quando os dois
 * campos discordam, nenhum deles é de confiança: pode estar errada a linha
 * escolhida ou a máquina escolhida, e a única coisa que o iTouching garante é
 * o `intouch_machine_name`. Adivinhar qual dos dois vale seria abrir a ordem na
 * linha errada por outro caminho. O poll já trata assim a falta de mapeamento —
 * `(no line mapped)`, `(não está no mapa de códigos)` — e um mapeamento que se
 * contradiz é a mesma classe de coisa: o sistema não sabe onde a paragem foi.
 * Trava, e diz em voz alta qual é a linha do mapa e qual é a da máquina, para o
 * conflito se resolver no ecrã de mapeamento em segundos.
 *
 * O silêncio é deliberado nos casos em que não há contradição para achar: sem
 * nome de máquina, com uma máquina que a tabela não conhece, ou com uma máquina
 * registada sem linha. Não saber não é discordar, e travar aí calava ordens
 * legítimas de máquinas que só têm o registo incompleto.
 */

export interface MachineLineCheck {
  /** `intouch_machine_map.machine_name` — a nossa máquina escolhida à mão. */
  machineName: string | null | undefined;
  /** `intouch_machine_map.line_id` — a linha escolhida à mão, no mesmo ecrã. */
  mapLineId: string | null | undefined;
  /**
   * `machines.line_id` da máquina acima. `undefined` = a tabela não tem essa
   * máquina; `null` = tem-na, sem linha registada. Os dois calam a regra.
   */
  machineLineId?: string | null;
  /** Só para a mensagem: os nomes valem mais do que os UUIDs a quem a lê. */
  mapLineName?: string | null;
  machineLineName?: string | null;
}

export interface MachineLineVerdict {
  ok: boolean;
  /** Preenchido só quando `ok` é falso, pronto a entrar em `results.skipped`. */
  reason?: string;
}

export function checkMachineLine(input: MachineLineCheck): MachineLineVerdict {
  const { machineName, mapLineId, machineLineId } = input;

  // Nada para confrontar: sem máquina nomeada o poll cai no nome do iTouching,
  // e sem linha no mapa a ordem já é travada antes de chegar aqui.
  if (!machineName || !mapLineId) return { ok: true };

  // A tabela não conhece a máquina, ou conhece-a sem linha. Não é desacordo.
  if (machineLineId === undefined || machineLineId === null) return { ok: true };

  if (machineLineId === mapLineId) return { ok: true };

  const mapLbl = input.mapLineName ?? mapLineId;
  const machineLbl = input.machineLineName ?? machineLineId;
  return {
    ok: false,
    reason:
      `mapeamento contraditório — a máquina "${machineName}" pertence a ${machineLbl}, `
      + `mas está mapeada a ${mapLbl}. Nenhuma ordem foi aberta: corrija a linha `
      + `em iTouching Machine Mapping antes de a paragem poder ser atribuída.`,
  };
}
