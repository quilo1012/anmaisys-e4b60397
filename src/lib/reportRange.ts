import { endOfDay, format } from "date-fns";

/**
 * O intervalo aberto, resolvido sem inventar trinta dias.
 *
 * `getPresetRange("all")` devolve `{}` de propósito — um intervalo aberto, filtro
 * nenhum — e há um teste em `dateRangeFilter.test.ts` a fixar esse contrato. Quem o
 * consome é que escrevia `range.from ?? subDays(new Date(), 30)`, e aí o chip do filtro
 * dizia "All time" enquanto os números por baixo eram o último mês. Um relatório que
 * mente sobre o seu próprio período é pior do que um relatório que não existe: é
 * assinado, impresso e arquivado na mesma.
 *
 * O chão é uma sentinela e não uma data verdadeira. A alternativa era um `min(created_at)`
 * por tabela — mais uma ida ao servidor por painel, para responder a uma pergunta que
 * um `gte` a 2000 já responde: nenhuma linha desta fábrica é anterior a ela.
 *
 * Vive em `lib` e recebe `{ from?, to? }` em vez de importar o `DateRange` do
 * `DateRangeFilter`: uma função de datas não passa a depender de um componente React
 * só para saber o nome de dois campos.
 */
export const OPEN_RANGE_START = new Date(Date.UTC(2000, 0, 1));

export interface ResolvedRange {
  startDate: Date;
  endDate: Date;
  /** O utilizador pediu "desde sempre" — a data de início é a sentinela, não uma escolha. */
  openStart: boolean;
  /** Sem fim pedido: corre até agora, e nunca até ao futuro. */
  openEnd: boolean;
}

export function resolveReportRange(
  range: { from?: Date; to?: Date },
  now: Date = new Date(),
): ResolvedRange {
  return {
    startDate: range.from ?? OPEN_RANGE_START,
    endDate: range.to ?? endOfDay(now),
    openStart: !range.from,
    openEnd: !range.to,
  };
}

/**
 * O período dito por extenso, para o cabeçalho e o rodapé do papel.
 *
 * Um intervalo aberto imprime "All time" e não "01/01/2000" — a sentinela é um detalhe
 * da consulta, não uma data que alguém escolheu. Mas continua a levar a data do fim:
 * uma folha impressa sem data é uma folha que ninguém consegue arquivar.
 */
export function reportPeriodLabel(r: ResolvedRange, pattern = "dd/MM/yyyy HH:mm"): string {
  const end = format(r.endDate, pattern);
  return r.openStart ? `All time — up to ${end}` : `${format(r.startDate, pattern)} — ${end}`;
}

/**
 * O período dito no meio de uma frase — "os 90 dias até 12/08/2026".
 *
 * Arredonda para cima, e não para o mais próximo, porque um período tem de dizer o
 * mesmo número que o controlo que o escolheu. `getPresetRange("90d")` vai de
 * `startOfDay(hoje−89)` até agora: às 11h da manhã são 89,46 dias decorridos, e um
 * `Math.round` escrevia "os 89 dias" por baixo de um chip que diz "Last 90 days".
 * Dois números para a mesma janela no mesmo ecrã, e o leitor não tem como saber qual
 * deles é o que os cálculos usaram.
 *
 * O valor fraccionário continua a ser o que divide as falhas — o denominador honesto
 * é o tempo mesmo decorrido. O que arredonda é a frase, que é um nome e não uma conta.
 */
export function reportSpanPhrase(r: ResolvedRange, pattern = "dd/MM/yyyy"): string {
  if (r.openStart) return "the whole record";
  const days = Math.max(1, Math.ceil((r.endDate.getTime() - r.startDate.getTime()) / 86_400_000));
  return `the ${days} day${days === 1 ? "" : "s"} to ${format(r.endDate, pattern)}`;
}
