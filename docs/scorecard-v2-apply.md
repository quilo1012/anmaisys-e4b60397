# Aplicar o scorecard v2 à base

Estado em 16/08/2026: **nenhuma das migrações abaixo chegou à produção.** Medido
contra o PostgREST de `ybtrzqzliepknpzqdajx`, com controlos que fixam a fronteira.

## Porque é que isto aconteceu

Nada no repositório aplica migrações. `.github/workflows/ci.yml` não tem passo de
Supabase e não há `supabase db push` em lado nenhum. Um ficheiro em `supabase/migrations`
é texto até alguém o correr — e o único mecanismo que alguma vez correu SQL nesta base é
o Lovable.

Os ficheiros com nome UUID (`20260813104724_4c005913-…`, em commits chamados "Changes")
não são instruções por executar: são o **recibo** que o Lovable escreve de volta no git
depois de já ter corrido o SQL. Confundir recibo com instrução é o que faz o repositório
parecer aplicado quando não está.

A fronteira medida:

| Objeto | Migração | Base |
|---|---|---|
| `leader_score_weights` | 30/07, nome descritivo | presente |
| `headcount_matrix`, `v_line_live_status.planned` | 08–12/08 | presente |
| `leader_self_scorecard` | 11/08 | presente |
| `downtime_corrections` | 13/08, nome UUID | presente |
| **tudo o que se segue** | **14–19/08** | **ausente** |

Tudo até 13/08 está na base. 13/08 é a última vez que o Lovable correu SQL. 14/08 é o dia
em que o scorecard v2 começou a ser escrito. O SQL não tem defeito — o passo de o entregar
ao Lovable deixou de ser feito, oito vezes seguidas.

## A ordem não é negociável

`20260815140000` faz `DROP TABLE IF EXISTS public.leader_scorecard_thresholds` (linha
1472) — a tabela que `20260814090000` cria. Fora de ordem, perde-se a tabela e o backfill.

**O artefacto executável é [`pending-migrations-apply.sql`](pending-migrations-apply.sql).**
Este documento explica; aquele corre. Se os dois discordarem, aquele manda — e alguém
esqueceu-se de actualizar este.

Oito blocos, por ordem cronológica, um de cada vez, confirmando que cada um termina sem
erro antes do seguinte:

1. `20260815120000_a_label_can_carry_its_own_points.sql`
2. `20260815140000_health_and_safety_is_the_second_gate.sql`
3. `20260816090000_the_screen_asks_the_database.sql`
4. `20260817090000_safety_shares_the_log_but_not_the_score.sql`
5. `20260817093000_the_week_counts_its_own_safety.sql`
6. `20260818090000_a_gate_is_a_ceiling_not_a_weight.sql`
7. `20260819090000_the_score_crosses_the_board_rpc.sql`
8. `20260820090000_filling_a_week_is_not_approving_it.sql`

**`20260814090000` fica de fora de propósito** — a v1 do scorecard. A migração de 15/08
cria a tabela na forma da v1 se ela não existir, e como não existe, aplicar a v1 primeiro
só acrescenta uma tabela para logo a seguir a largar. Uma versão anterior deste documento
listava-a como passo 1: estava a divergir do ficheiro que se cola.

## Antes e depois

Correr [`supabase/tests/verify_scorecard_v2_deployment.sql`](../supabase/tests/verify_scorecard_v2_deployment.sql)
nos dois momentos. Só lê.

**Antes:** os três CONTROLOS têm de dizer `PRESENTE`. Se algum disser `AUSENTE`, a
fronteira acima está errada e não se aplica nada até perceber porquê.

**Depois:** tudo `PRESENTE`, com uma exceção deliberada — `leader_scorecard_thresholds`
(plural) fica `AUSENTE`, porque o passo 3 a larga de propósito. A que fica é
`leader_scorecard_threshold`, no singular.

O passo 8 é o único que não cria objetos: reescreve a política de escrita e o trigger da
CAPA que `20260815140000` instala, para que preencher e aprovar deixem de ser a mesma permissão
abaixo do ecrã (`scorecard.fill` inclui `production_office_admin`, `scorecard.approve`
não) e para que uma aprovação tenha de ser assinada por quem a faz — `approved_by =
auth.uid()`, e com papel que possa aprovar. Correr fora de ordem, antes de `20260815140000`, aborta
com a mensagem a dizer qual é o ficheiro em falta, sem aplicar metade.

## O que a migração 6 não faz

`scorecard_safety_counts` devolve `NULL` em `overdue_hs_actions`. Não é um esquecimento:
`quality_actions` não tem coluna de prazo nenhuma — verificado contra a base e contra
`types.ts` — e o formulário da qualidade também não pede uma. Sem prazo gravado não há
atraso mensurável, e a spec manda devolver `NULL` em vez de inventar um número. Um zero
leria-se como "nada em atraso".

Fechar isto precisa de uma decisão de produto antes de código: que prazo tem uma acção de
segurança, e quem o define.

## Riscos herdados

Já registados em [`leader-scorecard.md`](leader-scorecard.md) e ainda por resolver:

- `NULLS NOT DISTINCT` exige PostgreSQL 15+.
- `btree_gist` tem de poder ser criada; sem ela as duas restrições de não-sobreposição
  não são aplicáveis.
- **Nomes órfãos:** se alguma semana da v1 tiver um `line_leader` que não case com
  `line_leaders.name`, o passo 3 **aborta a nomear os órfãos**. É o comportamento
  desejado — corrigir os nomes e repetir, nunca contornar.
- Nada em `src` chama estes objetos ainda ([`scorecardWeek.ts`](../src/lib/scorecardWeek.ts)
  só tem tipos). Aplicar isto desbloqueia trabalho; não repara nenhum ecrã parado.
