/**
 * As esperas do armazém, na forma que a matriz de padrões já sabe ler.
 *
 * A matriz da manutenção agrega com `computeHeatmap`, e o armazém faz a mesma
 * pergunta — que linha esteve parada, em que dia e em que turno — sobre uma
 * tabela diferente. Este módulo é só a tradução: uma ordem de `warehouse_service`
 * a virar `HeatmapRecord`. A aritmética não é copiada, é a mesma função.
 *
 * O que ele NÃO faz é somar isto ao downtime de produção. Uma espera do armazém
 * nunca contou como avaria de linha, e continua a não contar — ver a migração
 * `20260919090000` e o texto no cabeçalho do ecrã do armazém.
 */
import type { HeatmapRecord } from "@/lib/downtimeHeatmap";

/** O `wo_type` que o poll do iTouching carimba na ordem que abre por espera. */
export const WAREHOUSE_WO_TYPE = "warehouse_service";

export interface WarehouseWoRow {
  id?: string | null;
  wo_type?: string | null;
  /** A linha que ficou à espera. `machine` traz a variante física ("Line 5A"). */
  line_at_time?: string | null;
  machine?: string | null;
  warehouse_location?: string | null;
  created_at?: string | null;
  closed_at?: string | null;
  finished_at?: string | null;
}

export function isWarehouseWo(wo: WarehouseWoRow): boolean {
  return wo?.wo_type === WAREHOUSE_WO_TYPE;
}

/**
 * O fim da espera, com a mesma regra que `warehouseWaitMinutes`.
 *
 * Escrito uma vez e usado pelos dois: a célula da matriz e a coluna "Wait" da
 * tabela por baixo dela mostram o mesmo número, ou o ecrã contradiz-se a si
 * próprio numa página só. `null` quer dizer aberta — e aí `computeHeatmap`
 * conta até agora, exactamente como a coluna faz.
 */
function endOfWait(wo: WarehouseWoRow): string | null {
  return wo.closed_at ?? wo.finished_at ?? null;
}

export function toWarehouseHeatmapRecords(
  wos: readonly WarehouseWoRow[] | undefined | null,
): HeatmapRecord[] {
  const out: HeatmapRecord[] = [];
  for (const wo of wos ?? []) {
    if (!isWarehouseWo(wo)) continue;
    // Sem abertura não há espera para medir. Deixar `computeHeatmap` datá-la de
    // hoje poria uma linha inteira de minutos inventados na coluna de hoje.
    if (!wo.created_at) continue;
    out.push({
      // Um pedido escrito à mão no diálogo "New Request" não tem linha parada:
      // fica em `null` e a matriz junta-o na fila "—". Deixá-lo cair calado
      // seria pior — some da matriz e continua na tabela logo abaixo.
      line: wo.line_at_time ?? null,
      started_at: wo.created_at,
      ended_at: endOfWait(wo),
      source: "wo_event",
      id: wo.id ?? null,
    });
  }
  return out;
}
