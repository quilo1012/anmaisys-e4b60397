import type * as React from "react";

/**
 * As baías: a cor com que uma linha de enchimento se identifica.
 *
 * Numa nave, uma baía não se explica — está pintada no chão, e quem lá trabalha sabe
 * onde está antes de ler o letreiro. Um mapa de turno com onze linhas tem o mesmo
 * problema: o nome "Line 7" está escrito na fila, mas ninguém o lê, procura-o. A cor
 * resolve a procura; o nome confirma-a.
 *
 * Três decisões, e as três são restrições e não enfeite:
 *
 * 1. O arco é ciano→magenta (192°–327°) e não a roda toda. Verde, âmbar e vermelho são
 *    as três cores com que este sistema diz `go`, `hold` e `stop` (ver `lib/rail.ts`).
 *    Uma baía pintada de âmbar seria um andon aceso que ninguém mandou acender — e o
 *    mesmo ecrã tem, duas colunas à direita, linhas realmente pintadas de âmbar por
 *    lhes faltar o líder. O arco tem de acabar antes de lá chegar.
 *
 * 2. A cor é POSIÇÃO, não identidade avulsa. Dez passos iguais de 15° pelo arco, na
 *    ordem em que as linhas estão numeradas: aprende-se que as primeiras são frias e as
 *    últimas quentes, e a Line 6 acha-se sem se saber de cor que cor é a Line 6. Onze
 *    matizes escolhidos um a um seriam onze coisas para decorar.
 *
 * 3. O que não é linha numerada — o Tablet Line, as Capsules Machine — fica nos MEIOS
 *    passos, entre as baías. São máquinas de outra família, distinguem-se umas das
 *    outras (que é um bug que este ecrã já teve uma vez, quando as dobrava todas na
 *    palavra "Tablet"), e nunca colidem exactamente com uma linha de enchimento.
 *
 * A saturação e o valor não estão aqui: vêm de `--bay-s`/`--bay-l`, que viram com o
 * tema. No escuro a faixa tem de subir de valor e descer de croma, ou fica a brilhar
 * mais do que o número ao lado dela.
 */

const ARC_START = 192;
const ARC_STEP = 15;
const BAYS = 10;

/** Um número estável a partir do nome — para as máquinas, que não têm lugar na fila. */
function nameSlot(name: string): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % BAYS;
}

/**
 * O matiz da baía de uma linha, em graus.
 *
 * Depende só do nome — nunca do que está filtrado no ecrã. Uma cor que muda quando se
 * escolhe outro dia não identifica nada.
 */
export function bayHue(lineName: string | null | undefined): number {
  const n = String(lineName ?? "").toLowerCase().trim();
  const m = n.match(/line\s*(\d+)/);
  if (m) return ARC_START + (((parseInt(m[1], 10) - 1) % BAYS) * ARC_STEP);
  // Meio passo: a máquina fica entre duas baías, nunca em cima de uma.
  return ARC_START + nameSlot(n) * ARC_STEP + ARC_STEP / 2;
}

/** A tinta cheia da baía: a faixa do chão, o quadrado da placa, o nome na coluna. */
export function bayInk(lineName: string | null | undefined): string {
  return `hsl(${bayHue(lineName)} var(--bay-s) var(--bay-l))`;
}

/**
 * O banho do turno da noite, na cor da própria baía.
 *
 * O dia não leva banho nenhum: lê-se no fundo do cartão. Se os dois turnos levassem
 * cor, nenhum dos dois seria uma leitura — seriam duas.
 */
export function bayWash(lineName: string | null | undefined): string {
  return `hsl(${bayHue(lineName)} var(--bay-s) var(--bay-l) / var(--bay-wash))`;
}

/** O quadrado gravado que abre a placa da baía e acompanha o nome nos filtros. */
export function baySwatchStyle(lineName: string | null | undefined): React.CSSProperties {
  return { backgroundColor: bayInk(lineName) };
}

/**
 * A faixa pintada no chão da baía, e o que a noite lhe faz.
 *
 * `dim` é o turno da noite. A faixa não muda de cor — a baía é a mesma às seis da manhã
 * e às seis da tarde — muda de força. É a mesma decisão que o banho da fila: a cor diz
 * a linha, o tom diz a hora, e não há dois sítios a dizer a mesma coisa de maneiras
 * diferentes.
 */
export function baySpine(lineName: string | null | undefined, dim = false): string {
  return dim
    ? `hsl(${bayHue(lineName)} var(--bay-s) var(--bay-l) / 0.4)`
    : bayInk(lineName);
}
