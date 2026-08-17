# Passo 2 — aplicar, um bloco de cada vez

Oito dos nove ficheiros `.sql` desta pasta são o `docs/pending-migrations-apply.sql`
partido pelas suas próprias fronteiras. Os oito numerados 01–08 reconstroem-no byte a
byte — foi verificado, não presumido. Existem por um motivo prático: colar de um ficheiro
de 3190 linhas obriga a procurar as fronteiras à vista, e é aí que alguém corre o bloco 6
antes do 5.

**O nono, `05b`, não vem do `pending-migrations-apply.sql` — vem de lhe faltar.**
`20260817120000_safety_has_its_own_labels` existe em `supabase/migrations/` mas escapou
por completo ao ficheiro consolidado quando este foi montado. É ela que alarga o
`quality_options_kind_check` para aceitar `safety_label`, o `kind` que a app escreve em
`useQualityOptions.ts`. Sem ela, gravar um rótulo de segurança dá:

```text
new row for relation "quality_options" violates check constraint "quality_options_kind_check"
```

Aplicar os oito blocos e mais nada **não** corrige esse erro. Por isso `05b` está aqui, e
por isso a contagem já não fecha com o ficheiro consolidado.

**A ordem não é negociável.** O bloco 2 faz `DROP TABLE IF EXISTS
public.leader_scorecard_thresholds` — a tabela que a v1 criava — e recria a tabela na
forma da v1 se ela não existir. Fora de ordem, perde-se o backfill.

## Como correr — este projecto é Lovable Cloud

A base é gerida pelo Lovable, e o Lovable é o único mecanismo que alguma vez correu SQL
nela. Os ficheiros de migração com nome UUID neste repositório (`20260813104724_4c005913-…`,
em commits chamados "Changes") não são instruções por executar: são o **recibo** que o
Lovable escreve de volta no git depois de já ter corrido o SQL.

Há dois caminhos, e o segundo é o preferível quando existe.

### Caminho A — pedir ao Lovable (sempre disponível)

Um bloco por mensagem, de 01 a 08 — com o `05b` entre o 05 e o 06, na ordem em que o seu
carimbo manda — esperando que cada um termine antes de enviar o seguinte. Use o texto de [`PROMPT-LOVABLE.md`](PROMPT-LOVABLE.md) — está escrito para
impedir a única coisa que corre mal aqui: o agente do Lovable reescrever o SQL que lhe
dão. Se ele "melhorar" o bloco 06, perde-se a correcção do teto de Health & Safety em
Red; se reordenar, perde-se o backfill.

Depois de cada bloco, confirme no repositório que apareceu um recibo novo, ou pergunte-lhe
que SQL correu. **Um "feito" do agente não é prova de que correu** — ver
[`../scorecard-v2-estado-antes.md`](../scorecard-v2-estado-antes.md) para a sondagem que
prova, sem credenciais de serviço.

### Caminho B — o SQL Editor, se o alcançar

O Lovable Cloud continua a assentar num projecto Supabase real (`ybtrzqzliepknpzqdajx`).
Se conseguir chegar ao SQL Editor desse projecto pela vista de backend do Lovable, cole
cada ficheiro inteiro e corra, com um papel que ignora o RLS (o `postgres` do editor
serve). É o caminho mais directo, porque o texto vai para a base exactamente como está
aqui, sem um agente pelo meio.

Em qualquer dos caminhos: **confirme que cada bloco terminou sem erro antes de passar ao
seguinte.** Um bloco que falha a meio deixa o seguinte a assentar em algo que não existe.
Se um falhar, pare e guarde a mensagem. Não salte para o seguinte.

| # | Ficheiro | Linhas | O que traz |
|---|---|---|---|
| 01 | `a_label_can_carry_its_own_points` | 41 | `quality_options.points` |
| 02 | `health_and_safety_is_the_second_gate` | 1476 | o módulo: tabelas, enums, as views, os rollups, a tendência, o ranking, o trigger da CAPA, RLS |
| 03 | `the_screen_asks_the_database` | 114 | `volume_source`, `scorecard_week_board`, `scorecard_derived_volume` |
| 04 | `safety_shares_the_log_but_not_the_score` | 52 | `quality_actions.domain` e `safety_kind` |
| 05 | `the_week_counts_its_own_safety` | 70 | `scorecard_safety_counts` |
| 05b | `safety_has_its_own_labels` | 39 | o `kind` `safety_label` e os oito perigos — **em falta no ficheiro consolidado** |
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
