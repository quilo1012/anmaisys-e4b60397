/**
 * Se uma sessão de produção teve líder — a pergunta feita uma vez só.
 *
 * O líder do turno mora em duas colunas: `leader_id`, que aponta para a `line_leaders`,
 * e `leader_name`, que é texto. O tablet da nave só escreve o nome — o operador
 * escreve-se a si próprio e carrega em sincronizar — enquanto o import do Intouch
 * escreve os dois. A 27/08/2026 eram 344 sessões em 563 com nome e sem ligação.
 *
 * A Production Control perguntava "tem líder?" em três sítios pela ligação e respondia
 * na própria fila pelo nome: a mesma sessão dizia "Gill" na coluna do líder e "NO
 * LEADER" na placa da baía, e o âmbar do "sem líder" — que é um andon, uma lâmpada que
 * só se acende quando falta alguém — ficava aceso em 61% da folha. Um aviso que está
 * sempre aceso deixa de ser um aviso: era exactamente por isso que ninguém já lhe ligava.
 *
 * Vive aqui, e sozinha, porque a pergunta tem de ser feita da mesma maneira nos três
 * sítios. Foi terem sido escritas três vezes à mão que deixou uma delas discordar das
 * outras duas.
 *
 * NOTA: isto conserta a leitura, não os dados. As 344 sessões continuam sem ligação à
 * `line_leaders`, e tudo o que precise do líder como entidade — os scorecards semanais,
 * a atribuição por linha — continua a não as ver. Isso é uma migração de dados e uma
 * correcção no tablet, não uma linha nesta função.
 */
export interface SessionLeaderFields {
  leader_id?: string | null;
  leader_name?: string | null;
}

/** Vazio, nulo, ou só espaços — o tablet aceita o campo em branco. */
function filled(value: string | null | undefined): boolean {
  return typeof value === "string" && value.trim().length > 0;
}

export function hasLeader(session: SessionLeaderFields): boolean {
  return filled(session.leader_id) || filled(session.leader_name);
}

/** A chave por que dois nomes são o mesmo nome: sem maiúsculas, sem espaços a mais. */
function nameKey(name: string): string {
  return name.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * O nome escrito no tablet, ligado à `line_leaders` — ou guardado como está.
 *
 * O `hasLeader` acima conserta a leitura de hoje; isto é o que impede a de amanhã. Sem
 * esta resolução, cada turno grava outra sessão só com nome, e a folha volta a encher-se
 * de linhas que o resto do sistema — os scorecards, a atribuição por linha — não vê.
 *
 * Três decisões, e as três são sobre não estragar o que já se sabe:
 *
 * 1. Perdoa as maiúsculas e os espaços. Quem escreve à pressa num tablet, de luvas,
 *    não acerta neles — e "  gill " é o Gill.
 *
 * 2. Um nome que não está na tabela **fica escrito na mesma**. Deitá-lo fora por não
 *    haver ligação trocava um problema por outro pior: a sessão passava de "tem líder,
 *    sem ligação" para "não teve ninguém", e o turno perdia a única coisa que se sabia
 *    dele. É também assim que um líder novo, ainda por registar, não desaparece.
 *
 * 3. Com dois homónimos na tabela não escolhe nenhum. Escolher à sorte põe metade dos
 *    turnos de uma pessoa na conta da outra, e ninguém repara — que é a pior maneira de
 *    um número estar errado.
 *
 * A lista que se passa é a que se quer considerar: passando só os activos, um líder que
 * saiu deixa de ser ligado; passando todos, continua a sê-lo. O ecrã decide, não isto.
 */
export function resolveLeader(
  typed: string | null | undefined,
  roster: { id: string; name: string }[],
): { id: string | null; name: string | null } {
  const written = (typed ?? "").trim();
  if (!written) return { id: null, name: null };

  const key = nameKey(written);
  const hits = roster.filter((l) => nameKey(l.name) === key);
  if (hits.length !== 1) return { id: null, name: written };

  return { id: hits[0].id, name: hits[0].name };
}
