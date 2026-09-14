/**
 * Quantas colunas o painel de linhas leva, para que a última fila não fique com um
 * buraco.
 *
 * Três colunas fixas foram escolhidas quando a fábrica tinha nove linhas, e nove em
 * três filas de três fecha o painel. Com sete linhas — que é o que um dia com a Line 3
 * e a GEL paradas mostra — as mesmas três colunas deixam a Tablet Line sozinha ao lado
 * de dois terços de fundo vazio, e um painel de instrumentos com um vazio desse
 * tamanho lê-se como um ecrã que não acabou de carregar. Quatro colunas resolvem esse
 * caso e estragam o de nove, que passaria a 4+4+1.
 *
 * Portanto não é uma constante, é uma conta: das duas larguras que cabem num monitor
 * grande, fica a que deixa menos células vazias na última fila. Só acima de 2xl, que é
 * onde um cartão de um quarto de largura ainda tem espaço para o número de 40 px; em
 * xl continuam a ser três.
 *
 * Empate fica com a mais densa — mais linhas acima da dobra, e nenhuma das duas tem
 * buraco menor que a outra.
 */
export function wideBoardColumns(lineCount: number): 3 | 4 {
  if (lineCount <= 0) return 3;
  const emptyCellsWith = (cols: number) => (cols - (lineCount % cols)) % cols;
  return emptyCellsWith(4) <= emptyCellsWith(3) ? 4 : 3;
}

/** A classe de grelha correspondente, escrita por extenso para o Tailwind a ver. */
export const WIDE_BOARD_GRID: Record<3 | 4, string> = {
  3: "2xl:grid-cols-3",
  4: "2xl:grid-cols-4",
};
