# Prompt para um Claude com acesso ao Supabase

Copie tudo o que está dentro do bloco e cole na conversa.

---

Preciso que apliques uma migração SQL na base de produção deste projecto. Lê tudo antes de agir.

**Projecto alvo: `ybtrzqzliepknpzqdajx`.** Confirma primeiro que é esse que alcanças, com
`list_projects`. Existem outras bases na mesma conta — `apblxaaktftinstoidvp` ("AN Maintenance")
e `zljsksshbauwbdgaavpi`. Se `ybtrzqzliepknpzqdajx` não estiver na lista, **para e diz-me**.
Não apliques nada noutra base. O SQL faz `DROP TABLE` e destruiria a app errada.

**O que aplicar:** o ficheiro `docs/apply/APPLY-ALL-IN-ORDER.sql` deste repositório, na íntegra.
São nove blocos de migração já concatenados pela ordem correcta (01, 02, 03, 04, 05, 05b, 06,
07, 08). Se não conseguires ler o ficheiro, pede-mo em vez de o reconstruíres.

**Regras que não podes quebrar:**

1. **Não reescrevas o SQL.** Nem para "melhorar", nem para modernizar sintaxe, nem para corrigir
   o que te pareça um erro. Se o bloco 06 for alterado, perde-se o tecto de Health & Safety em
   Red. Se algo te parecer errado, diz-mo e espera — não emendes.
2. **Não reordenes nem partas em pedaços.** O bloco 02 faz
   `DROP TABLE IF EXISTS public.leader_scorecard_thresholds` e recria-a; fora de ordem perde-se
   o backfill. O ficheiro corre como uma transacção única — é isso que o torna seguro.
3. **Não corras cada bloco separadamente.** Cola o ficheiro inteiro, de uma vez.

**Antes de aplicar, estabelece o estado da base.** Corre o verificador
`supabase/tests/verify_scorecard_v2_deployment.sql` (são só `SELECT`s) e mostra-me o resultado.
Isto decide tudo:

- **Base ainda sem os blocos** → aplicar é seguro. Avança.
- **Blocos já aplicados** → **NÃO apliques outra vez.** Uma segunda passagem rebenta em dois
  sítios conhecidos, e nesse caso o trabalho já está feito:
  - `DROP VIEW IF EXISTS public.v_leader_weekly_scorecard;` sem `CASCADE` → erro 2BP01, porque
    já existiriam `v_leader_weekly_scorecard_periods`, `v_scorecard_trend_leader` e `_line` a
    depender dela.
  - O backfill lê `line_leader`, `ccp_check_completed` e mais três colunas que o próprio script
    larga a seguir → `ERROR: column "ccp_check_completed" does not exist`.
- **Estado ambíguo** → para e mostra-me o que viste. Não adivinhes.

**Depois de aplicar**, corre o verificador outra vez e mostra-me o resultado completo.

**Não me digas "feito".** Mostra-me o que a base respondeu — o output real de cada passo. Um
"aplicado com sucesso" sem output não me serve para nada, e já fui enganado por isso neste
projecto. Se falhar a meio, cola-me a mensagem de erro exacta e **não tentes recuperar sozinho**:
a transacção desfaz-se inteira, a base fica como estava, e eu decido o passo seguinte.
