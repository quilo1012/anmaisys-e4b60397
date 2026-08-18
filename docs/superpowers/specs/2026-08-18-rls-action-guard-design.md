# Guarda de ações no servidor — a RLS passa a honrar os overrides

Data: 2026-08-18
Estado: desenho aprovado, por implementar
Âmbito desta entrega: piloto em `work_orders`

## Problema

A matriz de permissões do Admin (`/dashboard/permissions`) escreve em
`public.role_permission_overrides`. O frontend lê essa tabela e `can()` respeita-a em
tempo real. O Postgres não.

Das 425 migrações do repositório, 178 criam políticas RLS e **nenhuma consulta
`role_permission_overrides`**. A única política sobre essa tabela deixa cada papel ler
as suas próprias linhas.

Consequência: desligar um switch no Admin esconde o botão, mas a base de dados continua
a aceitar a escrita de quem chamar a API diretamente. Hoje a matriz é cosmética do lado
dos dados.

## Decisões tomadas

| Decisão | Escolha | Porquê |
|---|---|---|
| Semântica | **Só negar** | Os overrides só podem TIRAR permissão. A base continua a ser o `MATRIX` do TypeScript; nada é duplicado no Postgres e não há duas cópias da verdade a divergir. Ligar um switch acima da base continua a ser só interface. |
| Mecanismo | **Triggers**, não edição de políticas | As políticas destas tabelas têm muita história (só `work_orders` aparece em 39 migrações). Um trigger acrescenta sem reescrever, dá erro legível em vez de devolver zero linhas, e reverte-se com `DROP TRIGGER`. Não cobre `SELECT` — aceite. |
| Alcance | **Piloto: `work_orders`** | Prova o mecanismo ponta a ponta antes de o espalhar por ~30 tabelas. |

Alternativas recusadas: espelhar o `MATRIX` numa tabela `permission_defaults` (duas cópias
da verdade a sincronizar); mover o `MATRIX` para o Postgres (arranque da app passa a
depender da base; 711 testes precisariam de nova fixture).

## Arquitetura

### `public.action_revoked(_action text) returns boolean`

`STABLE`, `SECURITY DEFINER`, `SET search_path = public`.

```sql
SELECT auth.uid() IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.role_permission_overrides o
  WHERE o.action = _action
    AND o.allowed = false
    AND o.role = public.current_user_role()
);
```

`current_user_role()` já existe e é inequívoco: `user_roles` tem `UNIQUE (user_id)`, um
papel por utilizador. O servidor decide, portanto, sobre o mesmo papel que o ecrã mostra.

A cláusula `auth.uid() IS NOT NULL` é deliberada. Os edge functions e o `pg_cron` correm
sem utilizador; um switch do Admin não pode parar o sync do iTouching nem os fechos
noturnos. Sem contexto de utilizador, nada é negado.

### `public.enforce_action()`

Função de trigger genérica. Lê a ação de `TG_ARGV[0]` e, se `action_revoked` for
verdadeiro, levanta exceção com `ERRCODE = '42501'` e mensagem legível:

> `Permission "wo.delete" is turned off for your role.`

O PostgREST converte `42501` em HTTP 403, e a app pode mostrar a mensagem em vez de um
erro cru.

### Triggers em `public.work_orders`

| Trigger | Quando | Ação |
|---|---|---|
| `wo_guard_insert` | `BEFORE INSERT` | `wo.create` |
| `wo_guard_update` | `BEFORE UPDATE` | `wo.update` |
| `wo_guard_delete` | `BEFORE DELETE` | `wo.delete` |
| `wo_guard_close` | `BEFORE UPDATE WHEN (NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed')` | `wo.close` |
| `wo_guard_force` | `BEFORE UPDATE WHEN (NEW.status = 'force_closed' AND OLD.status IS DISTINCT FROM 'force_closed')` | `wo.force` |

`closed` e `force_closed` são valores reais do enum `wo_status`. `wo.close` e `wo.force`
não são hoje verificados em lado nenhum do frontend: estes triggers são a primeira coisa
no sistema a fazê-los valer.

## Verificação

Não é possível verificar localmente: o `supabase` CLI está instalado mas não há Docker
nesta máquina, e as ligações MCP Supabase/Lovable disponíveis pertencem a outra conta e
não alcançam este projeto. A prova corre no SQL editor do projeto, por quem tem acesso.

`docs/apply/VERIFY-action-guard.sql`, dois blocos, ambos dentro de `BEGIN … ROLLBACK`:

1. **Nega** — revogar `wo.delete` ao `engineer`, assumir a identidade de um engineer
   (`SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claims`), tentar o `DELETE`.
   Tem de falhar com `42501`. Se passar, o trigger não está a funcionar.
2. **Permite** — com `allowed = true`, o mesmo `DELETE` tem de passar. Sem este bloco, um
   trigger que bloqueasse toda a gente parecia sucesso.

Ordem obrigatória: o bloco 1 tem de falhar **antes** de existir o trigger e passar depois.

## Entrega

- `supabase/migrations/<timestamp>_action_guard_work_orders.sql` — funções e triggers, com
  o `DROP TRIGGER` de rollback em comentário no fim do ficheiro.
- `docs/apply/VERIFY-action-guard.sql` — o script de prova.

As migrações deste repositório não se aplicam sozinhas: quem as aplica é o Lovable. O
ficheiro é escrito e commitado no ramo; a aplicação é pedida ao Lovable pelo utilizador.

## Riscos aceites

- O `BEFORE UPDATE` corre em todas as escritas de `work_orders`, incluindo as automáticas.
  Mitigado pela cláusula `auth.uid() IS NOT NULL` — a confirmar no teste, não a presumir.
- Revogar `wo.update` ao próprio `admin` deixa-o sem editar ordens até desligar o switch,
  o que continua a conseguir fazer (a página de permissões escreve noutra tabela). Fica
  documentado; não se protege com código.
- `SELECT` não é coberto. Esconder leitura exige editar políticas e fica fora deste piloto.
- Fechar uma ordem (inclusive via força) é uma `UPDATE`, portanto `wo_guard_update` dispara em paralelo com `wo_guard_close` e `wo_guard_force`. Revogar `wo.update` bloqueia igualmente o fecho normal — a negação acumula e falha fechado.

## Depois deste piloto

Se o padrão se aguentar, os lotes seguintes são cópia com outro nome de ação:
`downtime_events` + `downtime_corrections`, `quality_actions`, `daily_allocations`,
stock, `user_roles`. Ao todo, 40 das 69 ações do `MATRIX` não guardam nada hoje.
