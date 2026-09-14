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

/**
 * O único estado com que o poll fecha uma espera.
 *
 * `index.ts` do `intouch-poll` abre a ordem em `open` e fecha-a em `closed`, no
 * ciclo em que o iTouching diz que a máquina voltou a andar. Qualquer outro fim
 * — `force_closed`, à cabeça — foi uma pessoa a arrumar a ordem, e o carimbo
 * mede quando alguém reparou nela, não quanto tempo a linha esperou.
 */
const CLOSED_BY_THE_POLL = "closed";

/** O que a matriz lê para marcar a célula com †. Ver `isSystemClosed`. */
const NOT_POLL_CLOSED_NOTE = "[auto-closed: not closed by the iTouching poll]";

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
  status?: string | null;
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

function closedByAHuman(wo: WarehouseWoRow): boolean {
  return !!endOfWait(wo) && (wo.status ?? CLOSED_BY_THE_POLL) !== CLOSED_BY_THE_POLL;
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
      // A WO-1027 é o caso que obrigou a esta linha: aberta a 09/09 às 09:02 e
      // `force_closed` a 13/09 às 05:52, 92h50m que pintavam a Line 2 de
      // vermelho a semana inteira e afogavam as esperas verdadeiras — todas
      // entre 1 minuto e 1h35m — no fundo da escala. Os minutos ficam, porque
      // dizem que alguém abriu a ordem; a marca diz que não são uma medição.
      notes: closedByAHuman(wo) ? NOT_POLL_CLOSED_NOTE : null,
    });
  }
  return out;
}

/**
 * As esperas que caem dentro do período e do filtro de linha.
 *
 * Existe para haver UMA regra de pertença. A matriz, os KPIs por cima dela, a
 * lista no PDF e a folha de Excel lêem todos desta lista, em vez de cada um
 * decidir por si o que é "estar no período" — que é como um total diz 4h e a
 * lista por baixo dele tem cinco linhas que somam 3h20.
 *
 * A regra de sobreposição é a mesma do `computeHeatmap`: uma espera conta se
 * tocar no intervalo, ainda que tenha começado antes ou acabe depois.
 */
export function filterWarehouseWaits<T extends WarehouseWoRow>(
  wos: readonly T[] | undefined | null,
  opts: { fromMs: number; toMs: number; line?: string; now?: number },
): T[] {
  const { fromMs, toMs, line = "all", now = Date.now() } = opts;
  return (wos ?? []).filter((wo) => {
    if (!isWarehouseWo(wo) || !wo.created_at) return false;
    if (line !== "all" && (wo.line_at_time ?? "—") !== line) return false;
    const start = new Date(wo.created_at).getTime();
    const endRaw = endOfWait(wo);
    const end = endRaw ? new Date(endRaw).getTime() : now;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return false;
    return end > fromMs && start < toMs;
  });
}
