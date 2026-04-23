## Plano — Corrigir o `Failed to fetch` ao criar engineers

O problema atual está no caminho de chamada das funções administrativas do backend, não no formulário de UI.

### Diagnóstico confirmado

- A tela `/users/manage` chama `list-engineers` no carregamento e `create-engineer` no submit usando `invokeFunction()`.
- O navegador mostra `Failed to fetch` para `POST /functions/v1/list-engineers` e `POST /functions/v1/create-engineer`.
- Os logs dessas funções mostram apenas `booted/shutdown`, sem erro de aplicação retornado ao cliente.
- O arquivo `supabase/config.toml` hoje só declara:

```toml
[functions.delete-user]
verify_jwt = false
```

Isso deixa as outras funções administrativas em um estado inconsistente. Como essas funções já validam o token manualmente no próprio código (`Authorization` + `getClaims()` / checagem de role), a chamada do navegador está sendo bloqueada antes de a resposta correta chegar ao cliente.

### O que vou alterar

#### 1) Ajustar a configuração das funções administrativas
Atualizar `supabase/config.toml` para declarar `verify_jwt = false` nas funções que já fazem validação manual em código:

- `create-engineer`
- `list-engineers`
- `update-engineer`
- `delete-engineer`
- `create-user`
- `update-user`
- `delete-user`

Estrutura esperada:

```toml
project_id = "ybtrzqzliepknpzqdajx"

[functions.create-user]
verify_jwt = false

[functions.update-user]
verify_jwt = false

[functions.delete-user]
verify_jwt = false

[functions.create-engineer]
verify_jwt = false

[functions.update-engineer]
verify_jwt = false

[functions.delete-engineer]
verify_jwt = false

[functions.list-engineers]
verify_jwt = false
```

#### 2) Manter a segurança existente
Não vou relaxar autorização.
Essas funções já protegem acesso via:

- leitura do header `Authorization`
- validação do usuário autenticado
- checagem de role (`admin` / `manager`)

Ou seja: a segurança continua no código da função, só removendo o bloqueio prematuro da plataforma nesse grupo de funções.

#### 3) Validar o fluxo depois do ajuste
Depois da alteração, validar:

- carregar lista de engineers sem `Failed to fetch`
- criar novo engineer com sucesso
- atualizar/deletar engineer
- garantir que `create-user` e `update-user` também continuam funcionando no mesmo padrão

## Detalhes técnicos

Arquivos envolvidos:
- `supabase/config.toml`
- referência de comportamento já confirmada em:
  - `supabase/functions/create-engineer/index.ts`
  - `supabase/functions/list-engineers/index.ts`
  - `supabase/functions/create-user/index.ts`
  - `src/lib/invokeFunction.ts`
  - `src/pages/users/ManageUsers.tsx`

Sem mudança de schema, RLS ou hooks de dados.

## Fora de escopo

- Refatorar `ManageUsers.tsx`
- Alterar banco de dados
- Mudar permissões de admin/manager
- Corrigir os warnings visuais do `Dialog` (isso é separado do erro de Edge Function)