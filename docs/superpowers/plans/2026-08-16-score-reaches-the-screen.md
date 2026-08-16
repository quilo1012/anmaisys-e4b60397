# O score chega ao ecrã, e os testes voltam a correr — plano de implementação

Duas dívidas deixadas pela secção M do scorecard de líderes, e nada mais.

1. `supabase/tests/leader_weekly_scorecard_test.sql` está partido: tem zero `INSERT`,
   afirma sobre fixtures que nunca cria, e a linha 68 está corrompida
   (`-- ==============================================================END $$;`). Não
   pode passar como está.
2. O score calculado em `v_leader_weekly_scorecard` não é devolvido pela RPC
   `scorecard_week_board`, portanto nenhuma superfície de leitura o vê.

**Fora de âmbito, e deliberadamente.** Existe um plano separado e maior,
`docs/superpowers/plans/2026-08-15-leader-scorecard-week-screen.md`, com 14 tarefas
para o ecrã de escrita completo (página, rota, hooks, gaveta, faixas, submissão). Desse
plano só a migração de apoio e o componente do quadro foram executados —
`ScorecardWeekBoard` não tem hoje nenhum consumidor em `src/`. Este plano **não** o
continua. Meio ecrã construído é pior do que nenhum, e a decisão de o terminar é do
utilizador, não desta execução.

## Global Constraints

Vinculam todas as tarefas. Uma violação é um defeito, mesmo que a tarefa não a repita.

- **Nenhum limiar, peso ou teto literal.** Nenhum número de banda, mínimo, peso ou teto
  pode aparecer dentro de query, view, função ou TypeScript. Todos vivem em
  `public.leader_scorecard_threshold`, com vigência, resolvidos à data da semana.
- **"Sem dados" nunca é zero, e nunca é Green nem Amber.** Um score nulo é nulo: não é
  0, não leva teto, e não entra no denominador de média nenhuma.
- **Um gate nunca vira peso.** Qualidade e Health & Safety limitam por cima. Nada pode
  ser colocado acima dos dois primeiros ramos de `scorecard_overall_rag`.
- **Nomes reais nunca aparecem.** Nenhum nome real de líder ou de linha em SQL, testes,
  comentários ou exemplos. Só placeholders (`LIDER_A`, `LINHA_1`).
- **Migrações são aditivas.** Nunca editar um ficheiro de migração já existente; criar
  um novo, com data posterior a `20260818090000`.
- **Nada corre contra a base.** Não há Postgres nem Docker neste ambiente. SQL valida-se
  por _parsing_: `python3 -c "import pglast; pglast.parse_sql(open('FICHEIRO').read())"`
  (o pacote já está instalado). Nunca afirmar que algo "corre" ou "passa" na base.
- **Verificação obrigatória antes de dizer que acabou:** `npm run typecheck` e
  `npx vitest run`, ambos limpos, com a saída colada no relatório. `npx tsc --noEmit` na
  raiz sai sempre 0 e não prova nada — não usar.
- **Estilo do que está à volta.** Os comentários do módulo SQL são em inglês e explicam
  o *porquê*, não o *quê*. As strings visíveis ao utilizador seguem a língua que cada
  ficheiro já usa (o SQL do scorecard fala português ao utilizador; o componente do
  quadro está em inglês). Não uniformizar nada por gosto próprio.

---

### Task 1: Repor o ficheiro de testes da v2

**Ficheiro:** `supabase/tests/leader_weekly_scorecard_test.sql` (reescrever).

O ficheiro tem de passar a ser auto-contido: cria as suas próprias fixtures, afirma,
e faz `ROLLBACK`. O modelo a seguir, no mesmo directório, é
`supabase/tests/scorecard_weighted_score_test.sql`, escrito na tarefa anterior — mesmas
funções auxiliares (`pg_temp.expect`, `pg_temp.expect_true`), mesma estrutura, mesmo
cabeçalho a dizer como se corre.

Reparar também a linha corrompida (a linha 68 junta um separador de comentário e um
`END $$;` na mesma linha).

Casos que o ficheiro tem de cobrir — são os obrigatórios da especificação A–L, e as
duas primeiras são a razão de o ficheiro existir:

- grupo com atribuição e **zero semanas registadas** → `quality_rag = 'Sem dados'`,
  `hs_rag = 'Sem dados'`, `overall_rag` nulo, `near_misses_per_week` nulo (uma taxa
  sobre nada não é uma taxa de zero). Nunca Green.
- grupo com semanas mas **sem nenhum dado de H&S** → `hs_rag = 'Sem dados'`, **não**
  Amber. Sem este guard, `near_misses_per_week = 0` dispara a regra de sub-reporte e o
  grupo que ninguém preencheu aparece meramente âmbar.
- **zero near-miss reportado** numa semana com H&S recolhido → `hs_rag = 'Amber'`, e o
  `hs_driver` nomeia o sub-reporte.
