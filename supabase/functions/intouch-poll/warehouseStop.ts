/**
 * Quando uma espera do armazém abre — e fecha — a sua própria ordem.
 *
 * O PROBLEMA. "Warehouse/Awaiting Packaging" é a linha parada à espera de
 * embalagem. O tempo já era medido: o código tem `requires_wo = false`, por isso
 * o poll manda-o para `production_downtimes` e os minutos entram no OEE. Só que
 * `production_downtimes` é uma tabela de contabilidade — ninguém do armazém a
 * abre, e ninguém do armazém sabia que a linha estava à espera dele. Nos 30 dias
 * até 07/09 foram 2 a 5 esperas por dia, com média entre 5 e 28 minutos e um
 * máximo de 67. Tudo isso medido e invisível.
 *
 * PORQUE É UM FICHEIRO À PARTE, e não mais quinze linhas dentro do handler de
 * mil linhas: esta decisão corre uma vez por máquina por minuto e é a única
 * coisa que decide se uma ordem existe. As duas regras que interessam — não
 * abrir uma segunda ordem para a paragem que já tem uma, e fechar a que ficou —
 * são exactamente as que se partem em silêncio. Uma comparação de GUID que
 * falhasse por causa de maiúsculas abriria e fecharia uma ordem por minuto
 * durante toda a espera, e nada no ecrã diria porquê. Aqui têm teste.
 *
 * O QUE ISTO NÃO FAZ. Não substitui `production_downtimes`: a paragem continua a
 * ser contada lá, como sempre foi, porque é isso que alimenta o OEE e o
 * `planned_stop_minutes()`. A ordem que sai daqui é `wo_type = 'warehouse_service'`,
 * que por desenho nunca abre `downtime_events` (ver
 * `20260731120000_preventive_work_orders.sql`) — logo os mesmos minutos não são
 * cobrados duas vezes. É uma camada por cima da medição, não outra medição.
 *
 * E não chama a manutenção. A ordem é do armazém, aparece em
 * `/dashboard/warehouse`, e o único aviso que gera vai para quem tem o papel
 * `warehouse`.
 */

/** Normaliza um GUID do iTouching para comparação: sem espaços, em minúsculas. */
function key(value: unknown): string {
  return String(value ?? "").trim().toLowerCase();
}

export interface OpenWarehouseWo {
  id: string;
  woNumber: number;
  /** `work_orders.intouch_downtime_code` da ordem aberta, tal como está gravado. */
  code: string;
  /** `work_orders.created_at` — o instante em que a espera começou a ser contada. */
  openedAt: string;
}

export interface WarehouseStopInput {
  /** `readStop().isDown` — há um motivo activo no painel. */
  isDown: boolean;
  /** O código actual, já normalizado. String vazia quando não há paragem. */
  codeKey: string;
  /** `intouch_stop_code_map.raises_warehouse_wo` para o código ACTUAL. */
  raisesWarehouseWo: boolean;
  /** A ordem de armazém ainda aberta nesta máquina, se houver. */
  openWo: OpenWarehouseWo | null;
}

export interface WarehouseStopDecision {
  /** A ordem a fechar agora, com o instante de abertura para calcular a duração. */
  close: { woId: string; woNumber: number; openedAt: string } | null;
  /** Abrir uma ordem nova para a paragem actual. */
  open: boolean;
}

/**
 * As duas perguntas, por esta ordem: a ordem que está aberta ainda serve? e a
 * paragem que está a acontecer já tem ordem?
 *
 * Podem ser as duas verdadeiras no mesmo minuto — um código de armazém a suceder
 * a outro fecha a primeira e abre a segunda — e é por isso que a resposta não é
 * uma escolha entre acções, mas as duas ao mesmo tempo.
 */
export function decideWarehouseStop(input: WarehouseStopInput): WarehouseStopDecision {
  const { isDown, codeKey, raisesWarehouseWo, openWo } = input;

  // Uma ordem aberta continua a servir enquanto a máquina estiver parada NO
  // MESMO código. Volta a andar, ou muda de motivo, e o que ela media acabou.
  const stillTheSameStop =
    !!openWo && isDown && key(openWo.code) !== "" && key(openWo.code) === key(codeKey);

  const close = openWo && !stillTheSameStop
    ? { woId: openWo.id, woNumber: openWo.woNumber, openedAt: openWo.openedAt }
    : null;

  const open = isDown && raisesWarehouseWo && !stillTheSameStop;

  return { close, open };
}

/**
 * Quantos minutos durou a espera.
 *
 * Mínimo de um, como em `closeProdDowntime`: uma ordem que diz zero minutos
 * lê-se como uma ordem que não mediu nada, e esta existe só para medir.
 *
 * O mesmo mínimo cobre o fim que chega antes do princípio. O `created_at` é
 * carimbado pelo Postgres e o `now` é do Deno — não é o mesmo relógio, e uma
 * diferença negativa não é uma espera ao contrário, é ruído. Devolver o seu
 * valor absoluto seria inventar minutos que ninguém esperou.
 */
export function warehouseStopMinutes(openedAt: string, endIso: string): number {
  const startMs = new Date(openedAt).getTime();
  const endMs = new Date(endIso).getTime();
  if (!Number.isFinite(startMs) || !Number.isFinite(endMs)) return 1;
  return Math.max(1, Math.round((endMs - startMs) / 60000));
}
