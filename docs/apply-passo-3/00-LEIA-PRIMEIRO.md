# Passo 3 — as onze migrações que o `docs/apply/` não carrega

## O erro que isto corrige

```text
Something did not load
Could not find the table 'public.scoring_version' in the schema cache
```

**A tabela não existe.** Não é cache velha do PostgREST, não é um erro de nome, e não é
um defeito do frontend. `supabase/migrations/20260822090000_a_score_is_frozen_at_the_scale_of_its_day.sql`
cria `public.scoring_version`, `src/hooks/useScoringFreeze.ts` pergunta por
`scoring_version`, e os dois nomes batem certo. A migração nunca foi aplicada.

Medido a 19/08/2026 com `docs/apply/probe-schema.sh` — só leitura, usa a chave
publicável que já está no `.env` — contra `ybtrzqzliepknpzqdajx`:

| objecto | resposta | leitura |
|---|---|---|
| `quality_actions` | `200` | controlo: existe |
| `zzz_tabela_que_nao_existe` | `404` | controlo: não existe |
| `scoring_version` | `404 PGRST205` | **em falta** |
| `scoring_version_severity` | `404 PGRST205` | **em falta** |
| `scoring_version_label` | `404 PGRST205` | **em falta** |
| `scoring_version_excluded_label` | `404 PGRST205` | **em falta** |
| `scoring_version_excluded_department` | `404 PGRST205` | **em falta** |
| `quality_actions.points_at_creation` | `400 42703` | **em falta** |
| `quality_actions.scoring_version_id` | `400 42703` | **em falta** |
| `quality_options.is_gate` | `400 42703` | **em falta** |

O `42703` vem do Postgres **depois** de analisar a query, por isso exclui de vez a
hipótese de ser cache do PostgREST — o mesmo argumento que o
`docs/pending-migrations-apply.sql` usa no seu cabeçalho.

## Porque é que ficou por aplicar

O `docs/apply/` existe precisamente para isto: nada neste repositório aplica uma
migração, aplica-as uma pessoa, à mão, colando de um ficheiro. **O último bloco desse
pacote é o 08, `20260820090000`.** Onze migrações aterraram desde então e nenhuma delas
tinha um ficheiro para colar — a segunda é a que cria `scoring_version`.

O pacote ficou dez atrás sem ninguém reparar. Por isso o
`src/__tests__/theApplyPackageStopsWhereTheErrorStarts.test.ts` prende agora este
ficheiro ao conteúdo de `supabase/migrations/`: uma migração nova que fique de fora
falha o teste.

## O que está no ficheiro

`APPLY-ALL-IN-ORDER.sql`, blocos 09 a 25, reconstruídos **byte a byte** a partir de
`supabase/migrations/` — verificado pelo teste, não presumido.

| bloco | migração | o que traz |
|---|---|---|
| 09 | `20260821090000` | guarda de acções sobre work orders |
| 10 | `20260822090000` | **`scoring_version` e as suas três tabelas** + `points_at_creation` |
| 11 | `20260822093000` | o cartão do próprio líder lê a figura congelada |
| 12 | `20260823090000` | um rótulo agrava, nunca suaviza |
| 13 | `20260824090000` | `quality_options.is_gate` — um CCP falhado também é um tecto |
| 14 | `20260826090000` | a linha semanal aprende sobre as acções |
| 15 | `20260827090000` | o portão de evidência |
| 16 | `20260827093000` | `scoring_version_excluded_department` — um departamento pode ser de outro |
| 17 | `20260827113000` | `leader_self_scorecard` projecta `domain` e `safety_kind` |
| 18 | `20260828090000` | Maintenance tem a sua própria lista, e um perigo pode custar |
| 19 | `20260829090000` | Semeia 7 atribuições líder↔linha — sem elas o quadro semanal vem vazio |
| 20 | `20260830090000` | o primeiro plano de uma célula nunca chegava ao Planner |
| 21 | `20260831090000` | `stock.pricing` passa a governar alguma coisa — um preço não é o mesmo direito que uma quantidade |
| 22 | `20260901090000` | os dois interruptores do portão de qualidade passam a poder desligar-se |
| 23 | `20260902090000` | `production_office_admin` — a migração de 28/07 tinha ficado a meio |
| 24 | `20260903090000` | `description`, `machine`, `location` e `photo_url` em `products` |
| 25 | `20260904090000` | a tolerância de fim de turno passa de 15 para 30 minutos |

## A ordem não é negociável

Cronológica, e importa: o bloco 10 cria as tabelas que o 11 lê, e o 16 acrescenta uma
coluna a uma tabela que o 10 cria. Fora de ordem, a colagem falha a meio e deixa o
esquema num estado a que ninguém sabe dar nome.

## Pode ser colado mais do que uma vez

Ao contrário do `APPLY-ALL-IN-ORDER.sql` do `docs/apply/`, que **não sobrevive a uma
segunda passagem**. Aqui não é sorte, foi verificado ficheiro a ficheiro:

- o seed de `scoring_version` tem `WHERE NOT EXISTS (SELECT 1 FROM public.scoring_version)`;
- o backfill só escreve colunas que estão a `NULL`, portanto não pode reescrever uma
  figura já congelada — a própria migração diz isso em comentário;
- o `INSERT` em `quality_options` tem `ON CONFLICT DO NOTHING`;
- tudo o resto é `CREATE ... IF NOT EXISTS`, `CREATE OR REPLACE`, ou um bloco `DO` que
  verifica antes de mexer.

Os `DELETE` que aparecem num grep estão **dentro do corpo** de
`scoring_version_snapshot` e correm quando essa função é chamada, não ao colar.

## Como correr

Este projecto é **Lovable Cloud**. A base vive na organização do Lovable, não na do
utilizador, por isso não há CLI do Supabase que lá chegue e reautorizar o conector
Supabase é beco sem saída.

1. **More → Cloud → SQL editor** no editor do PMSYSTEM, e colar o ficheiro inteiro.
   Não gasta créditos e não precisa do dashboard do Supabase.
2. Em alternativa, colar no chat do editor com a instrução explícita de aplicar
   **verbatim** e de **não** aplicar as outras migrações pendentes.

## Depois de correr, verificar em vez de acreditar

```bash
bash docs/apply/probe-schema.sh
```

Tudo o que está `404`/`400` na tabela acima tem de passar a `200`. Se ficar a meio,
parar e olhar.

O que a sonda **não** consegue ver, porque a RLS fecha estas tabelas ao anónimo e elas
respondem `200 []` existam ou não as linhas: se o backfill correu, se `CAP_LabelPoints`
ficou semeado, e se as quatro etiquetas ficaram marcadas. Isso vem do
`docs/apply/VERIFY-scoring-rules.sql` e do `VERIFY-frozen-points.sql`, corridos no SQL
editor.

Um ficheiro neste repositório é o recibo do que se pretendeu, nunca a prova do que a
base tem.

## O toast em si

Enquanto isto não for aplicado, `useScoringFreeze` continua a ler "não congelado" — que
é a resposta correcta para esta base — e os ecrãs continuam a avisar que mudar um peso
re-pontua o histórico, o que é verdade aqui.

O que deixa de acontecer é o toast. `68c13c95` marca as duas queries cujo assunto é
"esta migração aterrou?" com `meta.schemaOptional`, e o `queryCache.onError` do
`App.tsx` deixa de gritar por cima de um ecrã que já tratou do assunto. **Essa correcção
está no ramo, não em produção** — o preview corre o `main`, e o PR #417 ainda não foi
fundido. Até lá o toast aparece na página de Quality Actions mesmo com o código correcto
escrito.
