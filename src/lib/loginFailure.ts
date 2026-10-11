/**
 * Nem toda a recusa de entrada é alguém a adivinhar uma password.
 *
 * O `loginRateLimit` existe para travar quem tenta passwords à sorte: cinco falhas e o
 * posto fecha 30s, depois 60, 120, 300. O `Login` chamava-lhe `recordLoginFailure` no
 * princípio do `catch`, antes de olhar para o erro — por isso **qualquer** excepção
 * gastava uma tentativa.
 *
 * O que isso fazia na linha, em 11/10/2026: uma conta por activar devolve
 * `email_not_confirmed`, o ecrã dizia "Email not confirmed · 1 attempt remaining", e a
 * pessoa — que tinha escrito a password certa — tentava outra vez. Repetir não podia
 * ajudar: o que falta não é a password, é a conta estar activa. Ao fim de cinco voltas
 * ficava trancada, pelo lado do browser, por um problema que não era dela.
 *
 * A mesma falha já tinha sido vista com a rede. O comentário no `Login` conta que
 * "wrong password" e "I could not reach the server" liam igual e que isso foi
 * corrigido — mas só o TEXTO foi corrigido. O contador continuava a subir, por isso
 * um operador com a rede em baixo continuava a andar para o bloqueio. A correcção
 * parcial durou porque não havia nada que a contradissesse.
 *
 * Daí este ficheiro: classificar primeiro, e deixar a classificação decidir as duas
 * coisas — o que se diz à pessoa E se aquilo conta como tentativa. Uma função pura,
 * para a regra poder ser afirmada num teste em vez de vivida num `catch`.
 */

export type LoginFailureKind = "credentials" | "network" | "not_activated" | "unknown";

export interface LoginFailure {
  kind: LoginFailureKind;
  /** Se esta recusa é mesmo indício de alguém a tentar passwords. */
  countsAgainstLockout: boolean;
}

/**
 * O que a pessoa lê quando a conta existe mas ainda não está activa.
 *
 * Não manda tentar outra vez, de propósito — tentar outra vez é o que a tranca. E não
 * promete que um email vai chegar: o `mailer_autoconfirm` está desligado e as contas
 * de crachá nascem com endereços em `@employee.pmsystem.local`, onde ninguém recebe
 * nada. Nomeia a pessoa que pode mesmo resolver isto, que é quem tem o ecrã Users.
 */
export const NOT_ACTIVATED_MESSAGE =
  "This account is not active yet, so the password is not the problem. "
  + "Open the confirmation link if you were sent one — otherwise ask your supervisor "
  + "to activate it in Users.";

function messageOf(error: unknown): string {
  if (error instanceof Error) return error.message;
  if (typeof error === "string") return error;
  return "";
}

/**
 * Qual das quatro recusas é esta.
 *
 * O que não se reconhece NÃO conta. É a direcção segura: a protecção a sério é a do
 * servidor — o próprio `loginRateLimit` diz isso no cabeçalho — e quem anda a adivinhar
 * passwords recebe `invalid_grant`, que conta. Um erro novo do servidor a trancar quem
 * trabalha é um custo real; um erro novo a não trancar um atacante não lhe dá nada,
 * porque para testar uma password ele tem de a submeter, e aí cai no ramo que conta.
 */
export function classifyLoginFailure(error: unknown): LoginFailure {
  const m = messageOf(error).toLowerCase();

  if (m.includes("email not confirmed") || m.includes("email_not_confirmed")) {
    return { kind: "not_activated", countsAgainstLockout: false };
  }
  if (
    m.includes("failed to fetch") || m.includes("networkerror")
    || m.includes("load failed") || m.includes("timeout") || m.includes("aborted")
  ) {
    return { kind: "network", countsAgainstLockout: false };
  }
  if (
    m.includes("invalid credentials") || m.includes("invalid login")
    || m.includes("invalid_grant")
  ) {
    return { kind: "credentials", countsAgainstLockout: true };
  }
  return { kind: "unknown", countsAgainstLockout: false };
}
