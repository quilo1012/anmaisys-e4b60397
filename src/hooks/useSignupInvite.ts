import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";

/**
 * O código de convite em vigor, ou null se o registo estiver fechado.
 *
 * Isto substitui o `useTabletInviteCode`, que pedia o código ao
 * `signup_invite_for_tablet` e só o recebia numa sessão de conta de linha. Essa
 * restrição existia para o ecrã de entrada, que é público, não poder mostrar o código
 * — e a 11/10/2026 foi decidido o contrário: o botão "Create account" passa a levar o
 * código no link, para ninguém ter de o ir pedir ao supervisor às seis da manhã.
 *
 * O código deixa portanto de ser um segredo, de propósito. Quem trava o registo passa a
 * ser só o interruptor `enabled` e o `invite_expires_at` — a função devolve null nos
 * dois casos, por isso desligar o registo continua a fechar a porta de verdade, e não
 * apenas a esconder o campo. Ver a migração 20261011230000.
 *
 * Qualquer falha é um null silencioso. Antes da migração isto é um 404, e a resposta do
 * ecrã a "não há código" é a mesma seja qual for o motivo: o campo fica vazio, como
 * hoje. Uma caixa vermelha no ecrã de entrada de uma fábrica não é resposta nenhuma.
 */
export function useSignupInviteCode(enabled = true) {
  const { data } = useQuery({
    queryKey: ["signup-invite-code"],
    enabled,
    // Muda quando um admin gera outro, o que é raro — mas um código velho leva a
    // pessoa a uma recusa, por isso não fica muito tempo em cache.
    staleTime: 5 * 60 * 1000,
    retry: false,
    queryFn: async (): Promise<string | null> => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any -- RPC not in generated types yet
      const { data, error } = await (supabase.rpc as any)("signup_invite_code");
      if (error) return null;
      return (data as string | null) ?? null;
    },
  });
  return data ?? null;
}
