# Passo 2 — aplicar, um bloco de cada vez

Os oito ficheiros `.sql` desta pasta são o `docs/pending-migrations-apply.sql` partido
pelas suas próprias fronteiras. Juntos reconstroem-no byte a byte — foi verificado, não
presumido. Existem por um motivo prático: colar de um ficheiro de 3190 linhas obriga a
procurar as fronteiras à vista, e é aí que alguém corre o bloco 6 antes do 5.

**A ordem não é negociável.** O bloco 2 faz `DROP TABLE IF EXISTS
public.leader_scorecard_thresholds` — a tabela que a v1 criava — e recria a tabela na
forma da v1 se ela não existir. Fora de ordem, perde-se o backfill.

## Como correr

No SQL Editor do Supabase, com um papel que ignora o RLS (o `postgres` do editor serve).
Para cada ficheiro, por ordem de 01 a 08:

1. Cole o ficheiro inteiro.
2. Corra.
3. **Confirme que terminou sem erro antes de passar ao seguinte.** Um bloco que falha a
   meio deixa o seguinte a assentar em algo que não existe.

Se um bloco falhar, pare e guarde a mensagem. Não salte para o seguinte.

| # | Ficheiro | Linhas | O que traz |
|---|---|---|---|
| 01 | `a_label_can_carry_its_own_points` | 41 | `quality_options.points` |
| 02 | `health_and_safety_is_the_second_gate` | 1476 | o módulo: tabelas, enums, as views, os rollups, a tendência, o ranking, o trigger da CAPA, RLS |
| 03 | `the_screen_asks_the_database` | 114 | `volume_source`, `scorecard_week_board`, `scorecard_derived_volume` |
| 04 | `safety_shares_the_log_but_not_the_score` | 52 | `quality_actions.domain` e `safety_kind` |
| 05 | `the_week_counts_its_own_safety` | 70 | `scorecard_safety_counts` |
| 06 | `a_gate_is_a_ceiling_not_a_weight` | 1086 | o score 0-100 de duas camadas, os pesos versionados, os tetos |
| 07 | `the_score_crosses_the_board_rpc` | 62 | as quatro colunas de score na RPC do quadro |
| 08 | `filling_a_week_is_not_approving_it` | 247 | preencher deixa de ser aprovar: RLS e assinatura da aprovação |

**A migração `20260814090000` fica de fora de propósito** — é a v1 do scorecard. O bloco
02 cria a tabela na forma da v1 se ela não existir, e como não existe, aplicar a v1
primeiro só acrescenta uma tabela para logo a seguir a largar.

## Antes e depois

O antes já está medido, em [`../scorecard-v2-estado-antes.md`](../scorecard-v2-estado-antes.md):
nenhum objecto do módulo existe, e os controlos respondem, portanto a ausência é real e
não falta de autorização.

Depois de os oito blocos passarem, corra
[`../../supabase/tests/verify_scorecard_v2_deployment.sql`](../../supabase/tests/verify_scorecard_v2_deployment.sql).
Só lê. Tem de dar `PRESENTE` em tudo — incluindo
`v_leader_weekly_scorecard.volume_source`, que é a linha que apanha o defeito de a view
não expor a coluna e o ecrã apagar o carimbo a cada gravação.

Depois disso, os dois ficheiros de teste, que abrem transacção e fazem `ROLLBACK`:

- `supabase/tests/leader_weekly_scorecard_test.sql`
- `supabase/tests/scorecard_weighted_score_test.sql`

Ambos imprimem `ALL TESTS PASSED` na última linha. Se um deles abortar antes disso, a
mensagem nomeia o caso que falhou.

## E depois de a base estar feita

Duas coisas que não são SQL e ficam por fazer, ou o ecrã continua a não mostrar dados:

1. Regenerar `src/integrations/supabase/types.ts`. Enquanto não for regenerado, o código
   fala com a base através de conversões (`as any`) — funciona, mas não há verificação de
   tipos sobre estas tabelas.
2. Tirar o `.skip` de `e2e/leader-scorecard-week.spec.ts`. Está lá porque o teste conduz
   a aplicação real contra a base real e não podia passar antes disto. **Tirá-lo é o
   último passo deste procedimento, não arrumação opcional.**

## O que nada disto prova

Nenhuma linha destes oito ficheiros correu contra PostgreSQL. Foram validadas por
`libpg_query` (parsing) e por leitura, e o parser não entra dentro de corpos plpgsql nem
de blocos `DO $$ … $$`. O primeiro contacto com um Postgres a sério é o seu.
