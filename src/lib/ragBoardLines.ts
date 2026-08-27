/**
 * As linhas do quadro RAG, pela ordem em que a fábrica as lê.
 *
 * Vive fora da página por uma razão que este repositório já pagou uma vez: a tabela
 * de aliases do `ragLayoutParser` esteve meses a apontar para linhas que não existem
 * porque não havia forma de lhe tocar num teste. Uma regra de ordem que ninguém pode
 * verificar apodrece da mesma maneira.
 */

/** Postos que o quadro tem mas a tabela `lines` não. */
const BOARD_ONLY = ["Gel Packing"];

/** Nunca são linhas de produção — são consumíveis que alguém pôs na tabela. */
const EXCLUDED = ["sealer", "printer ink"];

/**
 * O fim do quadro, por esta ordem. São as três máquinas que correm sozinhas, sem
 * enchimento nem packing à frente, e é por isso que ficam juntas e em último.
 * "gel line" e "gel machine" são o mesmo posto com duas grafias — a base diz a
 * primeira, a iTouching diz a segunda.
 */
const TAIL = ["capsules machine 1", "capsules machine 2", "gel line", "gel machine"];

const key = (n: string) => n.trim().toLowerCase();

/**
 * Grupo e posição dentro do grupo. A ordem do quadro é a da fábrica e não o alfabeto:
 * enchimento, depois packing, depois as máquinas. Por ordem alfabética as Capsules
 * Machine caíam por cima da Tablet Line e o corte entre linhas e máquinas andava de
 * semana para semana conforme o que estivesse activo.
 */
function rank(name: string): [number, number] {
  const s = key(name);
  const tail = TAIL.indexOf(s);
  if (tail >= 0) return [4, tail];
  const m = s.match(/line\s*0*(\d+)/);
  if (m) return [0, Number(m[1])];          // Filler Line 1..6
  if (s.includes("capsule") || s.includes("tablet")) return [1, 0];  // Tablet Line
  if (s === "gel packing") return [2, 0];
  return [3, 0];                            // linha nova, acima das máquinas
}

/**
 * @param rows o que a tabela `lines` devolveu, tal como veio.
 * @returns os nomes a mostrar no quadro, ordenados. Nomes de identidade, não etiquetas —
 *          a tradução para o que o utilizador lê é do `displayLineLabel`.
 */
export function ragBoardLines(rows: { name: string; active?: boolean | null }[]): string[] {
  const fromDb = rows
    .filter((r) => r.active !== false)
    .map((r) => r.name)
    .filter((n) => !EXCLUDED.includes(key(n)));

  // O Gel Packing é uma máquina da GEL Line na tabela `lines`, não uma linha. Mas o RAG
  // é lançado por posto e o packing do gel tem plano e output seus, por isso entra aqui
  // sem passar a existir em `lines`: `rag_weekly_entries.line` é texto livre e sem chave
  // estrangeira, os lançamentos gravam na mesma, e os outros ecrãs que listam linhas
  // continuam a ver a fábrica como ela está registada. Se um dia for promovido a linha
  // na base, o filtro abaixo evita a linha repetida.
  const missing = BOARD_ONLY.filter((b) => !fromDb.some((n) => key(n) === key(b)));

  return [...fromDb, ...missing].sort((a, b) => {
    const [ra, na] = rank(a);
    const [rb, nb] = rank(b);
    return ra !== rb ? ra - rb : na !== nb ? na - nb : a.localeCompare(b);
  });
}
