# Guarda de ações no servidor — a RLS passa a honrar os overrides

Data: 2026-08-18
Estado: desenho aprovado, por implementar
Âmbito desta entrega: piloto em `work_orders`

## Problema

A matriz de permissões do Admin (`/dashboard/permissions`) escreve em
`public.role_permission_overrides`. O frontend lê essa tabela e `can()` respeita-a em
tempo real — mas só onde alguma tela chama `can()`. Nenhuma tela do frontend chama
`can()` para `wo.create`, `wo.update`, `wo.delete`, `wo.close` ou `wo.force`; só
`wo.view` é hoje verificado. Para as outras cinco ações desta entrega, desligar o
switch no Admin não esconde botão nenhum — não há nada a esconder, porque nada os
verifica. O Postgres também não os verificava.

Das 425 migrações do repositório, 178 criam políticas RLS. Exatamente uma consulta
`role_permission_overrides`: `dt_insert_adjusters` em `downtime_events`
(`20260813100222_*.sql`), através de `public.has_action(uuid, text, app_role[])`
(`20260813094905_*.sql`). Fora desse único ponto, nenhuma política toca a tabela — a
única outra política sobre `role_permission_overrides` em si deixa cada papel ler as
suas próprias linhas.

Consequência: fora de `downtime_events`, a base de dados não recusa nada que o `MATRIX`
diga que devia recusar. Nas telas onde `can()` é chamado, isso é um botão que fica
visível quando devia estar escondido. Em `work_orders`, para as cinco ações desta
entrega, nem isso: como visto acima, `can()` não é chamado, então nem o botão está
escondido — a chamada à API passa sem controlo nenhum dos dois lados. A matriz é
cosmética do lado dos dados em todas as tabelas menos uma, e em `work_orders` não era
sequer cosmética do lado da UI.

Porque não reaproveitar `has_action`, já que existe? `has_action(_uid, _action,
_baseline)` recebe a linha de base do `MATRIX` como argumento — é allow-and-deny, o
chamador decide quem passa quando não há override. Este desenho é deliberadamente só
negar, com a base a ficar no TypeScript, e não tem baseline nenhuma para passar. Por
isso nasce `action_revoked`, uma função nova em vez de uma chamada a `has_action`. Isto
deixa duas funções na base de dados a ler a mesma tabela com semânticas diferentes —
`has_action` decide sozinha quem pode; `action_revoked` só sabe tirar. Os lotes
seguintes (ver "Depois deste piloto") devem convergir num só mecanismo em vez de
manterem os dois lado a lado.

## Decisões tomadas

| Decisão | Escolha | Porquê |
|---|---|---|
| Semântica | **Só negar** | Os overrides só podem TIRAR permissão. A base continua a ser o `MATRIX` do TypeScript; a lista de quem pode o quê não é duplicada no Postgres. Ligar um switch acima da base continua a ser só interface. (Isto não elimina a divergência de semântica entre `action_revoked` e `has_action` — ver "Problema" — só evita duplicar a lista em si.) |
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

`closed` e `force_closed` são valores reais do enum `wo_status`. Como já dito em
"Problema", nenhuma das cinco ações desta tabela é verificada em lado nenhum do
frontend — `wo.close` e `wo.force` incluídos: estes triggers são a primeira coisa no
sistema a fazê-los valer. Consequência prática: uma ação revogada não aparece como um
botão desativado nem um aviso — aparece como um erro cru no toast de uma operação que
até aí nunca tinha sido recusada. O trabalho de seguimento tem de acrescentar as
verificações `can()` correspondentes na UI antes de este piloto se generalizar; até lá,
revogar uma destas cinco ações é visível só na base de dados.

## Verificação

Não é possível verificar localmente: o `supabase` CLI está instalado mas não há Docker
nesta máquina, e as ligações MCP Supabase/Lovable disponíveis pertencem a outra conta e
não alcançam este projeto. A prova corre no SQL editor do projeto, por quem tem acesso.

