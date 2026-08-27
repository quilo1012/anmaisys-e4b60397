import type * as React from "react";

/**
 * As baías: a cor com que uma linha de enchimento se identifica.
 *
 * Numa nave, uma baía não se explica — está pintada no chão, e quem lá trabalha sabe
 * onde está antes de ler o letreiro. Um mapa de turno com sete linhas tem o mesmo
 * problema: o nome "Line 3" está escrito na fila, mas ninguém o lê, procura-o. A cor
 * resolve a procura; o nome confirma-a.
 *
 * A cor não se inventa aqui. O quadro do Trello é o sítio onde o plano da semana é
 * feito, e cada linha já é uma lista com uma cor: a Line 1 é verde, a Line 2 é amarela,
 * a Line 3 é azul, a Line 4 é vermelha, a 5A e a 5B são rosa, a 6A e a 6B são lima.
 * Quem chega ao turno já traz essas seis cores decoradas do quadro. Um arco calculado
 * — por mais bem espaçado que fosse, e o anterior era — obrigava a mesma pessoa a
 * decorar um segundo alfabeto de cores para dizer as mesmas seis linhas. Duas
 * linguagens para uma coisa só é uma a mais.
 *
 * Três decisões:
 *
 * 1. O MATIZ é o do quadro, ponto. Vem dos valores do Trello, não de uma aproximação
 *    "parecida": é assim que a cor no ecrã e a cor no quadro se reconhecem como a mesma
 *    e não como duas primas.
 *
 * 2. O VALOR adapta-se ao fundo, o matiz não. O quadro do Trello é escuro e sustenta
 *    cores claras; esta folha é branca de dia. `--bay-lum` e `--bay-sat` afundam ou
 *    levantam a mesma cor conforme o tema, sem lhe tocar no matiz — a baía é a mesma
 *    às seis da manhã, às seis da tarde e no modo escuro.
 *
 * 3. O que o quadro não tem — o Tablet Line, as Capsules Machine, uma Line 7 que
 *    apareça — fica nas cores que o quadro não gastou: roxo, céu, laranja, cinza.
 *    Continuam a distinguir-se umas das outras (que é um bug que este ecrã já teve,
 *    quando dobrava três máquinas na palavra "Tablet") e nunca vestem a cor de uma das
 *    seis linhas do quadro. O Trello tem dez cores e a nave tem seis linhas e três
 *    máquinas: cabe. Se alguma vez entrar uma Line 7, entra nesta mesma prateleira e
 *    há que ir ver contra que máquina foi bater.
 *
 * O preço desta decisão está pago de olhos abertos: o verde, o âmbar e o vermelho são
 * também as três cores com que este sistema diz `go`, `hold` e `stop`. A baía nunca
 * entra pelo bordo de 3 px do `railEdge`, que é onde o estado fala, e a faixa da baía é
 * contínua enquanto um andon é pontual — mas quem pintar mais alguma coisa de amarelo
 * nesta folha tem de contar com a Line 2.
 */

/** Uma baía: matiz, croma e valor, tal como o quadro os tem. */
type Bay = readonly [h: number, s: number, l: number];

/**
 * As seis listas do quadro, pela ordem em que lá estão.
 *
 * A posição é o número da linha, por isso não há nada para decorar: a Line 4 é a quarta
 * cor do quadro porque é a quarta lista do quadro.
 */
const BOARD: readonly Bay[] = [
  [155, 57, 55],   // Line 1  — green  #4BCE97
  [46, 90, 62],    // Line 2  — yellow #F5CD47
  [215, 100, 67],  // Line 3  — blue   #579DFF
  [4, 91, 69],     // Line 4  — red    #F87168
  [323, 71, 68],   // Line 5  — pink   #E774BB  (5A e 5B, uma cor só, como no quadro)
  [84, 53, 53],    // Line 6  — lime   #94C748  (6A e 6B, idem)
];

/** O que o quadro não gastou, para o que o quadro não tem. */
const OFF_BOARD: readonly Bay[] = [
  [250, 75, 75],   // purple #9F8FEF
  [195, 65, 65],   // sky    #6CC3E0
  [25, 99, 69],    // orange #FEA362
  [217, 14, 58],   // grey   #8590A2
];

/** Um número estável a partir do nome — para as máquinas, que não têm lugar na fila. */
function nameSlot(name: string, mod: number): number {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return h % mod;
}

/**
 * A baía de uma linha.
 *
 * Depende só do nome — nunca do que está filtrado no ecrã. Uma cor que muda quando se
 * escolhe outro dia não identifica nada. Lê o número e ignora a letra: no quadro, a 5A e
 * a 5B são a mesma cor, porque são a mesma linha em dois lados.
 */
export function bayColor(lineName: string | null | undefined): Bay {
  const n = String(lineName ?? "").toLowerCase().trim();
  const m = n.match(/line\s*(\d+)/);
  if (m) {
    const i = parseInt(m[1], 10) - 1;
    // Uma linha nova, para lá das seis do quadro, veste o que o quadro não gastou.
    return i < BOARD.length ? BOARD[i] : OFF_BOARD[(i - BOARD.length) % OFF_BOARD.length];
  }
  return OFF_BOARD[nameSlot(n, OFF_BOARD.length)];
}

/** O matiz da baía, em graus — o do quadro. */
export function bayHue(lineName: string | null | undefined): number {
  return bayColor(lineName)[0];
}

/**
 * A cor escrita, com o tema pelo meio.
 *
 * O matiz passa intacto; o croma e o valor passam pelos tokens. É onde o mesmo verde do
 * quadro se afunda o suficiente para se ver sobre papel branco e se levanta o suficiente
 * para não gritar sobre um cartão escuro.
 */
function paint(bay: Bay, alpha?: string): string {
  const [h, s, l] = bay;
  const value = `${h} calc(${s}% * var(--bay-sat)) calc(${l}% * var(--bay-lum))`;
  return alpha ? `hsl(${value} / ${alpha})` : `hsl(${value})`;
}

/** A tinta cheia da baía: a faixa do chão, o quadrado da placa, o nome na coluna. */
export function bayInk(lineName: string | null | undefined): string {
  return paint(bayColor(lineName));
}

/**
 * O banho do turno da noite, na cor da própria baía.
 *
 * O dia não leva banho nenhum: lê-se no fundo do cartão. Se os dois turnos levassem
 * cor, nenhum dos dois seria uma leitura — seriam duas.
 */
export function bayWash(lineName: string | null | undefined): string {
  return paint(bayColor(lineName), "var(--bay-wash)");
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
  return dim ? paint(bayColor(lineName), "0.4") : bayInk(lineName);
}
