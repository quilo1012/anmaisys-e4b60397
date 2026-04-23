## Plano — Engineers não aparecem em /users/manage (admin e manager)

### Diagnóstico confirmado

1. **Banco está correto**: 3 engineers existem (`Lucas`, `Luciano Polo`, `test-curl`).
2. **Edge Function `list-engineers` funciona**: testei via curl com a sessão real do admin → retorna 200 com os 3 engineers, headers CORS corretos.
3. **Navegador não chama a função**: os logs de rede da preview em `/users/manage` não mostram nenhuma request para `list-engineers`. Os logs do runtime também não registram invocação recente do browser.
4. **Causa provável**: o `useEffect` em `ManageUsers.tsx` (linha 112) tem o padrão:

   ```ts
   useEffect(() => { if (currentRole) fetchUsers(); fetchEngineers(); }, [currentRole]);
   ```

   O `if (currentRole)` só protege `fetchUsers()`. O `fetchEngineers()` dispara **sempre**, inclusive no primeiro render quando `currentRole` ainda é `null` e a sessão pode estar incompleta — a chamada falha silenciosamente em `if (res.error) return;` (sem toast, sem log). Quando `currentRole` finalmente chega, o effect re-roda — mas se a primeira chamada deixou algum estado intermediário (ou falhou de forma não capturada), a segunda pode não disparar.

5. **Manager nunca via engineers**: além disso, faltava cobertura defensiva — sem feedback de erro, qualquer falha de auth/CORS/rede deixa a tabela vazia mostrando "No engineers configured".

### O que vou alterar

**Arquivo único:** `src/pages/users/ManageUsers.tsx`

#### 1. Corrigir o guard do useEffect

Garantir que **ambos** os fetches só rodem quando `currentRole` estiver disponível:

```ts
useEffect(() => {
  if (!currentRole) return;
  fetchUsers();
  fetchEngineers();
}, [currentRole]);
```

#### 2. Tornar `fetchEngineers` resiliente e observável

- Mostrar toast de erro real (em vez de engolir).
- Logar no console para debug.
- Garantir `setEngineers([])` apenas em caso explícito de "não há engineers", nunca em erro.

```ts
const fetchEngineers = async () => {
  const res = await invokeFunction<Engineer[]>("list-engineers");
  if (res.error) {
    console.error("[ManageUsers] list-engineers failed:", res.error);
    toast({
      title: "Failed to load engineers",
      description: res.error.message ?? "Try refreshing the page.",
      variant: "destructive",
    });
    return;
  }
  setEngineers(res.data ?? []);
};
```

#### 3. Botão manual de "Refresh" na seção Engineers

Pequeno botão ao lado de "New Engineer" que chama `fetchEngineers()`. Útil para debug imediato e para o usuário recuperar caso algum fetch falhe na carga inicial.

### Por que isso resolve

- Elimina a corrida onde `fetchEngineers` roda sem sessão pronta.
- Quando algo der errado de fato, o usuário vê o erro (em vez de uma tabela vazia silenciosa).
- O botão Refresh dá uma saída de emergência.
- Não muda backend — funções já estão corretas e testadas (curl retornou os 3 engineers com sucesso).

### Validação após o fix

1. Login como **admin** em `/users/manage` → seção Engineers mostra Lucas, Luciano Polo, test-curl.
2. Login como **manager** em `/users/manage` → mesma lista visível.
3. Criar novo engineer → aparece imediatamente na tabela após `fetchEngineers()` recarregar.
4. Se algum fetch falhar, toast de erro vermelho aparece em vez de tabela vazia silenciosa.
5. (Limpeza opcional) Deletar `test-curl` que sobrou do diagnóstico, pelo próprio botão de delete da UI.

### Fora de escopo

- Mexer em RLS de `engineers` (admin já tem `ALL` policy; manager tem `SELECT` via policy "Managers can view engineers (safe view only)").
- Mexer no código das edge functions (já estão corretas).
- Refatorar para React Query (`useEngineerScores` usa, mas `ManageUsers` é fetch direto — manter padrão atual).
- Adicionar paginação ou filtros.