`docs/apply/VERIFY-action-guard.sql`, dois blocos, ambos dentro de `BEGIN … ROLLBACK`:

1. **Nega** — revogar `wo.update` ao `engineer`, assumir a identidade de um engineer
   (`SET LOCAL ROLE authenticated` + `SET LOCAL request.jwt.claims`), tentar um `UPDATE`
   inofensivo permitido pela própria política do engineer. Tem de falhar com `42501`.
   Se passar, o trigger não está a funcionar. (Não se usa `wo.delete`/`DELETE`: um
   engineer não tem política de DELETE em `work_orders`, por isso o `DELETE` seria
   filtrado pela RLS antes do trigger disparar — `DELETE 0` sem erro, um falso negativo.)
2. **Permite** — com `allowed = true`, o mesmo `UPDATE` tem de passar. Sem este bloco, um
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
  O teste confirma que sem utilizador nada é bloqueado, protegendo sync do iTouching e
  pg_cron. A cláusula `auth.uid() IS NOT NULL` é defesa em profundidade, não distinguível
  em teste porque `current_user_role()` já devolve NULL sem utilizador.
- `action_revoked` isenta explicitamente o `admin`: `public.current_user_role() <> 'admin'`
  faz a função devolver sempre `false` para esse papel, seja qual for o conteúdo de
  `role_permission_overrides`. É o mesmo invariante de `permissions.ts:307`
  (`if (role === "admin") return true;`) aplicado do lado da base — a matriz nunca
  tranca um admin fora através do Postgres, mesmo que já exista hoje uma linha
  `('admin', 'wo.update', false)` na tabela (a página de permissões escreve-a sem
  validação; `can()` já a ignora no frontend por essa mesma razão).
- `trg_downtime_sync` em `downtime_events` corre `sync_wo_line_status()`
  (`20260418120132_*.sql`), que faz `UPDATE public.work_orders` dentro da própria
  transação do utilizador, com `auth.uid()` ainda definido. Revogar `wo.update` a um
  papel bloqueia também esse `UPDATE` interno quando esse papel iniciar ou retomar uma
  paragem de linha — e o erro que a pessoa vê nomeia `wo.update`, não a ação de
  downtime que estava de facto a tentar.
- Fechar uma ordem invoca `action_revoked` duas vezes por linha (`wo_guard_update` e
  `wo_guard_close`), e cada invocação chama `current_user_role()` até duas vezes — uma
  na isenção do admin, outra na comparação do papel — o que dá até quatro consultas a
  `user_roles` por linha fechada. A função é `STABLE`, portanto o planeador pode dobrar
  as chamadas, mas isso não é garantido dentro do `EXISTS`.
  Este repositório já foi mordido por `has_role` avaliado por linha em políticas de
  `work_orders` (`20260802080000_work_order_policies_evaluate_once.sql`, 220x mais lento
  a 349 ordens). Aqui o alcance fica limitado porque os dois escritores em lote — o
  auto-close do pg_cron e o sync do iTouching — não têm `auth.uid()` e saem pela cláusula
  `auth.uid() IS NOT NULL` sem chegar a `user_roles`.
- `SELECT` não é coberto. Esconder leitura exige editar políticas e fica fora deste piloto.
- Fechar uma ordem (inclusive via força) é uma `UPDATE`, portanto `wo_guard_update` dispara em paralelo com `wo_guard_close` e `wo_guard_force`. Revogar `wo.update` bloqueia igualmente o fecho normal — a negação acumula e falha fechado.

## Depois deste piloto

Se o padrão se aguentar, os lotes seguintes são cópia com outro nome de ação:
`downtime_events` + `downtime_corrections`, `quality_actions`, `daily_allocations`,
stock, `user_roles`. Ao todo, 40 das 69 ações do `MATRIX` não guardam nada hoje.
