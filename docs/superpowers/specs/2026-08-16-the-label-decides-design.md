# A etiqueta decide — desenho

Data: 2026-08-16 · Estado: por implementar

## Porquê

Registar uma acção de qualidade obriga hoje a responder três vezes à mesma pergunta.
Escolhe-se a **Severity**, escolhe-se o **Department**, escolhem-se as **Labels** — e as
três respostas descrevem o mesmo acontecimento. Um corpo estranho é sempre grave, é
sempre da Qualidade e vale sempre o mesmo; nada disso devia depender de quem está a
escrever nem do que se lembrou nessa noite.

O ecrã diz o que isso deu: **47 das 49 acções não têm severidade**. O campo existe,
ninguém o preenche, e a pontuação que dele depende fica a zero. Não é falta de
disciplina de quem regista — é um campo a pedir uma tradução mental ("isto é High ou
Critical?") no momento em que a pessoa só quer dizer o que aconteceu.

A etiqueta já sabe a resposta. Falta guardá-la lá.

## Decisões tomadas com o utilizador

| Decisão | Escolha | Alternativa recusada |
|---|---|---|
| Campo Severity no formulário | **sai** | ficar; ficar escondido no detalhe |
| Severidade nos ecrãs | **fica, só de leitura**, vinda da etiqueta | desaparecer; poder ser corrigida à mão |
| Etiquetas por departamento | **a etiqueta traz o departamento** | o departamento filtrar as etiquetas; só agrupar no ecrã |
| Duas etiquetas, dois departamentos | **a mais cara manda** | uma etiqueta só por acção; a primeira escolhida |
| Departamento na acção | **derivado, não gravado** | manter a coluna gravada |
| Editor de pesos por severidade | **desaparece** | manter escondido |
| Trabalho paralelo em conflito | **seguir este desenho e desfazer o outro** | parar; fazer só a parte que não choca |

**Porquê "a mais cara manda" para tudo.** Uma acção com "Batch code + Maintenance"
precisa de um departamento só e de um grau só. A etiqueta mais cara é a que já está a
definir o preço da acção, portanto usá-la também para o grau e para o departamento dá
**uma regra a lembrar em vez de três**. Empate de preço, ou nenhuma etiqueta preçada:
fica a primeira escolhida — determinístico, e ainda assim honesto sobre a ordem.

**Porquê derivar em vez de gravar.** Este módulo já assume o princípio duas vezes: os
pontos nunca foram uma coluna, e re-preçar uma etiqueta re-pontua a história. Gravar a
severidade e o departamento na acção criaria uma segunda fonte de verdade que envelhece
— mudar "Foreign Body" para o departamento Quality deixaria 200 acções antigas a dizer
Production, e o ecrã passaria a mentir sobre a sua própria configuração.

## Conflito com trabalho paralelo

O commit `352f2364` *"Type the points, get the severity"* (2026-08-16 13:46) foi na
direcção oposta: manteve a Severity no formulário e acrescentou-lhe uma caixa de Points
acoplada. **Esta spec desfaz essa parte do formulário**, por decisão explícita do
utilizador.

O que lá foi construído **não se perde, muda de ecrã**: `severityForPoints()` e
`severityPointsMap()` passam a servir a gestão de listas — escrever `4` no preço de uma
etiqueta sugere o grau Critical. A ideia era boa; estava no sítio errado. Quem preça
agora é a Quality, uma vez por etiqueta, não quem regista, uma vez por acção.

Havia trabalho por gravar em `qualityConstants.ts`, `leaderScorecard.ts` e
`leaderScore.ts` (um `documentationPenaltyPct()` novo) no momento em que esta spec foi
escrita. **O plano de implementação tem de começar por confirmar que esse trabalho
assentou**, porque toca nos mesmos ficheiros.

## Modelo de dados

Duas colunas em `quality_options`, ao lado do `points` que já lá está. Nenhuma tabela
nova.

| Campo | Tipo | Nulo? | Regra |
|---|---|---|---|
| `severity` | `text` | sim | `CHECK` em `low` \| `medium` \| `high` \| `critical`; nulo = por graduar |
| `department_id` | `uuid` | sim | aponta para uma linha `kind = 'department'` da própria tabela |

**Só as etiquetas as carregam.** O `CHECK` existente já proíbe `points` numa linha de
departamento; alarga-se a estas duas. A regra vive onde não pode ser contornada por
quem escrever o próximo ecrã.

**A chave estrangeira aponta mesmo para um departamento**, não para uma etiqueta
qualquer. Um `CHECK` não consegue ler o `kind` da linha referenciada, por isso usa-se
uma FK composta:

```sql
ALTER TABLE public.quality_options ADD CONSTRAINT quality_options_id_kind_key
  UNIQUE (id, kind);
ALTER TABLE public.quality_options
  ADD COLUMN department_id uuid,
  ADD COLUMN department_kind text GENERATED ALWAYS AS
    (CASE WHEN department_id IS NULL THEN NULL ELSE 'department' END) STORED;
ALTER TABLE public.quality_options
  ADD CONSTRAINT quality_options_department_is_a_department
  FOREIGN KEY (department_id, department_kind)
  REFERENCES public.quality_options (id, kind) ON DELETE RESTRICT;
```

`MATCH SIMPLE` (o padrão) dá a coluna nula de graça: com `department_id` nulo a
restrição está satisfeita, apesar de `department_kind` nunca o ser.

`ON DELETE RESTRICT` faz o resto: apagar um departamento com etiquetas lá dentro é
**recusado pela base**, e o ecrã diz quais são as etiquetas em vez de mostrar um erro
de Postgres.

### A coluna `quality_actions.severity`

Fica na base — é história, e apagá-la destruiria o grau das acções já registadas. Mas
**deixa de ser escrita e deixa de ser lida pela aplicação**. Não se cria migração para
a largar; cria-se um comentário na coluna a dizer que está congelada e porquê.

## A derivação, num sítio só

Em `qualityConstants.ts`, ao lado de `actionPoints`:

```
labelMeta(label)      → { points, severity, department } | null
dominantLabel(action) → a etiqueta mais cara; empate ou tudo a 0 → a primeira
actionSeverity(action)   → dominantLabel(action)?.severity ?? null
actionDepartment(action) → dominantLabel(action)?.department ?? null
```

`actionPoints` **não muda**: continua a somar todas as etiquetas preçadas, com a
exclusão de atribuição (Maintenance não conta ao líder). A dominância decide o grau e o
departamento, não o preço — somar continua a ser somar.

Nota de ordem: a exclusão de atribuição **não** entra na dominância. Uma acção só de
Maintenance custa 0 ao líder e continua a ser do departamento de Manutenção e a ter o
grau dessa etiqueta. Excluir da dominância deixaria a acção sem departamento nenhum.

O mapa das etiquetas já é carregado à cabeça da aplicação por `useLabelPointsSync`
(montado em `App.tsx`), precisamente para que funções puras chamadas de gráficos,
células de tabela e construtores de PDF lhe cheguem. Passa a carregar os três valores e
muda de nome para `useLabelMetaSync`.

**O intervalo em que ainda não carregou** é conhecido e aceite: durante um instante uma
acção lê-se sem grau, e depois salta para o dela. É o mesmo comportamento que os pesos
de severidade já têm hoje.

## Quem lê severidade hoje

Deixar de gravar a coluna alcança oito ficheiros fora da página da Qualidade. Todos
passam a chamar `actionSeverity(a)` e todos precisam de pedir `labels` à base:

| Ficheiro | Hoje | Muda |
|---|---|---|
| `components/ControlCentreHome.tsx` | `a.severity === "high" \| "critical"` | já pede `labels`; troca a leitura |
| `components/production/LineIndicators.tsx` | idem | já pede `labels`; troca a leitura |
| `hooks/useReportSummary.ts` | conta `critical` | **acrescentar `labels` ao `select`** |
| `hooks/useQualityIssue.ts` | detalhe | troca a leitura |
| `lib/qualityReport.ts` | PDF: chip, "By Severity", `highCritical` | **acrescentar `labels` ao tipo de entrada** |
| `lib/performanceReport.ts` | PDF: chip de severidade | idem |
| `pages/dashboard/ProductionPerformancePage.tsx` | `select(... severity ...)` | **acrescentar `labels`** |
| `pages/dashboard/AnalyticsPage.tsx` | gráficos por severidade | troca a leitura |

É o triplo do trabalho que o desenho aparentava à primeira vista, e é a razão pela qual
esta spec existe em vez de uma alteração directa.

## O formulário

A ordem actual começa pela Severity — o campo que sai. A nova começa pelo que agora
pontua.

```
Log quality action

O QUE ACONTECEU
  QUALITY        [Foreign Body 5p] [GMP] [Fail CCP]
  PRODUCTION     [Batch code] [Label] [Wrong weight volume check]
  MAINTENANCE    [Missing Tools] [Maintenance 3p]
  ┌──────────────────────────────────────────────┐
  │ Quality · Critical · 5 pts                   │
  └──────────────────────────────────────────────┘

ONDE E QUANDO
  Line [Line 3 ▾]   Date [16/08/2026]   Shift [Day ▾]
  Linha, data e turno preenchem líder, SKU e lote.

QUEM
  Leader [Marcelo ▾]

  SKU [auto]   Batch code [auto]
  Notes [                                        ]
```

Saem dois campos, entram três títulos e uma linha de resumo. O resumo é o ponto do
exercício: quem regista **vê o que vai marcar antes de gravar**, em vez de descobrir
depois na tabela.

Os chips agrupam-se por departamento, por ordem do `sort` da etiqueta dentro de cada
grupo. Etiquetas sem departamento juntam-se num grupo final **Sem departamento** — vê-se
que faltam, em vez de desaparecerem.

## A gestão de listas

Cada linha de etiqueta ganha dois controlos ao lado da caixa de pontos que já tem:

```
LABELS
  Foreign Body    Pts [ 5 ]  Sev [Critical ▾]  Dept [Quality ▾]      Hide  🗑
  Missing Tools   Pts [ 2 ]  Sev [Low ▾]       Dept [Maintenance ▾]  Hide  🗑
```

Escrever um preço **sugere** o grau através de `severityForPoints()` — o trabalho
recuperado do `352f2364`. Sugere, não impõe: preço e grau são independentes, e uma
etiqueta pode valer 0 e ainda assim ser Critical (é exactamente o caso das acções de
segurança, adiante).

O editor de pesos por severidade sai deste ecrã. Quem preça é a etiqueta.

**A tabela `quality_severity_points` fica, e continua a ser carregada** por
`useSeverityPointsSync`. Deixa de pontuar seja o que for — é só a tabela de conversão
que faz "4 → Critical" na sugestão acima. Sem editor, os valores em vigor congelam nos
que lá estão hoje, que é o que se quer: uma tabela de conversão que ninguém precisa de
mexer não devia ocupar um ecrã de gestão.

## Interacção com a spec das acções de segurança

A spec [acções de segurança no log da qualidade](2026-08-16-safety-actions-in-the-quality-log-design.md),
ainda por implementar, decidiu que **segurança não pontua**. Com a severidade a vir do
preço, uma etiqueta de segurança a 0 ficaria sem grau nenhum — e um acidente sem grau é
pior do que um acidente mal graduado.

É por isso que **`severity` e `points` são colunas independentes** e não uma derivada da
outra. Uma etiqueta de segurança preça 0 e grada Critical: não cobra pontos ao líder, e
continua a aparecer como crítica em todo o lado. As duas specs encaixam sem que nenhuma
tenha de ceder.

## Semear

O dia em que isto entra, nenhuma etiqueta tem departamento e nenhuma tem grau. Sem
semear, as 49 acções de hoje ficavam sem departamento no log.

A migração semeia o mapeamento a partir do que as acções já dizem: para cada etiqueta, o
departamento **mais frequente** entre as acções que a carregam. É o que o histórico já
afirma, e a Quality corrige na gestão de listas o que estiver errado.

O grau **não se semeia**: 47 das 49 acções não têm severidade, portanto não há de onde
tirar. As etiquetas nascem por graduar e a Quality gradua-as uma vez.

## Testes

Em `src/__tests__/`, junto aos que já existem para `actionPoints` e `labelPoints`:

- `dominantLabel`: a mais cara ganha; empate → a primeira; tudo a 0 → a primeira; sem
  etiquetas → nulo.
- `actionSeverity` / `actionDepartment`: lêem a dominante; a etiqueta excluída da
  atribuição continua a mandar; etiqueta sem grau → nulo, não "low".
- `actionPoints` **inalterado** — os 1705 testes que passam hoje continuam a passar, e é
  esse o sinal de que a dominância não contaminou a soma.
- Uma etiqueta a 0 pontos com grau Critical dá 0 pontos e grau Critical (o caso da
  segurança), provado por teste para que ninguém o "arrume" depois.
- A FK: apagar um departamento com etiquetas é recusado. Teste ao nível da migração.

## Não faz parte

- Não se apaga a coluna `quality_actions.severity` nem se toca no histórico já gravado.
- Não se mexe na atribuição ao líder (`quality_label_attribution`) — é outra pergunta.
- Não se muda o import de acções para além do mínimo de deixar de escrever `severity`.
- Não se implementa a spec das acções de segurança; só se garante que esta não a parte.
