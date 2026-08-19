# Aplicar: a etiqueta agrava, e um CCP reprovado é um tecto

Colar no chat do Lovable do projeto PMSYSTEM.

**Estas duas mudam números em ecrãs que as pessoas leem.** As duas anteriores
(`PROMPT-LOVABLE-frozen-points.md`) não mudavam nenhum. Não as juntes na mesma sessão:
se algo se mover inesperadamente, tens de poder dizer qual das quatro o fez.

---

Aplica **três** migrações que já estão no repositório, **por esta ordem**:

1. `supabase/migrations/20260823090000_a_label_may_aggravate_never_soften.sql`
2. `supabase/migrations/20260824090000_a_failed_ccp_is_a_ceiling_too.sql`
3. `supabase/migrations/20260826090000_the_weekly_row_learns_about_the_actions.sql`

**`20260825090000_a_line_leader_is_not_an_account.sql` NÃO entra nesta lista — já está
aplicada.** Verificado a 19/08 em `origin/main:src/integrations/supabase/types.ts`, que é
gerado a partir da base real: `quality_actions_leader_id_fkey` aparece com
`referencedRelation: "line_leaders"`. Como as chaves para o schema `auth` não aparecem
nesse ficheiro, vê-la ali a apontar para `line_leaders` é prova de que a correcção
aterrou. Não a reapliques.

A terceira depende dela e recusa-se a correr sem ela — essa guarda vai passar.

Não alteres o conteúdo de nenhuma. Não alteres ficheiros de frontend nesta tarefa.

## Pré-requisito, e não é formalidade

`20260822090000` e `20260822093000` **têm de estar aplicadas primeiro**. Confirma com o
Bloco 1 de `docs/apply/VERIFY-frozen-points.sql` e mostra-me o resultado antes de
avançares.

A razão é uma armadilha silenciosa: a `20260823090000` faz `CREATE OR REPLACE` de
`public.action_points_at`, que a `20260822090000` também cria. Aplicadas pela ordem
errada, a versão da `22` aterra por último e a regra nova desaparece — **sem erro, sem
aviso, com tudo a parecer aplicado**. O Bloco 1 do verificador novo existe só para
apanhar isso.

## Antes de aplicar

Corre `docs/apply/VERIFY-scoring-rules.sql` inteiro e mostra-me o resultado. Espera-se:

- **Bloco 1** — erro ou `regra_max_viva = false`
- **Bloco 3** — erro 42703, a coluna `is_gate` não existe
- **Bloco 5** — já funciona, e é a contagem que quero ver **antes**

## O que estas duas fazem

**A primeira** troca "a etiqueta substitui a severidade" por `MAX(etiqueta, severidade)`.
Uma acção Critical com uma etiqueta barata valia o preço da etiqueta; passa a valer o
maior dos dois. Uma etiqueta pode agravar, nunca atenuar. Acrescenta também um tecto
opcional ao total das etiquetas, `CAP_LabelPoints`, **que não é semeado** — ausente
significa sem tecto, e é assim que deve aterrar.

**A segunda** marca quatro etiquetas como gate: Fail CCP, Foreign Body, Wrong weight
volume check, Bag Inside blender. Uma acção com qualquer delas limita o período a 49.

**A terceira** re-emite `v_leader_weekly_scorecard` para que a linha semanal responda
aos mesmos gates que o cartão do líder já respeita. Sem ela, o mesmo CCP reprovado dá
duas respostas conforme o ecrã que abrires.

Ela recusa-se a aplicar se a segunda não tiver corrido, ou se a correcção do
`leader_id` não estiver lá. Essa segunda dependência é a menos óbvia e a mais perigosa: enquanto `quality_actions.leader_id`
apontar para `auth.users`, uma acção com esse id preenchido não bate na junção por id
nem entra no ramo do nome — **escapa ao gate inteiro**, sem erro, e a semana fecha verde
com um CCP reprovado dentro. E não a reescrevas: o corpo da
view foi **gerado** a partir da definição em vigor com quatro edições dirigidas, não
redigitado, e há um teste no repositório que prova que tudo o resto é idêntico linha a
linha. Uma "melhoria" ali dentro quebra essa prova.

A segunda **vai falhar de propósito** se alguma das quatro etiquetas não existir com a
grafia exacta em `quality_options`. Não é um bug e não a emendes para contornar: manda-me
a mensagem, que traz a query para eu ver as grafias reais, e eu decido se se corrige a
migração ou o nome da etiqueta. Ela também não cria as etiquetas que faltem — inventar
uma categoria de segurança alimentar porque uma string não bateu poria no picker uma
etiqueta que ninguém na fábrica escolheu.

## Depois de aplicar

Corre o verificador inteiro e mostra-me tudo. O que decide:

- **Bloco 1** — `regra_max_viva = true` **e** `regra_antiga_ainda_la = false`. Se estiver
  ao contrário, foi aplicado fora de ordem: reaplicar só a `20260823090000` corrige.
- **Bloco 3** — exactamente **4** linhas.
- **Bloco 4** — mostra-me a tabela inteira. São os períodos que passam a fechar em <= 49,
  por líder e por mês. Quero ver isto antes de alguém abrir o ecrã.
- **Bloco 6** — mostra-me quantas semanas passam a Red por acção. Cada linha é um líder
  que vai perguntar porquê.
- **Bloco 5** — a contagem depois tem de ser **igual à de antes**. Estas migrações não
  re-pontuam nada: as acções que a regra antiga rebaixou continuam congeladas com o valor
  que tinham. Se este número mudar, alguma coisa re-escreveu história e paramos tudo.

## Regras

Não me digas "feito". Mostra-me o output real de cada bloco.

Se falhar a meio, cola-me a mensagem exacta e não tentes recuperar sozinho.
