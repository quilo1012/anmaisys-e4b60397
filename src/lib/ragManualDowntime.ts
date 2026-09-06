/**
 * Quando é que os minutos escritos à mão em `rag_weekly_entries.downtime_min` podem
 * substituir o downtime calculado a partir das ordens de trabalho.
 *
 * A grelha do RAG Weekly tem duas fontes de downtime e escolhe uma por célula: os
 * minutos derivados dos WO Requests (cortados pela janela do turno) e, quando não há
 * nenhum, o total que alguém escreveu na célula. A segunda fonte não sabe nada sobre
 * turnos: aceita qualquer número em qualquer célula, e a célula não pergunta se a
 * linha chegou a trabalhar naquele turno.
 *
 * Foi assim que o domingo 06/09/2026 abriu com 1:30 de paragem na noite da Line 4.
 * Ao fim-de-semana a fábrica só faz turno de dia: não havia `production_sessions`,
 * nem plano, nem produção — a coluna NIGHT mostrava travessão em tudo menos no
 * downtime, e esses 90 minutos somavam ao total da linha e ao total da semana. O PDF,
 * que só lê os buckets automáticos, imprimia outro número. É por isso que "não bate".
 *
 * A regra aqui é a única coisa que faltava perguntar: **um turno que a linha não
 * trabalhou não tem paragens para contar**. Um turno planeado que não produziu nada
 * continua a ter — parar a noite inteira é exactamente o que a coluna existe para
 * mostrar —, e por isso o plano e o actual contam tanto como a sessão.
 */

/** O que se sabe de uma célula (data × linha × turno) antes de decidir o downtime. */
export interface RagCellDowntimeInput {
  /** `rag_weekly_entries.downtime_min` — o total escrito à mão. */
  manualMinutes: number;
  /** Minutos já derivados dos WO Requests para esta célula. */
  autoMinutes: number;
  /** Existe `production_sessions` para esta data + linha + turno. */
  hasSession: boolean;
  planQty: number;
  actualQty: number;
}

/**
 * Se a linha trabalhou o turno. Uma sessão prova-o; um plano ou uma quantidade
 * produzida também, porque a sessão pode ainda não ter sido aberta e o quadro é
 * escrito antes de ser sincronizado.
 */
export function shiftWasWorked(cell: {
  hasSession: boolean;
  planQty: number;
  actualQty: number;
}): boolean {
  if (cell.hasSession) return true;
  return num(cell.planQty) > 0 || num(cell.actualQty) > 0;
}

/**
 * Os minutos manuais que a célula pode mostrar: nenhuns quando as ordens de trabalho
 * já responderam, e nenhuns quando a linha não trabalhou aquele turno.
 */
export function manualDowntimeFallbackMinutes(cell: RagCellDowntimeInput): number {
  if (num(cell.autoMinutes) > 0) return 0;
  const manual = num(cell.manualMinutes);
  if (manual <= 0) return 0;
  return shiftWasWorked(cell) ? manual : 0;
}

function num(v: unknown): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
}
