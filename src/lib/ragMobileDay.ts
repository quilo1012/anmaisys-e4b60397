import { addDays, addWeeks, format } from "date-fns";

/* O telemóvel lê a RAG um dia de cada vez.
   Vinte e uma colunas num ecrã de 360 px eram uma fita para rolar de lado, linha a
   linha, sem nunca ver o dia inteiro. No telemóvel escolhe-se um dia — ou a semana,
   que é a coluna do total — e a grelha passa a ter três colunas: Day, Night, Total.

   0..6 são segunda a domingo; WEEK é a vista do total da semana. */
export const WEEK = 7;
export type MobileDay = number;

/** O dia com que o telemóvel abre: hoje, se hoje cai na semana; senão segunda. */
export function defaultMobileDay(weekStart: Date, todayIso: string): MobileDay {
  for (let i = 0; i < 7; i++) {
    if (format(addDays(weekStart, i), "yyyy-MM-dd") === todayIso) return i;
  }
  return 0;
}

/** Dia anterior / seguinte. As setas atravessam a fronteira da semana: de segunda
 *  para trás é o domingo da semana anterior, de domingo para a frente é a segunda
 *  da seguinte. Da vista da semana, para trás é domingo e para a frente é a segunda
 *  seguinte — as setas andam por dias, nunca param no total. */
export function stepMobileDay(
  weekStart: Date,
  day: MobileDay,
  dir: -1 | 1,
): { weekStart: Date; day: MobileDay } {
  if (day === WEEK) {
    return dir === -1 ? { weekStart, day: 6 } : { weekStart: addWeeks(weekStart, 1), day: 0 };
  }
  const next = day + dir;
  if (next < 0) return { weekStart: addWeeks(weekStart, -1), day: 6 };
  if (next > 6) return { weekStart: addWeeks(weekStart, 1), day: 0 };
  return { weekStart, day: next };
}

/** Um gesto conta como passar de dia quando é claramente horizontal e comprido o
 *  bastante para não ser um toque num número ou o polegar a rolar a página. */
export function swipeDirection(dx: number, dy: number, minPx = 60): -1 | 0 | 1 {
  if (Math.abs(dx) < minPx) return 0;
  if (Math.abs(dx) < Math.abs(dy) * 1.5) return 0;
  // Arrastar para a esquerda traz o dia seguinte, como a página de um livro.
  return dx < 0 ? 1 : -1;
}
