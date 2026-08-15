# Ecrã de escrita do Scorecard de Líderes — desenho

Data: 2026-08-15 · Fase 1 de 3 · Estado: por implementar

## Porquê

O módulo do scorecard semanal existe só na base ([leader-scorecard.md](../../leader-scorecard.md)):
tabela, regras, rollups, testes — e zero linhas de dados. A folha de cálculo continua a
ser o sistema de registo. Esta fase dá-lhe o ecrã de **escrita**, sem o qual as views
ficam vazias para sempre e as fases seguintes não têm o que mostrar.

## Decisões tomadas com o utilizador

| Decisão | Escolha | Alternativa recusada |
|---|---|---|
| Trabalho do ecrã | escrever a semana, substituindo o Excel | quadro de leitura primeiro |
| Quem preenche | gestão, atrás de conta e permissão | o líder com PIN; entrada dividida por pilar |
| Fonte do volume | pré-preenchido da produção, corrigível com registo | derivar sempre; escrever à mão |
| Organização | semana à vista + gaveta de edição | só formulário; grelha editável |

**Porquê a gestão e não o líder:** `submitted_by` e `approved_by` são contas reais, e um
PIN não é um `auth.uid()` — numa auditoria BRC, uma conta com nome é prova mais forte.
Aprovar é ato de gestão: um líder a aprovar a sua própria semana de `Fail` anula o gate
da CAPA. E um líder a escrever o seu próprio zero near-miss é o sub-reporte que o modelo
pune. O modelo do líder com PIN fica para fase 3, depois de resolvida a identidade.

**Porquê pré-preencher o volume:** `rag_weekly_entries` já guarda `plan_qty` e
`actual_qty` por linha e semana, e `downtime` / `downtime_events` já guardam as paragens.
Pedir os mesmos quatro números à mão criaria duas verdades para o mesmo facto — o padrão
que este projeto já repetiu. Derivar sem edição foi recusado porque uma semana sem
registo no RAG Weekly ficaria com volume nulo e sem forma de destrancar pelo ecrã.

**Porquê a semana à vista:** a ideia central do módulo é que a ausência de dados é
informação — é para isso que existem os dois guards. Um ecrã que seja só formulário
mostra o que foi preenchido e não consegue mostrar quem falta.

## O ecrã não recalcula nada

O formulário **não reimplementa as regras dos pilares**. Grava um rascunho e volta a ler
`v_leader_weekly_scorecard` para aquela linha; o RAG e o `rag_driver` mostrados são o
veredicto da base, não uma segunda opinião do TypeScript.

Custo: uma ida ao servidor por alteração, com _debounce_ de 400 ms. Benefício: o ecrã não
pode discordar do relatório — a falha que este módulo existe para evitar, e a mesma razão
pela qual `leader_self_scorecard` mantém a aritmética num sítio só.

O bloco da CAPA aparece quando o servidor devolve `quality_fail_type = 'Fail'`. O botão
de aprovar fica desativado **com o motivo à vista** enquanto faltar causa, ação, dono ou
data. É o espelho de `trg_scorecard_require_capa`, nunca um substituto: se o ecrã e o
trigger discordarem, quem manda é o trigger, e a exceção dele aparece no toast.

## Rota e permissões

- Rota: `/dashboard/leader-scorecard`, em `src/pages/dashboard/LeaderScorecardWeekPage.tsx`.
  Nome distinto de `/dashboard/leader/scorecard`, que é o `leader_self_scorecard` e não se toca.
- Duas ações novas em [permissions.ts](../../../src/lib/permissions.ts), no padrão `domínio.verbo`:
  - `scorecard.fill` — manager, quality_supervisor, production_office_admin, admin
  - `scorecard.approve` — manager, quality_supervisor, admin (mais restrita que preencher)
- Entrada na sidebar de [DashboardLayout.tsx](../../../src/components/DashboardLayout.tsx), junto do RAG Weekly.

## Adições à base

Uma migração pequena, no mesmo estilo da do módulo:

- Coluna **`volume_source`** em `leader_weekly_scorecard`: enum `derivado` / `manual`,
  nula enquanto não houver volume. Torna uma correção manual visível na auditoria em vez
  de silenciosa, e é o que permite mostrar o valor derivado ao lado do corrigido.
