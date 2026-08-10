# Corrigir o tempo de uma paragem, com o nome de quem corrigiu

**Data:** 2026-08-10
**Estado:** desenho aprovado, por implementar

## O problema

O tempo de paragem de uma ordem de manutenção é hoje aquilo que os carimbos
disserem, e os carimbos são postos por quem se lembrou de carregar no botão. A
WO-824 tem 287 minutos contra ela porque a linha voltou a trabalhar de manhã e a
ordem só foi retomada às 11:34. Ninguém tem como corrigir aquilo: não há ecrã, e
a política de RLS `dt_update` em `downtime_events` não inclui
`maintenance_manager`, por isso a base de dados recusaria de qualquer maneira.

O número não é decorativo — é por ele que as linhas e os engenheiros são
medidos. Um número errado que não pode ser corrigido é pior do que um número
errado que pode, e a correcção só vale se ficar escrito quem a fez e porquê.

## O que se vai construir

O Fabio Crespo (`maintenance_manager`) e os admins passam a poder corrigir a
hora de início, a hora de fim ou a duração de uma paragem já registada. Cada
correcção fica visível na própria ordem — incluindo na versão impressa — com o
valor anterior, o novo, quem corrigiu, quando e porquê.

Fora de âmbito: corrigir o motivo da paragem, apagar paragens, corrigir
`production_downtimes` (o lado da produção, alimentado pelo iTouching).

## Decisões e porquê

### O rasto vive em tabela própria, não no `audit_logs`

A leitura de `audit_logs` é exclusiva de admin — a única política `SELECT` é
`has_role(auth.uid(), 'admin')`. O Fabio não veria a correcção que ele próprio
fez, nem o engenheiro que abre a ordem. O rasto tem de estar onde quem lê a
ordem consegue chegar.

Continua a escrever-se também no `audit_logs`, como o resto da aplicação faz,
mas o que a ordem mostra vem da tabela nova.

### A escrita passa por uma RPC, não por uma RLS aberta

Acrescentar `maintenance_manager` à política `dt_update` dá-lhe a linha inteira:
poderia reescrever `stopped_reason`, `stopped_by_name`, `episode_number` — apagar
de quem foi a paragem e porquê. A RPC toca em três campos, valida, grava a
correcção e devolve o antes/depois numa só transacção.

É o padrão que o projecto já usa em `force_close_work_order`.

### Os minutos movem a hora de fim

O mesmo tempo é hoje lido de duas maneiras: `WorkOrderDetail.tsx` prefere os
carimbos (`resumed_at − stopped_at`) e a view `v_wo_downtime_total`, que alimenta
os quadros, prefere `duration_minutes`. Se a correcção mexesse só nos minutos, a
mesma paragem passaria a ter dois números em dois ecrãs.

Escrever minutos grava `resumed_at = stopped_at + minutos`. Os carimbos e a
duração dizem sempre o mesmo, e nenhuma view existente precisa de ser tocada.

## Componentes

### 1. `downtime_corrections` — o registo

Tabela só de inserção, uma linha por correcção. Uma paragem pode ser corrigida
mais do que uma vez e o histórico completo fica.

```text
id                     uuid pk
downtime_event_id      uuid → downtime_events(id) on delete cascade
work_order_id          uuid → work_orders(id)     -- desnormalizado: a ordem lê por aqui
corrected_by           uuid → auth.users(id)
corrected_by_name      text not null
corrected_at           timestamptz not null default now()
prev_stopped_at        timestamptz not null
prev_resumed_at        timestamptz
prev_duration_minutes  integer
new_stopped_at         timestamptz not null
new_resumed_at         timestamptz
new_duration_minutes   integer
reason                 text not null
```

`work_order_id` é guardado na linha para que a ordem carregue as correcções com
uma consulta só, sem passar pelos eventos.

**RLS:** leitura para quem já vê a ordem — a mesma condição da política
`Scoped downtime_events select`, que já cobre admin, manager,
maintenance_manager, engineer, o operador da ordem e o operador da linha.
Inserção: ninguém directamente. Só a RPC escreve, e escreve como `definer`.

### 2. `correct_downtime_event(...)` — a regra

```sql
correct_downtime_event(
  _event_id    uuid,
  _stopped_at  timestamptz,
  _resumed_at  timestamptz,   -- null quando se corrige pela duração
  _minutes     integer,       -- null quando se corrige pelas horas
  _reason      text
) returns jsonb                -- { wo_number, prev_minutes, new_minutes, corrected_by_name }
```

`SECURITY DEFINER`, `search_path = public`. Executável por `authenticated`;
recusa lá dentro quem não for `admin` nem `maintenance_manager`.

Regras, por ordem:

| Verificação | Resultado se falhar |
|---|---|
| Quem chama é `admin` ou `maintenance_manager` | `RAISE EXCEPTION` |
| O evento existe | `RAISE EXCEPTION` |
| `_reason` não é vazio depois de `btrim` | `RAISE EXCEPTION` |
| `_stopped_at` não está no futuro | `RAISE EXCEPTION` |
| Se vierem `_minutes` **e** `_resumed_at`, os minutos ganham | — |
| `_minutes` presente → `resumed_at := _stopped_at + _minutes` | — |
| `_minutes` ausente e `_resumed_at` presente → `duration := round(diff em minutos)` | — |
| A paragem está aberta (`resumed_at` original é null) e vem duração | `RAISE EXCEPTION` — retomar a linha primeiro |
| `resumed_at` final é anterior ao `stopped_at` final | `RAISE EXCEPTION` |
| Duração final negativa | `RAISE EXCEPTION` |

