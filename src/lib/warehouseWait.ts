import { formatDurationCompact } from "@/lib/formatDuration";

/**
 * Há quanto tempo é que esta linha está à espera do armazém.
 *
 * A ordem de armazém existe para responder a isto e a mais nada. O ecrã já
 * mostrava a hora de abertura, que é a pergunta errada: ninguém lê "10:14" e
 * pensa "então são 43 minutos" enquanto sete linhas esperam ao mesmo tempo.
 *
 * Aberta, conta até agora e o número muda a cada render. Fechada, conta até ao
 * fecho e fica quieta — que é a mesma leitura que as notas da ordem levam.
 */
export interface WarehouseWaitRow {
  created_at: string;
  /** Preenchido pelo poll quando o iTouching diz que a linha voltou a andar. */
  closed_at?: string | null;
  finished_at?: string | null;
}

export function warehouseWaitMinutes(
  wo: WarehouseWaitRow,
  now: number = Date.now(),
): number | null {
  const start = new Date(wo.created_at).getTime();
  if (!Number.isFinite(start)) return null;
  const endRaw = wo.closed_at ?? wo.finished_at ?? null;
  const end = endRaw ? new Date(endRaw).getTime() : now;
  if (!Number.isFinite(end)) return null;
  // Nunca negativo: um fecho carimbado antes da abertura é ruído de relógios,
  // não uma espera ao contrário. Mesma regra que `warehouseStopMinutes` no poll.
  return Math.max(0, Math.round((end - start) / 60000));
}

/**
 * A mesma espera, escrita para a coluna.
 *
 * `formatDurationCompact` e não `formatMinutes`: a esmagadora maioria destas
 * esperas fica abaixo da hora — média entre 5 e 28 minutos nos 30 dias até 07/09
 * — e "0h 12m" em cada linha é o ruído que aquela função foi escrita para
 * evitar. Diz-o o seu próprio comentário.
 */
export function formatWarehouseWait(wo: WarehouseWaitRow, now: number = Date.now()): string {
  const mins = warehouseWaitMinutes(wo, now);
  return formatDurationCompact(mins === null ? null : mins * 60);
}