- **`scorecard_week_board(_week_ending date)`** — as linhas esperadas da semana, vindas de
  `leader_line_assignment` com `LEFT JOIN` ao preenchido, mais o estado de cada uma. É o
  que faz “quem falta” aparecer sem ser procurado. A view `v_scorecard_period_spine` não
  serve: é por período, não por semana.
- **`scorecard_derived_volume(_line_id uuid, _week_ending date)`** — plano, real e minutos
  de paragem lidos de `rag_weekly_entries` e `downtime`, com a origem. Em SQL, e não no
  cliente, para que a derivação também tenha uma só definição.

## Componentes

| Ficheiro | Responsabilidade |
|---|---|
| `LeaderScorecardWeekPage.tsx` | rota, navegação entre semanas, contagens do rodapé |
| `ScorecardWeekBoard.tsx` | a lista da semana: uma linha por líder×linha, estado e RAG |
| `ScorecardEntryDrawer.tsx` | a gaveta: orquestra as faixas, grava, submete, aprova |
| `pillars/VolumePillar.tsx` | volume, com origem derivada e correção manual |
| `pillars/QualityPillar.tsx` | os três checks tri-estado e o tipo de falha |
| `pillars/HealthSafetyPillar.tsx` | os nove campos de H&S |
| `pillars/MonitoredPillar.tsx` | assiduidade e atrasos, marcados “não pontua” |
| `ScorecardVerdict.tsx` | o veredicto do servidor: RAG por pilar, overall, `rag_driver` |
| `CapaBlock.tsx` | causa, ação, dono, data, estado e verificação |
| `hooks/useScorecardWeek.ts` | `scorecard_week_board` |
| `hooks/useScorecardEntry.ts` | ler, gravar rascunho, submeter, aprovar |
| `hooks/useDerivedVolume.ts` | `scorecard_derived_volume` |

Cada faixa é um ficheiro seu: os pilares mudam por razões diferentes e em alturas
diferentes, e o de H&S sozinho tem nove campos e sete regras.

## Estados e erros

- **Vazio nunca é zero.** Um campo por preencher lê-se `—`. Um near-miss a zero é um
  número que alguém escreveu; um campo vazio não é, e a diferença é a razão de ser dos
  dois guards.
- **Quatro estados por linha:** por preencher · rascunho · submetida · aprovada.
- **H&S sem dados** aparece como tal, e não como Green nem como Amber.
- **Erro do trigger** — aprovar um `Fail` sem CAPA — aparece no toast com a mensagem da
  base, que já nomeia os quatro campos em falta.
- **Sem atribuição na semana:** se `leader_line_assignment` não cobrir a semana, a lista
  vem vazia com um estado que diz isso e liga à gestão de atribuições. Não é um erro.

## Testes

- **Vitest:** estado do quadro, transições dos quatro estados, formatação de vazio vs zero.
- **Playwright:** preencher → submeter → aprovar; a recusa de aprovar um `Fail` sem CAPA;
  e `assertNoWordIsBroken` nas etiquetas — este projeto tem `overflow-wrap: anywhere`
  global, que já produziu “QUALIT Y”.
- **SQL:** [leader_weekly_scorecard_test.sql](../../../supabase/tests/leader_weekly_scorecard_test.sql), já escrito, mais casos para as duas funções novas.

## Fora de âmbito

- Fase 2: o quadro de leitura — rollups A/B/C, tendência, ranking, resumo executivo.
- Fase 3: importação da folha de cálculo; e o preenchimento pelo líder com PIN.

## Riscos abertos

- **A migração do módulo ainda não foi aplicada.** Um probe ao PostgREST confirmou que
  `leader_weekly_scorecard` não existe na base. Nada nesta fase funciona antes disso.
- **Cobertura de `rag_weekly_entries`.** O desenho assume que cobre as linhas e as semanas
  relevantes. Se for irregular, o pré-preenchimento vem vazio com frequência e a fonte
  passa a ser, na prática, manual. Verificar com dados reais antes de implementar.
- **Grão diferente, e já decidido.** `rag_weekly_entries` é por linha e turno; o scorecard
  é por líder×linha×semana. Quando dois líderes cobrem a mesma linha na mesma semana, o
  derivado é oferecido **a ambos, com o mesmo valor e rotulado “volume da linha”**. Não é
  repartido: repartir exigiria saber que fração da semana coube a cada um, o que ninguém
  regista, e inventá-la seria pior do que mostrar o total com a origem à vista. Quem
  souber a repartição corrige à mão, e a correção fica marcada como manual.