Depois de validar: `UPDATE downtime_events` nos três campos, `INSERT` na
`downtime_corrections` com o antes e o depois, `INSERT` no `audit_logs` com
acção `downtime_corrected`, e devolve o resumo.

A ordem pode estar em qualquer estado, incluindo `closed` e `force_closed` — a
correcção costuma vir do fecho da semana, e bloquear no fecho da ordem é
garantir que o número errado fica para sempre.

### 3. Permissão

`downtime.correct: ["admin", "maintenance_manager"]` em
[`src/lib/permissions.ts`](../../../src/lib/permissions.ts), com a descrição na
tabela de textos e a entrada correspondente em `permissions.test.ts`.

Distinta da `downtime.adjust` que já existe: essa governa acrescentar uma
paragem esquecida e marcar tempo de equipa, e inclui supervisores, engenheiros e
co-engenheiros. Reescrever um número já registado é mais restrito de propósito.

O ecrã lê `can("downtime.correct")` para decidir se mostra o lápis; a RPC
verifica outra vez. Não são duas fontes de verdade — é a matriz a decidir o que
se vê e a base de dados a impedir o que não se vê.

### 4. `src/lib/downtimeCorrection.ts` — a aritmética

Função pura, sem Supabase, partilhada entre o ecrã e os testes:

```ts
resolveCorrection(input): { stoppedAt, resumedAt, durationMinutes } | { error }
```

Aplica as mesmas regras da tabela acima. O ecrã usa-a para mostrar a duração
enquanto o utilizador escreve e para desactivar o botão antes de chamar a RPC; a
RPC repete a validação porque é ela que manda.

### 5. Ecrã

**Lápis "Corrigir"** em cada linha do histórico de paragens da ordem, visível só
com `can("downtime.correct")`.

**Diálogo** com os três campos — início, fim, duração — em que escrever a
duração recalcula o fim à vista, e escrever o fim recalcula a duração. Motivo
obrigatório, com o botão desactivado enquanto estiver vazio. Mostra sempre o
valor original por cima, para que a correcção seja uma comparação e não uma
substituição às cegas.

**Histórico de paragens:** uma paragem corrigida mostra por baixo
`5 min → 12 min · corrigido por Fabio Crespo`.

**TIMELINE** da ordem, entrada nova, ordenada por `corrected_at` como todas as
outras e incluída na impressão:

```text
✏️ 10/08 15:40:12  Stoppage corrected
                   by Fabio Crespo — 5min → 12min
                   reason: "operator resumed late"
```

## Testes

- `permissions.test.ts`: `downtime.correct` concede a admin e maintenance_manager
  e recusa a manager, supervisor, engineer, co_engineer, operator e viewer.
- `downtimeCorrection.test.ts`: minutos movem o fim; horas calculam a duração;
  minutos ganham quando vêm os dois; fim antes do início é erro; motivo vazio é
  erro; duração numa paragem aberta é erro; o segundo arredondamento não perde
  minutos.
- RPC: verificada na base real dentro de `begin … rollback`, provando que uma
  chamada de `maintenance_manager` corrige e regista, e que a mesma chamada por
  um engenheiro é recusada. É a técnica que provou o trigger dos códigos
  planeados no mesmo dia.
- Regressão: depois de uma correcção, o cartão *Production Impact* da ordem e a
  view `v_wo_downtime_total` devolvem o mesmo número.

## Riscos

**A ordem impressa muda depois de assinada.** Uma correcção posterior ao fecho
altera um documento que alguém já imprimiu. É deliberado, e é por isso que a
entrada na timeline não é opcional: o papel novo mostra a correcção e o antigo
mostra o valor antigo, e os dois juntos contam a mesma história.

**As exclusões de tempo de equipa não se movem.** Se uma correcção encurtar a
paragem para menos do que a exclusão que lhe está sobreposta, a dedução passa a
ser maior do que a própria paragem. A subtracção é feita no cliente —
`Math.max(0, gross − excludedMin × 60)` em `WorkOrderDetail.tsx` — por isso o
resultado não fica negativo, mas fica zero, e a ordem passa a dizer que não
houve paragem nenhuma. O teste de regressão tem de cobrir este caso.

Nota: a `v_wo_downtime_total` não desconta exclusões de todo. Quer dizer que os
quadros e o ecrã da ordem já hoje mostram números diferentes numa ordem com
tempo de equipa marcado. Não é criado por este trabalho e não se resolve aqui,
mas é o mesmo padrão de duas leituras da mesma coisa que esta correcção teve de
contornar, e merece uma decisão à parte.

**A migração `20260731180000` não está aplicada.** O ficheiro no repositório cria
`planned_stop_minutes` e uma view de downtime líquido; nenhuma das duas existe na
base de dados. Nada neste desenho depende delas — o desenho assenta no que a base
tem — mas a diferença entre o repositório e a produção é real e vale a pena
esclarecer antes de alguém assumir que aquele ficheiro descreve o sistema.
