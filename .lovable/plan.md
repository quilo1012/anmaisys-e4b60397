## Diagnóstico final

A Network mostra POST para `/functions/v1/list-engineers` saindo com `Authorization` + `apikey` corretos, mas o browser retorna **"Failed to fetch"** sem status nem body. Os logs da função mostram apenas `Boot`/`Shutdown` — **o request nunca chega ao handler**. Mesma sessão consegue chamar `/rest/v1/work_orders` com sucesso (200), então não é problema de auth ou rede.

**Causa raiz:** Minha refatoração anterior do `src/lib/invokeFunction.ts` substituiu `supabase.functions.invoke()` por um `fetch()` manual. Esse fetch manual dispara um **preflight CORS OPTIONS** (por causa do header `Authorization` + `Content-Type: application/json`), e o gateway de Edge Functions da Supabase está bloqueando esse preflight antes do handler executar — resultado: "Failed to fetch" silencioso.

O `supabase.functions.invoke()` original do SDK não dispara preflight da mesma forma (usa headers controlados internamente). Ele estava funcionando antes e voltará a funcionar.

## O que vou corrigir

### 1. `src/lib/invokeFunction.ts` — reverter para `supabase.functions.invoke()`
Volto a usar o helper oficial do SDK, mantendo só a parte boa do refactor (refresh proativo de sessão antes da chamada). Isso elimina o preflight problemático.

```ts
export async function invokeFunction<T = any>(name: string, body?: unknown) {
  // Refresh session if expiring in <60s
  const { data: { session } } = await supabase.auth.getSession();
  if (session?.expires_at) {
    const remaining = session.expires_at - Math.floor(Date.now() / 1000);
    if (remaining < 60) await supabase.auth.refreshSession();
  }

  const { data, error } = await supabase.functions.invoke<T>(name, {
    body: body ?? {},
  });
  return { data, error };
}
```

### 2. `src/pages/users/ManageUsers.tsx` — guardar fetches por `user.id` (não só `currentRole`)
A condição atual `if (!currentRole) return;` falha em uma janela onde a session existe mas o role ainda está carregando. Trocar para guardar por `user?.id && currentRole`, que é o que o snippet padrão recomenda. Mantenho o botão "Refresh" e o tratamento de erro com toast que já adicionei.

### 3. Preventivo nas 7 Edge Functions administrativas — uniformizar CORS
Adicionar `Access-Control-Allow-Methods: POST, OPTIONS` e `Access-Control-Max-Age: 86400` ao `corsHeaders` de:
- `create-user`, `update-user`, `delete-user`
- `create-engineer`, `update-engineer`, `delete-engineer`, `list-engineers`

E trocar `new Response("ok", { headers: corsHeaders })` por `new Response(null, { status: 204, headers: corsHeaders })` para o handler OPTIONS (padrão correto, não confunde proxies). Isso garante que mesmo que algum cliente futuro dispare preflight, ele passe.

## Por que isso resolve

- **Login & sessão:** já funcionam (auth-logs mostram login bem-sucedido às 22:21:47, e a sessão JWT é válida — todas as outras chamadas REST funcionam).
- **Carregamento de engineers:** vai funcionar porque `supabase.functions.invoke()` não dispara o preflight que está sendo bloqueado.
- **Criação de engineers/users:** mesma razão — o canal de Edge Function volta a abrir.
- **RLS:** já está correta (admin tem `ALL` em `engineers`, manager tem `SELECT`). Não preciso mexer.
- **Tabela `engineers`:** já tem 4 registros confirmados via psql. Não há problema de dados.

## Fora de escopo (e por quê)

- **Não vou criar registro automático em `engineers` ao criar user**: a arquitetura atual é proposital (modelo híbrido — `engineers` é uma tabela standalone para identidade via PIN em terminais compartilhados, separada das contas de login `auth.users`/`profiles`). Misturar os dois quebra o "Hybrid Identity" descrito na memória do projeto.
- **Não vou refatorar para React Query**: fora do escopo do bug.
- **Não vou mexer em RLS**: já está correta e auditada.

## Validação após a correção

1. Recarregar `/users/manage` como admin → seção "Engineers" mostra 4 registros (Lucas, Luciano Polo, test-curl, debug-temp).
2. Clicar "New Engineer", criar um → aparece sem erro, `Failed to fetch` sumiu.
3. Clicar "New User", criar um operator → conta criada, aparece em "Login Accounts".
4. Logar como manager → vê só engineers (sem coluna admin de users), criação funciona.
5. Limpar os 2 engineers de teste (`test-curl`, `debug-temp`) pela UI para confirmar delete também funciona.