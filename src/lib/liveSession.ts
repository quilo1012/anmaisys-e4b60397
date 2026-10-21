import { useEffect, useState } from "react";
import { supabase } from "@/integrations/supabase/client";

/**
 * Se o supabase-js tem mesmo uma token para enviar.
 *
 * As funcoes `communication_*` tem EXECUTE so para `authenticated`, e algumas defendem-se
 * outra vez por dentro — `raise exception` sem `session_id` no JWT. Um pedido enviado sem
 * token valida resolve o papel `anon`, apanha 42501, e o PostgREST embrulha-o em **401**
 * (a um utilizador autenticado sem privilegio daria 403). Chega ao Root Diagnostics como
 * RLS_ERROR sem ter nada de RLS: nao falta a concessao, falta a token.
 *
 * `user` do contexto nao responde a essa pergunta, e `session` tambem nao. Em
 * `AuthContext`, o ramo de SIGNED_OUT implicito que corre quando o `setSession()` falhou
 * repoe os DOIS a partir do `lastSession` — a pessoa fica ligada so no estado do React
 * enquanto o cliente ja nao tem token nenhuma. E por isso que gatear por `!!user` ou por
 * `!!session` nao protege ninguem nessa janela.
 *
 * `getSession()` e a resposta porque faz as duas coisas: renova a sessao quando consegue e
 * diz que nao ha nenhuma quando nao consegue. Mesmo molde do `useHeartbeat` e do
 * `logAuditEvent`, pela mesma razao.
 *
 * Vive aqui, e nao dentro de um componente, porque o erro de 21/10 apareceu em tres
 * chamadores diferentes da mesma familia — `communication_touch_presence` no batimento,
 * `communication_my_availability` e `communication_presence_for` nos hooks — e so o
 * primeiro tinha guarda. Uma guarda por ficheiro perde-se; esta e uma so.
 */
export async function hasLiveSession(): Promise<boolean> {
  try {
    const { data } = await supabase.auth.getSession();
    const session = data?.session;
    if (!session?.access_token) return false;
    // Uma sessao devolvida ja expirada e uma que o refresh ainda nao alcancou.
    // Enviar essa token e pedir o 401 de proposito.
    if (session.expires_at && session.expires_at * 1000 <= Date.now()) return false;
    return true;
  } catch {
    return false;
  }
}

/** Quanto tempo ate voltar a perguntar. Uma token expira por relogio, nao por evento. */
export const LIVE_SESSION_POLL_MS = 30_000;

/**
 * O mesmo em forma de booleano, para o `enabled` de uma query.
 *
 * Comeca em `false` e passa a `true` no primeiro check — uma query fica desactivada
 * durante esse instante em vez de sair sem token. Para o React Query isso e o estado de
 * espera normal, nao um erro, e nenhum ecra desenha "sem acesso" por causa disto.
 *
 * Ouve `onAuthStateChange` para reagir a um login ou a um refresh, e volta a perguntar de
 * 30 em 30 segundos porque a janela degradada abre e fecha **sem evento nenhum**: a token
 * expira pelo relogio, e foi assim que o 42501 de 21/10 saiu cinco vezes em seis horas.
 */
export function useLiveSession(): boolean {
  const [live, setLive] = useState(false);

  useEffect(() => {
    let mounted = true;
    const check = async () => {
      const ok = await hasLiveSession();
      if (mounted) setLive(ok);
    };

    void check();
    const { data: { subscription } } = supabase.auth.onAuthStateChange(() => { void check(); });
    const timer = setInterval(() => void check(), LIVE_SESSION_POLL_MS);

    return () => {
      mounted = false;
      subscription.unsubscribe();
      clearInterval(timer);
    };
  }, []);

  return live;
}
