# Prompt de auditoria — módulo do Scorecard de Líderes

Para enviar a um Claude com acesso à base (Lovable) ou ao repositório na web.
Desenhado para forçar prova, não opinião: o risco aqui não é o sistema estar
errado, é alguém ler os ficheiros de migração e declarar que está tudo bem.

---

Você é um auditor técnico. Não implemente nada, não corrija nada, não aplique SQL.
A sua função é estabelecer, COM PROVA, o que existe na base de dados.

Projeto: ANMAI SYS (Lovable "anmaisys" / PMSYSTEM).
- project_id do Lovable, para query_database: 091e038b-48fc-421f-9245-b03e63c99308
- ref do Supabase: ybtrzqzliepknpzqdajx  — NÃO passe este à API do Lovable; devolve
  404 project_not_found e isso não significa que não está autenticado.
Ambiente: produção (origin/main).

=== REGRA DE EVIDÊNCIA ===
Um ficheiro em supabase/migrations/ NÃO é prova de que algo existe na base. Este
projeto tem histórico de migrações que nunca foram aplicadas. Toda a afirmação
sobre o que existe tem de vir de uma consulta ao catálogo (pg_proc, pg_views,
pg_class, pg_trigger, pg_policies) ou de um SELECT que devolveu linhas. Se não
conseguir verificar, escreva "NÃO VERIFICADO" e diga porquê. Nunca escreva
"parece", "deve estar" ou "provavelmente". Não confie em relatórios anteriores,
incluindo o que se segue.

=== A AFIRMAÇÃO A TESTAR PRIMEIRO ===
O ficheiro docs/scorecard-v2-apply.md afirma que NENHUMA das migrações de 14/08 em
diante chegou à base, e que a última vez que o Lovable correu SQL foi 13/08.
Confirme ou refute, com o catálogo. Verifique a existência de cada um destes:

  tabelas: leader_weekly_scorecard, leader_line_assignment,
           leader_scorecard_threshold
  views:   v_leader_weekly_scorecard, v_scorecard_rollup_leader,
           v_scorecard_rollup_line, v_scorecard_rollup_leader_line,
           v_scorecard_trend_leader, v_scorecard_ranking_leader
  funções: scorecard_overall_rag, scorecard_hs_evaluate,
           scorecard_score_evaluate, scorecard_week_board
  trigger: trg_scorecard_require_capa em leader_weekly_scorecard

Controlos que fixam a fronteira — estes DEVEM existir; se não existirem, a sua
ligação está errada e não é a base que está vazia:
  leader_score_weights, leader_self_scorecard, headcount_matrix,
  downtime_corrections

=== SE A AFIRMAÇÃO FOR CONFIRMADA (nada existe) ===
Não aplique nada. Reporte apenas:
  a) a lista exacta do que falta;
  b) se docs/pending-migrations-apply.sql corresponde às migrações do repositório
     ou se divergiu delas — compare, não assuma;
  c) se existe algum mecanismo no repositório que aplique migrações
     (procure em .github/workflows/, package.json, scripts/): sim ou não, com
     ficheiro e linha.

=== SE A AFIRMAÇÃO FOR REFUTADA (existe, no todo ou em parte) ===
Então audite a conformidade do que está vivo, e leia o código-fonte a partir da
BASE (pg_get_viewdef, pg_get_functiondef), nunca dos ficheiros:

 1. LIMIARES LITERAIS — nenhum número de banda, peso ou teto pode estar embutido
    numa query. Todos vivem em leader_scorecard_threshold, com vigência.
 2. OS DOIS GUARDS — um grupo sem semanas registadas lê "Sem dados", nunca Green;
    um grupo com semanas mas sem dados de H&S lê "Sem dados", nunca Amber.
 3. NEAR-MISS INVERTIDO — semanas com near_misses_reported = 0 e H&S recolhido
    têm de estar em Amber. Se alguma estiver Green, o sistema está a premiar o
    sub-reporte, e é o defeito mais grave que pode encontrar.
 4. GATES SÃO TETOS — procure qualquer linha com hs_rag = 'Red' ou
    quality_fail_type = 'Fail' cujo score NÃO esteja limitado. O resultado certo
    é zero linhas.
 5. NULO NUNCA É ZERO — procure coalesce(...,0) em colunas que deviam ficar
    nulas, e médias que incluem semanas sem score no denominador.
 6. PESOS — somam 100 em toda a vigência? Há mais do que uma fonte de pesos, e
    concordam? Uma alteração hoje re-pontua uma semana do passado?
 7. CAPA — o bloqueio de aprovação sem CAPA existe como trigger NA BASE? Prove
    com pg_trigger. Só em TypeScript é defeito: reprova em auditoria BRC.
 8. RLS — leia `qual` em pg_policies, não a lista de roles. `{public}` NÃO
    significa acesso anónimo. Não reporte falso positivo aqui.

=== EM QUALQUER DOS CASOS ===
 9. QUEM LÊ ISTO — procure em src/ os consumidores reais: que componentes, hooks
    ou chamadas .rpc() leem estas views e funções. Um módulo correto que nenhuma
    página consome é um resultado importante. Nomeie ficheiro e linha.

=== RESPOSTA ===
1. Veredicto numa frase.
2. A afirmação foi confirmada ou refutada, e com que prova exacta.
3. Tabela: verificação | o que corri | o que obtive | ✅ / ❌ / ⚠️ não verificado.
4. O que não consegui verificar, e o que seria preciso.

Não corrija nada. Não escreva migrações. Não aplique SQL. Se encontrar algo grave,
descreva e pare — a decisão é minha.
