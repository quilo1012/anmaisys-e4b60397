import type { OvertimeRequest, OvertimeResponse } from "./overtimeRequests";

/**
 * Quem disse que sim a um turno que entretanto mudou.
 *
 * As horas de um pedido são escritas à mão em dois campos `type="time"`. Não há conta
 * nenhuma a derivá-las, por isso um engano fica lá: a 13/10/2026 havia um pedido para
 * as **18:00–14:00** — vinte horas — onde era 18:00–06:00. Não havia forma de o
 * corrigir sem cancelar o pedido e recomeçar.
 *
 * Passa a haver, e a escolha de 12/10/2026 foi que corrigir não apaga respostas: quem
 * já tinha respondido fica ASSINALADO, para o supervisor saber a quem tem de ligar.
 * Apagar teria custado respostas verdadeiras para emendar uma gralha; deixar ficar em
 * silêncio comprometia uma pessoa com horas que nunca viu.
 *
 * A comparação é campo a campo, com os valores crus, e nunca com texto formatado: se a
 * base e o ecrã escrevessem a hora de maneiras diferentes — `06:00` e `06:00:00` — toda
 * a gente aparecia como desactualizada. É por isso que a resposta guarda três colunas e
 * não uma frase.
 */

/** `06:00` e `06:00:00` são a mesma hora. A base devolve segundos, o input não os põe. */
function sameTime(a: string | null | undefined, b: string | null | undefined): boolean {
  const trim = (v: string | null | undefined) => (v ?? "").trim().slice(0, 5);
  return trim(a) === trim(b);
}

/**
 * O turno que a pessoa viu, ou null se a resposta é anterior a isto ser guardado.
 *
 * Null não quer dizer "igual": quer dizer que não se sabe. Quem lê isto não deve
 * inventar a diferença nem esconder a dúvida — ver `answeredForDifferentHours`, que
 * responde `false`, e o ecrã, que nesse caso não assinala nada.
 */
export function windowAnswered(r: OvertimeResponse): { on_date: string; starts_at: string; ends_at: string } | null {
  if (!r.answered_for_date || !r.answered_for_starts_at || !r.answered_for_ends_at) return null;
  return {
    on_date: r.answered_for_date,
    starts_at: r.answered_for_starts_at,
    ends_at: r.answered_for_ends_at,
  };
}

/**
 * Se esta resposta foi dada a um turno diferente do que o pedido tem agora.
 *
 * Responde `false` quando não há instantâneo. É a direcção certa: assinalar uma
 * resposta antiga como "disse sim a outra coisa" sem saber a quê mandava o supervisor
 * telefonar a quem não era preciso, e a confiança no aviso perdia-se à primeira vez.
 */
export function answeredForDifferentHours(
  response: OvertimeResponse,
  request: Pick<OvertimeRequest, "on_date" | "starts_at" | "ends_at">,
): boolean {
  const seen = windowAnswered(response);
  if (!seen) return false;
  return seen.on_date !== request.on_date
    || !sameTime(seen.starts_at, request.starts_at)
    || !sameTime(seen.ends_at, request.ends_at);
}

/** Quantas das respostas precisam de ser reconfirmadas. Para o cabeçalho do cartão. */
export function countStale(
  responses: readonly OvertimeResponse[],
  request: Pick<OvertimeRequest, "on_date" | "starts_at" | "ends_at">,
): number {
  // Só os "sim" contam: um "não" dado a outras horas não obriga ninguém a nada, e
  // pô-lo na contagem enchia o aviso de gente que não é precisa.
  return responses.filter((r) => r.answer === "yes" && answeredForDifferentHours(r, request)).length;
}
