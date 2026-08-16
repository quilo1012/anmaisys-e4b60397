# Acções de segurança no log da qualidade — desenho

Data: 2026-08-16 · Estado: por implementar

## Porquê

O módulo de qualidade já é, na prática, um registo genérico de desvios: severidade,
etiquetas, departamento, linha, líder, validação, fecho, anexos. Uma ocorrência de
segurança tem o mesmo ciclo de vida — registar, atribuir, validar, fechar — e hoje não
tem onde viver.

E o pilar de Health & Safety do scorecard semanal ([leader-scorecard.md](../../leader-scorecard.md))
já pressupõe este registo sem ele existir: um dos seus nove campos é
`overdue_hs_actions`, "acções de H&S fora do prazo", número que só pode existir se as
acções forem registadas uma a uma com dono e data.

## Decisões tomadas com o utilizador

| Decisão | Escolha | Alternativa recusada |
|---|---|---|
| Pontuação | segurança **não pontua** — só conta | pontuar com excepções; pontuar tudo igual |
| Estrutura | uma tabela, coluna `domain` | tabela `safety_actions` paralela |
| O que se regista | acidentes, primeiros socorros, quase-acidentes, observações, toolbox talks, falhas de EPI | — |
| EPI | como **ocorrência** (falha), não como percentagem | derivar `ppe_compliance_pct` do log |

**Porquê segurança não pontua.** O módulo de qualidade cobra pontos ao líder: mais acções
registadas, pior. Em segurança a regra é a inversa — reportar um quase-acidente é o
comportamento desejado e zero reportados sinaliza sub-reporte. Partilhar a pontuação faria
com que registar um near-miss penalizasse o líder, o contrário exacto da regra escrita no
scorecard, e ensinaria a equipa a não reportar.

**Porquê uma tabela e não duas.** Só a contabilidade difere; o ciclo de vida é idêntico.
Uma tabela paralela duplicaria a máquina de validação e fecho que já funciona, e este
projecto tem historial de construir sistemas paralelos que depois morrem.

**Porquê EPI é ocorrência.** Uma falha de EPI é um desvio com linha, pessoa e acção
correctiva — cabe no log tal como está. Mas contar falhas não produz uma percentagem de
conformidade: isso precisa de denominador, e o denominador só existe registando
*verificações* de EPI com passa/não passa. São coisas diferentes; esta spec faz a
primeira.

## Modelo de dados

Duas colunas em `quality_actions`, nenhuma tabela nova:

| Campo | Tipo | Nulo? | Regra |
|---|---|---|---|
| `domain` | enum `quality` \| `safety` | não | `DEFAULT 'quality'` — as linhas de hoje não mudam de sentido |
| `safety_kind` | enum | sim | `lost_time_injury`, `reportable_accident`, `first_aid`, `near_miss`, `safety_observation`, `toolbox_talk`, `ppe_breach` |

`CHECK`: existe `safety_kind` **se e só se** `domain = 'safety'`. Uma linha de segurança sem
tipo não é classificável, e uma de qualidade com tipo de segurança é uma contradição — nem
uma nem outra deve conseguir ser gravada.

`leader_id` e `line` **são anuláveis hoje** e continuam a sê-lo — apertá-los agora
rejeitaria linhas de qualidade já existentes. Mas uma ocorrência de segurança sem líder ou
sem linha não pode ser contada por líder nem por linha, e uma contagem que descarta linhas
em silêncio é exactamente a armadilha que este modelo existe para evitar. Portanto:

- o formulário **exige** líder e linha quando o domínio é segurança, e di-lo no ecrã;
- a derivação conta apenas as que os têm;
- as que não têm aparecem no bloco de integridade do resumo executivo do scorecard, ao
  lado do `rows_missing_line` que já existe lá, em vez de desaparecerem da aritmética.

## A pontuação morre num sítio só

`actionPoints()` devolve 0 quando `domain = 'safety'`, na primeira linha da função:

```ts
if (action.domain === "safety") return 0;
```

É a função que o cartão do líder, o breakdown da qualidade e o Analytics já leem. Uma linha
faz "não pontua" ser verdade em todos ao mesmo tempo, sem ninguém ter de se lembrar de
cada sítio. A severidade continua a ser gravada e mostrada: serve para triagem — saber a
gravidade — não para cobrar.

## O ecrã

A mesma página, com um selector no topo: **Quality · Safety · All**.

- Em Safety a tabela troca a coluna **Points** por **Kind**, porque Points seria sempre 0 e
  uma coluna de zeros ensina a ler mal.
- O diálogo de log troca o bloco Severity/Points por **Kind + Severity**.
- Primeiros socorros e quase-acidentes ficam visualmente separados. Um é consequência, o
  outro é sinal antecedente, e somá-los é o erro clássico deste modelo.
- O contador do cabeçalho (`Log (17)`) conta o que o separador activo mostra.

## O que o scorecard passa a derivar

Sete dos nove campos de H&S deixam de ser escritos à mão, contados do log por
líder × linha × semana:

| Campo do scorecard | Vem de |
|---|---|
| `lost_time_injuries` | contagem de `lost_time_injury` |
| `reportable_accidents` | contagem de `reportable_accident` |
| `first_aid_cases` | contagem de `first_aid` |
| `near_misses_reported` | contagem de `near_miss` |
| `safety_observations_done` | contagem de `safety_observation` |
| `toolbox_talks_done` | contagem de `toolbox_talk` |
| `overdue_hs_actions` | acções de segurança com prazo passado e por fechar |
| `ppe_compliance_pct` | **continua escrito à mão** — falta o denominador |
| `hs_training_compliance_pct` | **continua escrito à mão** — não é uma ocorrência |

**Uma acção rejeitada na validação não conta.** É o equivalente de segurança à regra que
já existe na qualidade: o que foi rejeitado não aconteceu para efeitos de contagem.

**As exclusões de atribuição não se aplicam.** A máquina de `countsAgainstLeader(...)`
existe para decidir a quem se *cobra*, e segurança não cobra. As contagens usam o líder e
a linha registados na ocorrência, tal como foram escritos.

## Fora de âmbito

- O formulário semanal do scorecard, que ainda não existe. A derivação acima liga-se
  quando esse ecrã for construído — e é mais uma razão para ele ler da base em vez de
  recalcular.
- Registo de *verificações* de EPI, que é o que permitiria derivar `ppe_compliance_pct`.
- Qualquer noção de RIDDOR ou de prazos legais de reporte. `reportable_accident` é aqui uma
  classificação humana, não uma regra automática.

## Riscos

- **As migrações pendentes.** Nada disto chega à base antes de
  [pending-migrations-apply.sql](../../pending-migrations-apply.sql) ser aplicado, e esta
  spec acrescenta mais uma à fila.
- **`quality_actions.points` é uma coluna morta.** Existe na tabela e nada a lê — os pontos
  são derivados por `actionPoints()`. Não é problema desta spec, mas quem implementar não
  deve escrever nela a pensar que serve para alguma coisa.
- **O nome do módulo deixa de descrever o conteúdo.** A tabela chama-se `quality_actions` e
  passa a guardar segurança. Renomear custaria mais do que vale agora; fica registado para
  que o nome não seja lido como âmbito.
