/**
 * Deixar entrar quem já tem conta mas nunca confirmou o endereço.
 *
 * O `/signup` cria a conta com `auth.signUp`, e o `mailer_autoconfirm` do projecto
 * está desligado — por isso a linha do `auth.users` nasce com `email_confirmed_at` a
 * null e o GoTrue recusa a entrada com `email_not_confirmed`, por mais certa que a
 * password esteja. O email de confirmação é a única saída prevista, e para as contas
 * de crachá nem existe: vivem em `@employee.pmsystem.local`, onde ninguém recebe nada.
 * Resultado: contas criadas e inutilizáveis, e o ecrã Users sem nada para carregar.
 *
 * O caminho que já existia era saber que pôr uma password nova no `update-user`
 * confirma o endereço de passagem. Duas coisas erradas com isso: não está escrito em
 * lado nenhum, e o `update-user` é uma edge function, que só muda quando alguém a
 * republica no Lovable.
 *
 * ISTO NÃO É UMA EDGE FUNCTION. O `admin_update_auth_email` é uma RPC `security
 * definer` que corre no Postgres, já está em produção (sondado a 11/10/2026: 401
 * 42501, ou seja existe e recusa a quem não tem sessão), e já tem a guarda certa —
 * `has_role(admin)` ou `has_role(manager)`. Por isso o botão funciona no dia em que
 * for fundido, sem colagem de migração e sem deploy.
 *
 * Reescrever o endereço com o MESMO endereço não é um disfarce: a função confirma o
 * endereço de propósito, porque um admin a escrever o endereço de alguém é o acto que
 * responde por ele. É esse o passo que queremos, e o resto do UPDATE fica igual ao que
 * já lá está. O que isto tem de frágil é depender de uma linha dentro do corpo da
 * função — e é por isso que `activateLogin.test.ts` lê a migração e falha se essa
 * linha desaparecer.
 */

/** A RPC que faz o trabalho. Exportada para o teste poder nomeá-la. */
export const ACTIVATE_RPC = "admin_update_auth_email";

/** O mínimo do cliente supabase de que isto precisa, para o teste poder dar um falso. */
export type RpcCaller = (
  fn: string,
  args: Record<string, unknown>,
) => Promise<{ error: { message: string } | null }>;

/**
 * Confirma o endereço da conta, devolvendo a mensagem de erro ou `null` se correu bem.
 *
 * O endereço passado é o que está GUARDADO na conta, nunca um que o admin esteja a
 * escrever: isto é activar, não editar. Quem quer mudar o endereço usa o campo Email e
 * o Save, que já existem.
 */
export async function activateLogin(
  rpc: RpcCaller,
  user: { id: string; email: string | null | undefined },
): Promise<string | null> {
  const email = (user.email ?? "").trim().toLowerCase();
  // Sem endereço não há nada para confirmar, e mandar string vazia reescrevia a conta
  // para um endereço que não é de ninguém.
  if (!email) return "This login has no email address, so there is nothing to confirm.";
  if (!user.id) return "This login has no id.";

  const { error } = await rpc(ACTIVATE_RPC, { _user_id: user.id, _new_email: email });
  return error ? error.message : null;
}
