import {
  addDays,
  addMonths,
  differenceInCalendarDays,
  endOfMonth,
  endOfYear,
  format,
  isSameDay,
  isSameMonth,
  isSameYear,
  startOfMonth,
  startOfYear,
} from "date-fns";

/**
 * Andar com o período para trás e para a frente, pelo seu próprio tamanho.
 *
 * Este ecrã tinha três manípulos ligados ao mesmo veio: um alternador `Daily | Monthly`,
 * um navegador de mês com as suas próprias setas, e dois botões de atalho — e o campo
 * `Period`, que já sabia fazer o trabalho dos três. Escolher num deles não mexia nos
 * outros, e era daí que vinha a sensação de que a folha não obedecia.
 *
 * O que fica é uma pergunta só: qual é o período. E uma vez que ele está escolhido, a
 * pergunta seguinte é sempre a mesma — "e o anterior?". Uma seta para cada lado
 * responde-a sem obrigar ninguém a reabrir o calendário e a contar dias.
 *
 * O passo é o tamanho do próprio intervalo, e é essa a decisão que faz isto valer a
 * pena: um dia anda um dia, uma semana anda uma semana, um mês anda um mês. Quem está
 * a olhar para uma quarta-feira quer a terça; quem está a olhar para Agosto quer Julho,
 * e Julho tem 31 dias enquanto Setembro tem 30 — por isso o mês não pode ser "mais
 * trinta e um dias", tem de ser o mês.
 */
export type StepDirection = -1 | 1;

export interface SteppableRange {
  from?: Date;
  to?: Date;
}

/** Um intervalo assente exactamente num mês de calendário, do dia 1 ao último. */
function isWholeMonth(from: Date, to: Date): boolean {
  return isSameDay(from, startOfMonth(from)) && isSameDay(to, endOfMonth(from));
}

/** A mesma data, com a hora de outra — para o mês, que muda o dia debaixo dos pés. */
function withTimeOf(date: Date, source: Date): Date {
  const out = new Date(date);
  out.setHours(source.getHours(), source.getMinutes(), source.getSeconds(), source.getMilliseconds());
  return out;
}

/**
 * O período seguinte ou o anterior, do mesmo tamanho.
 *
 * `null` quando o intervalo tem uma ponta aberta — o "All time" não tem tamanho, e o
 * que não tem tamanho não anda. Quem chama esconde as setas nesse caso.
 */
export function stepRange(range: SteppableRange, direction: StepDirection): { from: Date; to: Date } | null {
  const { from, to } = range;
  if (!from || !to) return null;

  if (isWholeMonth(from, to)) {
    const nextFrom = addMonths(from, direction);
    return { from: nextFrom, to: withTimeOf(endOfMonth(nextFrom), to) };
  }

  const span = differenceInCalendarDays(to, from) + 1;
  return { from: addDays(from, direction * span), to: addDays(to, direction * span) };
}

/**
 * O nome do período, para o único sítio que ainda o diz.
 *
 * O título da página dizia-o, o alternador `Daily | Monthly` dizia-o e este campo
 * dizia-o; ficou só este campo, e por isso ele tem de o dizer inteiro. "Custom ·
 * 26/08/26 – 26/08/26" obriga o leitor a ler duas datas e a reparar que são a mesma
 * para descobrir que está a olhar para um dia — o trabalho que o rótulo devia
 * poupar-lhe.
 *
 * A regra é dizer o menos que chegue para não haver dúvida: um dia diz o dia da semana,
 * porque a pergunta que se faz a um turno é "que dia foi este"; um mês diz o nome do
 * mês; dois extremos no mesmo mês dizem o mês uma vez só.
 */
export function periodLabel(from?: Date, to?: Date): string {
  if (!from && !to) return "All time";
  if (from && !to) return `From ${format(from, "d MMM yyyy")}`;
  if (!from && to) return `Until ${format(to, "d MMM yyyy")}`;
  if (!from || !to) return "All time";

  if (isSameDay(from, to)) return format(from, "EEE d MMM yyyy");
  if (isSameDay(from, startOfYear(from)) && isSameDay(to, endOfYear(from))) return format(from, "yyyy");
  if (isWholeMonth(from, to)) return format(from, "MMMM yyyy");
  if (isSameMonth(from, to)) return `${format(from, "d")} – ${format(to, "d MMM yyyy")}`;
  if (isSameYear(from, to)) return `${format(from, "d MMM")} – ${format(to, "d MMM yyyy")}`;
  return `${format(from, "d MMM yyyy")} – ${format(to, "d MMM yyyy")}`;
}
