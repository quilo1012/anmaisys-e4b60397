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
