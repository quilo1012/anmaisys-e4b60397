/**
 * Quem é que está a entrar — decidido a partir de uma linha de texto.
 *
 * O ecrã de login tinha cinco controlos (três cartões de ambiente e, dentro de um
 * deles, dois separadores) para uma escolha binária: ou entras com o teu email, ou
 * entras com um tablet de linha partilhado. Passou a haver um campo só, e é esta
 * função que lê o que lá está.
 *
 * A regra tem uma ordem que não é arbitrária: **a arroba decide primeiro**. Um
 * rótulo de tablet é texto livre que um administrador escreve, por isso nada
 * impede que alguém chame a um posto "linha3@turno" — e sem esta precedência esse
 * rótulo passaria a capturar tentativas de login por email. Um endereço nunca é
 * lido como tablet.
 */

export interface TabletChoice {
  id: string;
  label: string;
}

/**
 * Genérico no tablet para quem chama não perder o tipo que passou: o `Login`
 * precisa do `favicon_url` e dos `line_ids` do lado de lá, e um retorno fixo em
 * `TabletChoice` obrigá-lo-ia a ir buscar a conta outra vez à lista.
 */
export type LoginIdentity<T extends TabletChoice = TabletChoice> =
  /** Vazio: ainda não há nada para reconhecer. */
  | { kind: "empty" }
  /** Bate certo com um tablet partilhado; entra pela edge function `tablet-signin`. */
  | { kind: "tablet"; tablet: T }
  /** É um endereço; entra por `signInWithPassword` e o papel decide o resto. */
  | { kind: "email"; email: string }
  /** Nem uma coisa nem outra — dizer isso agora poupa um erro cru do Supabase. */
  | { kind: "unknown" };

const norm = (s: string) => s.trim().toLowerCase();

/** Um endereço completo: algo, arroba, domínio com ponto. */
export function looksLikeEmail(value: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value.trim());
}

export function resolveIdentity<T extends TabletChoice>(
  value: string,
  tablets: readonly T[] | undefined | null,
): LoginIdentity<T> {
  const v = norm(value);
  if (!v) return { kind: "empty" };

  // A arroba primeiro: um endereço nunca é lido como o nome de um posto.
  if (!v.includes("@")) {
    const tablet = tablets?.find((t) => norm(t.label) === v);
    if (tablet) return { kind: "tablet", tablet };
  }

  if (looksLikeEmail(value)) return { kind: "email", email: v };

  return { kind: "unknown" };
}

/**
 * Que tablets é que o que está escrito ainda pode ser.
 *
 * Campo vazio: todos, porque a próxima tecla tanto pode começar um nome como um
 * endereço. Com uma arroba lá dentro: nenhum — quem escreve um email já não vai
 * escolher um posto, e manter a lista aberta punha-a por cima da linha que diz o
 * que o sistema reconheceu, que é precisamente o que ela precisa de deixar ver.
 */
export function suggestTablets<T extends TabletChoice>(
  value: string,
  tablets: readonly T[] | undefined | null,
): T[] {
  const all = tablets ? [...tablets] : [];
  const v = norm(value);
  if (!v) return all;
  if (v.includes("@")) return [];
  return all.filter((t) => norm(t.label).includes(v));
}
