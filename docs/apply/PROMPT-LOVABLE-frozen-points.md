# Aplicar: congelar a pontuação na data da acção

Colar no chat do Lovable do projeto PMSYSTEM.

---

Aplica **duas** migrações que já estão no repositório, por esta ordem:

1. `supabase/migrations/20260822090000_a_score_is_frozen_at_the_scale_of_its_day.sql`
2. `supabase/migrations/20260822093000_the_leaders_own_card_reads_the_frozen_figure.sql`

Não alteres o conteúdo de nenhuma das duas. Não alteres nenhum ficheiro de frontend
nesta tarefa — o lado do cliente vai numa alteração separada e não pode ir antes desta.
Não mexas em políticas RLS existentes.

## Antes de aplicar

Corre `docs/apply/VERIFY-frozen-points.sql` e mostra-me o resultado. São só SELECTs.
O Bloco 1 decide se avanças:

- **0 linhas nos dois SELECTs do Bloco 1** → as migrações ainda não correram. Avança.
- **As tabelas e colunas já existem** → já foi aplicado. **Não apliques outra vez** e
  mostra-me antes o Bloco 2. Uma segunda passagem não deve estragar nada (o backfill só
  escreve o que está NULL e a segunda migração desiste se já encontrar a coluna na
  projecção), mas quero ver o estado antes de decidires por mim.
- **Estado a meio** — umas tabelas sim, outras não → **para e mostra-me**. Não adivinhes.

Mostra-me também, antes de aplicar, quantas acções existem:

    SELECT count(*) AS total_accoes FROM public.quality_actions;

Preciso deste número para conferir o backfill a seguir.

## O que estas migrações fazem

Criam `scoring_version` e três tabelas de retrato (severidades, preços de etiqueta,
etiquetas que não são do líder), acrescentam `points_at_creation`, `scoring_version_id`
e `points_recalculated_at` a `quality_actions`, e preenchem esses campos para todo o
histórico com a régua que está em vigor hoje.

Nenhum número muda em nenhum ecrã com isto. Os campos são escritos e ainda não são
lidos por nada — é de propósito, para poderem ser conferidos contra os valores actuais
antes de alguma coisa depender deles.

A segunda migração **não reescreve** `leader_self_scorecard`. Lê a definição que está
viva, confirma que tem a forma que espera, e reescreve só a lista de colunas. Se a
função tiver divergido do repositório, ela **levanta excepção de propósito** — nesse
caso para, cola-me a mensagem, e eu decido. Não a emendes.

## Depois de aplicar

Corre o verificador inteiro outra vez e mostra-me **todos** os blocos. Os que mais me
interessam:

- **Bloco 2** — `por_congelar` tem de ser **0** e `total` tem de bater com o número que
  me deste antes. `total` a zero não é sucesso, é a base errada.
- **Bloco 4** — tem de devolver **0 linhas** nas duas consultas. Uma diferença aqui
  significa que o retrato leu uma régua diferente da que está em vigor.
- **Bloco 5** — mostra-me a tabela cruzada inteira. Quero olhar para ela.
- **Bloco 7** — tem de devolver **true**.

## Regras

Não me digas "feito". Mostra-me o que a base respondeu — o output real de cada bloco.
Um "aplicado com sucesso" sem output não me serve, e já fui enganado por isso neste
projecto.

Se falhar a meio, cola-me a mensagem de erro exacta e **não tentes recuperar sozinho**.

Se alguma coisa no SQL te parecer errada, **diz-mo e espera**. Não emendes. Há uma linha
em particular que vais ter vontade de "melhorar" e que não podes tocar: o recálculo usa
`coalesce(NEW.scoring_version_id, ...)` — a versão da própria acção, não a de hoje. Trocar
isso por `current_date` desfaz silenciosamente tudo o que estas duas migrações fazem.