- **volume 108%** → `volume_rag = 'Amber'` (superprodução), não Green.
- **"Fail" vs "Not Done"** → mesmo `quality_rag = 'Red'`, `quality_fail_type` diferente,
  `capa_required` verdadeiro só no Fail.
- **LTI = 1** com volume a 100% e qualidade Green → `overall_rag = 'Red'`.
- **líder que troca de linha a meio do trimestre** → aparece sob as duas linhas, cada
  uma com as semanas que lhe caíram, e a agregação bate nos rollups A, B e C.
- **downtime não planeado** → `volume_pct` inalterado e `volume_pct_adjusted` maior.
- **H&S nulo não bloqueia o overall** → cai para a regra de volume/qualidade.

Notas de esquema que poupam tempo: `line_leaders` exige `name` e `shift`
(`'DAY'|'NIGHT'|'BOTH'`); `lines` exige `name` único; `leader_weekly_scorecard` tem
`leader_id NOT NULL`, `line_id` nulo permitido, grão único
`(leader_id, line_id, week_ending)` com `NULLS NOT DISTINCT`, e `planned_volume > 0`.
As views de rollup são `v_scorecard_rollup_leader`, `v_scorecard_rollup_line` e
`v_scorecard_rollup_leader_line`, com `period_type` `'mensal'`/`'trimestral'`.

O comentário do cabeçalho actual avisa que os casos de rollup assumem a tabela vazia,
porque a espinha dos períodos tira o calendário do `min`/`max` de `week_ending` de toda
a tabela. Mantém esse aviso: continua verdadeiro, e agora as fixtures do próprio
ficheiro também alargam a espinha.

**Verificação:** o ficheiro tem de parsear com `pglast`. Não pode ser executado.

---

### Task 2: O score atravessa a RPC do quadro

**Ficheiro:** nova migração `supabase/migrations/20260819090000_<nome>.sql`.

`scorecard_week_board(_week_ending date)` devolve hoje os quatro RAG, o `rag_driver` e
`capa_required`. Passa a devolver também, lidos da mesma view que já lê
(`v_leader_weekly_scorecard`, o `LEFT JOIN w`):

- `score_final numeric`
- `score_bruto numeric`
- `cap_reason text`
- `cap_applied boolean`

Restrição de PostgreSQL que decide a forma da migração: **não se pode
`CREATE OR REPLACE` uma função mudando o seu `RETURNS TABLE`.** É preciso
`DROP FUNCTION IF EXISTS public.scorecard_week_board(date);` antes do `CREATE`. E o
`DROP` leva consigo os `GRANT`, portanto o `REVOKE`/`GRANT` do fim da migração
`20260816090000` tem de ser repetido:

```sql
REVOKE ALL ON FUNCTION public.scorecard_week_board(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scorecard_week_board(date) TO authenticated;
```

O resto do corpo mantém-se **igual ao que está** — mesma ordem de colunas existentes
(as novas vão para o fim), mesmo `LEFT JOIN`, mesmo `ORDER BY ll.name, ln.name`, mesmo
`LANGUAGE sql STABLE SET search_path TO 'public'`. Copiar o corpo da migração
`20260816090000_the_screen_asks_the_database.sql`, não reescrevê-lo de memória.

Um comentário no topo tem de explicar porquê `DROP` e não `CREATE OR REPLACE`, e porquê
os `GRANT` voltam.

**Verificação:** parsear com `pglast`. Não executar.

---

### Task 3: O score no quadro da semana

**Ficheiros:** `src/lib/scorecardWeek.ts`, `src/components/scorecard/ScorecardWeekBoard.tsx`,
`src/__tests__/scorecardWeek.test.ts`.

- `ScorecardBoardRow` ganha os quatro campos da Task 2, com os mesmos nomes e
  `| null` onde a base pode devolver nulo (`score_final`, `score_bruto` e `cap_reason`
  são nulos numa semana por preencher ou sem checks; `cap_applied` é nulo quando não há
  semana).
- O componente ganha uma coluna **Score**, entre Overall e State. Mostra o
  `score_final` arredondado para baixo, como `src/lib/leaderScore.ts` já faz e explica
  (`displayScore`: um 99,7 que imprime "100" é uma dedução que se arredondou a si
  própria). Quando o score é nulo mostra um travessão, **não** um zero.
- Quando houve teto, o `cap_reason` tem de estar visível ao utilizador — é a única coisa
  que explica porque é que o número não é a soma ponderada. Um `title` no elemento não
  chega sozinho num quadro que se lê de relance: usa também uma marca visível (o teto é
  má notícia, e o ficheiro já tem `RagChip` para vocabulário de cor).
- Uma função pura nova em `src/lib/scorecardWeek.ts` para a formatação do score
  (nulo → travessão, número → inteiro arredondado para baixo), testada em
  `scorecardWeek.test.ts`. A lógica não vive dentro do JSX.
- Testes novos: score nulo não imprime zero; 99,7 imprime 99; uma linha com teto expõe
  o motivo. Manter os 8 testes que já lá estão a passar.

**Verificação:** `npm run typecheck` e `npx vitest run`, ambos limpos.
