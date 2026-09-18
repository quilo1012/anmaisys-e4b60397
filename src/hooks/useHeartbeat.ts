import { useEffect } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/contexts/AuthContext";

/**
 * Marca `profiles.last_seen_at` enquanto um engineer tem o dashboard aberto.
 *
 * Pela RPC e nao por um PATCH a `profiles`: o PostgREST devolve a linha inteira num
 * `RETURNING *` mesmo quando ninguem a pede, e `authenticated` nao tem SELECT em
 * `labor_rate`. O PATCH devolvia 42501 a cada 30 segundos. Ver 20260916090000.
 *
 * E so com a token viva. `touch_last_seen()` tem EXECUTE para `authenticated` e um
 * REVOKE explicito para `anon`, portanto uma batida enviada sem JWT valido resolve
 * o papel `anon`, apanha 42501 e chega ao Root Diagnostics como RLS_ERROR. Os cinco
 * registos de 17/09 trazem `status: 401` — o 401 e como o PostgREST embrulha o
 * 42501 de um pedido *sem* autenticacao; a um utilizador autenticado sem privilegio
 * daria 403. Ou seja: nao faltava a concessao, faltava a token, que expirou entre
 * duas batidas do intervalo de 30 segundos e ainda nao tinha sido renovada.
 *
 * `getSession()` e a resposta porque faz as duas coisas: renova a sessao quando
 * consegue e diz que nao ha nenhuma quando nao consegue. O `logAuditEvent` ja se
 * protege assim, pela mesma razao.
 */
export function useHeartbeat() {
  const { user, role } = useAuth();

  useEffect(() => {
    if (!user || role !== "engineer") return;

    const beat = async () => {
      const { data } = await supabase.auth.getSession();
      const session = data?.session;
      if (!session?.access_token) return;
      // Uma sessao devolvida ja expirada e uma que o refresh ainda nao alcancou.
      // Enviar essa token e pedir o 401 de propósito.
      if (session.expires_at && session.expires_at * 1000 <= Date.now()) return;
      await (supabase as any).rpc("touch_last_seen");
    };

    void beat(); // immediate
    const interval = setInterval(() => void beat(), 30_000);
    return () => clearInterval(interval);
  }, [user, role]);
}
