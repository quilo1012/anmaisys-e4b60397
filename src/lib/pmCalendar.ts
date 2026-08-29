import { addDays, endOfMonth, endOfWeek, isSameDay, startOfMonth, startOfWeek } from "date-fns";

/**
 * A grelha mensal da preventiva: onde cada plano cai, e o que cai fora dela.
 *
 * A lista de planos responde "o que ha", ordenada por data. Nao responde "quanto ha na
 * terca" nem "que semana esta vazia" — e essas sao as duas perguntas de quem planeia.
 * Um mes desenhado responde as duas de relance.
 *
 * A logica vive aqui e nao no componente porque o que ha para acertar sao datas: a
 * semana que comeca a segunda, os dias que o mes vizinho arrasta para dentro da grelha,
 * e o plano de Junho por fazer que nao cabe na grelha de Setembro e e o mais urgente
 * que existe.
 */

/** O que a grelha le de um PmSchedule. O resto nao lhe interessa. */
export interface PmCalendarSchedule {
  next_due_at: string | null;
  active: boolean;
}

export interface PmCalendarDay<T> {
  /** Meia-noite local deste dia. */
  date: Date;
  /** Pertence ao mes ancora, ou foi arrastado pelo vizinho para fechar a semana. */
  inMonth: boolean;
  isToday: boolean;
  /** Os planos que vencem neste dia, do mais cedo para o mais tarde. */
  items: T[];
}

export interface PmMonthGrid<T> {
  weeks: PmCalendarDay<T>[][];
  /**
   * Planos vencidos antes do primeiro dia da grelha e ainda por fazer, do mais
   * atrasado para o menos. Nao cabem em nenhuma celula e sao os que mais custam.
   */
  overdueBefore: T[];
}

/** Segunda-feira. Uma semana de manutencao nao comeca ao domingo. */
const SEMANA = { weekStartsOn: 1 } as const;

const chave = (d: Date) => `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;

export function buildMonthGrid<T extends PmCalendarSchedule>(
  anchor: Date,
  schedules: T[],
  today: Date = new Date(),
): PmMonthGrid<T> {
  const inicio = startOfWeek(startOfMonth(anchor), SEMANA);
  const fim = endOfWeek(endOfMonth(anchor), SEMANA);
  const mes = anchor.getMonth();

  const porDia = new Map<string, T[]>();
  const atrasados: { s: T; due: Date }[] = [];

  const agendados = (schedules ?? [])
    .filter((s) => s.active && s.next_due_at)
    .map((s) => ({ s, due: new Date(s.next_due_at as string) }))
    .filter(({ due }) => !Number.isNaN(due.getTime()))
    .sort((a, b) => a.due.getTime() - b.due.getTime());

  for (const { s, due } of agendados) {
    if (due < inicio) {
      if (due < today) atrasados.push({ s, due });
      continue;
    }
    if (due > fim) continue;
    const k = chave(due);
    const lista = porDia.get(k);
    if (lista) lista.push(s);
    else porDia.set(k, [s]);
  }

  const weeks: PmCalendarDay<T>[][] = [];
  let cursor = inicio;
  while (cursor <= fim) {
    const semana: PmCalendarDay<T>[] = [];
    for (let i = 0; i < 7; i++) {
      semana.push({
        date: cursor,
        inMonth: cursor.getMonth() === mes,
        isToday: isSameDay(cursor, today),
        items: porDia.get(chave(cursor)) ?? [],
      });
      cursor = addDays(cursor, 1);
    }
    weeks.push(semana);
  }

  return { weeks, overdueBefore: atrasados.map(({ s }) => s) };
}
