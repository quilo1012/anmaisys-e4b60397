-- As perguntas que cinco vistorias deixaram em aberto e que so a base responde.
--
-- Todas de LEITURA. Nao alteram nada, nao abrem transacao, podem correr em qualquer
-- ordem. Cola no SQL Editor, uma seccao de cada vez.
--
-- Cada uma diz o que a resposta DECIDE. Uma consulta cuja resposta nao muda nenhuma
-- decisao nao esta aqui.
--
-- Porque nao foram corridas daqui: o PostgREST com a chave publica responde 200 com
-- lista vazia (o RLS filtrou) ou 401 (sem GRANT ao anon) -- em qualquer dos casos nao
-- distingue "nao ha linhas" de "nao posso ver as linhas", e nao expoe pg_policy de
-- todo. As perguntas de existencia de tabelas e vistas JA foram respondidas por
-- sondagem: das 125 que as migracoes criam, faltam 17, todas do scorecard v2.


-- ============================================================================
-- 1. O TRILHO DE AUDITORIA ESTA VIVO?   << CORRE ESTA PRIMEIRO >>
-- ============================================================================
-- Decide: se estiver parado, e mais grave do que tudo o resto neste ficheiro. E a
-- fundacao da defesa BRCGS.
--
-- CORRIGIDO em 16/08. A primeira versao desta seccao dizia que o trilho podia parar
-- "sem que nenhum ecra o diga", porque logAuditEvent engole falhas num console.error
-- (useAuditLogs.ts:152-154). Isso esta ERRADO, e foi verificado no codigo:
--
--   - installApiErrorTelemetry() corre no arranque (main.tsx:13) e embrulha o fetch
--     global; invokeFunction usa supabase.functions.invoke, que passa por la.
--   - Qualquer resposta nao-ok de /functions/v1/log-audit-event e registada em
--     system_telemetry_logs e aparece no Root Diagnostics como API_ERROR.
--   - A propria funcao so devolve 200 DEPOIS de o insert passar; se o insert falhar
--     devolve 500 (log-audit-event/index.ts:137-145).
--
-- Uma funcao nao publicada, ou a falhar a escrever, e portanto VISIVEL. O console.error
-- e o ultimo de tres registos, nao o unico.
--
-- O que continua verdade, e e a razao para correr isto: um sistema de erros nao detecta
-- SILENCIO. Se ninguem chamar logAuditEvent -- um refactor que deixa cair a chamada, um
-- tablet offline, uma sessao sem token -- nao ha erro nenhum e tambem nao ha linhas. E
-- zero linhas numa noite calma e a resposta certa. So olhando se sabe.
--
-- Ler assim: compara max(created_at) com a ultima vez que alguem fechou uma ordem ou
-- mexeu em utilizadores. Se houve accoes e nao ha linhas, parou.
--
-- ANTES DE CONCLUIR QUE MORREU: confirma com que conta estas no SQL Editor. A politica
-- de SELECT de audit_logs e so-admin (20260724140000), e correr isto com outro papel
-- devolve zero linhas -- que se le exactamente igual a "o trilho esta morto".
SELECT
  count(*)                                        AS eventos_7d,
  max(created_at)                                 AS mais_recente,
  now() - max(created_at)                         AS ha_quanto_tempo
FROM public.audit_logs
WHERE created_at > now() - interval '7 days';

-- E o mesmo por dia, para ver se parou de repente ou foi definhando:
SELECT date_trunc('day', created_at)::date AS dia, count(*)
FROM public.audit_logs
WHERE created_at > now() - interval '30 days'
GROUP BY 1 ORDER BY 1 DESC;


-- ============================================================================
-- 2. OS PESOS VIVOS SAO 40/30/30 OU 40/35/25?
-- ============================================================================
-- Decide: se aplicar ou nao a migracao 20260818090000, e quando.
-- A tabela existe e nasce 40/30/30 (20260730220000). O fallback TypeScript e
-- 40/35/25 (leaderScore.ts:26-30) e dispara sempre que a query falhar -- ou seja,
-- hoje o mesmo lider e pontuado de forma diferente conforme a rede soluce.
-- A 0818 re-baseia a tabela para 40/35/25: o Leader Performance de toda a gente
-- muda no dia em que for aplicada.
SELECT * FROM public.leader_score_weights;


-- ============================================================================
-- 3. OS TRES ACHADOS GRAVES DE AUTORIZACAO
-- ============================================================================
-- Decide: se um ecra escondido no React esta assente numa tabela que a base deixa
-- ler. Le pela clausula `qual` e por `permissive` -- a lista de roles com {public}
-- NAO significa acesso anonimo, e ja produziu falsos positivos aqui.
--
-- daily_allocations e attendance_days: a UI fechou-as a admin
-- (permissions.ts:179,194) e as migracoes deram SELECT a admin, manager, supervisor,
-- planner e production_office_admin. Sao ausencias, faltas e feriados de pessoas
-- nomeadas -- attendance_days chega a nomear "Sickness".
SELECT c.relname AS tabela,
       p.polname, p.polcmd, p.polpermissive,
       pg_get_expr(p.polqual, p.polrelid)      AS qual,
       pg_get_expr(p.polwithcheck, p.polrelid) AS with_check,
       (SELECT array_agg(r.rolname) FROM pg_roles r WHERE r.oid = ANY(p.polroles)) AS roles
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
WHERE c.relname IN ('daily_allocations', 'attendance_days', 'audit_logs', 'employees')
ORDER BY 1, 2;

-- production_office_admin: a migracao 20260728020000 da-lhe FOR ALL sobre ~60
-- tabelas, enquanto a UI lhe nega wo.delete, wo.force, quality.validate e
-- downtime.correct um a um. Decide: o FOR ALL foi abreviatura ou decisao?
SELECT c.relname AS tabela, p.polname, p.polcmd,
       pg_get_expr(p.polqual, p.polrelid) AS qual
FROM pg_policy p
JOIN pg_class c ON c.oid = p.polrelid
WHERE pg_get_expr(p.polqual, p.polrelid) ILIKE '%production_office_admin%'
ORDER BY 1, 2;


-- ============================================================================
-- 4. QUALITY_ACTIONS: DUAS COLUNAS QUE PODEM REBENTAR OU FICAR VAZIAS
-- ============================================================================
-- Decide (action_type_id): a migracao original cria-a NOT NULL REFERENCES ... ON
-- DELETE RESTRICT, e NENHUM insert em src/ a passa. Ou foi tornada nullable depois,
-- ou ganhou default/trigger -- ou o formulario rebenta na escrita.
--
-- Decide (leader_id): e a chave por que scorecard_safety_counts agrupa, enquanto
-- todos os ecras filtram por leader_name. Se estiver maioritariamente NULL, a funcao
-- devolve zeros com rows_missing_attribution a subir.
SELECT column_name, data_type, is_nullable, column_default
FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'quality_actions'
  AND column_name IN ('action_type_id', 'leader_id', 'leader_name', 'severity')
ORDER BY column_name;

SELECT count(*)                                    AS total,
       count(*) FILTER (WHERE leader_id IS NULL)   AS sem_leader_id,
       count(*) FILTER (WHERE leader_name IS NULL) AS sem_leader_name
FROM public.quality_actions;

-- E as colunas de quality_options, para o fallback de useQualityOptions.ts:39.
-- Esse fallback so reescreve a query a tirar `points`. Se o 42703 vier de `sort`, a
-- segunda tentativa falha igual e as listas todas caem.
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'quality_options'
ORDER BY ordinal_position;


-- ============================================================================
-- 5. OS 68% DA WEEKLY PRODUCTION REPORT SAO MEDIDOS?
-- ============================================================================
-- Decide: se a pagina inteira e um ecra de constantes. `prediction_log` nao tem UM
-- escritor em src/ nem em supabase/functions/, e a pagina imprime 68% em text-4xl
-- com "Baseline estimate" a 12px por baixo. Se a tabela estiver vazia e sem trigger,
-- o KPI deve ser escondido, nao explicado em letra pequena.
SELECT count(*) AS linhas, max(entry_date) AS mais_recente FROM public.prediction_log;

SELECT tgname, tgenabled FROM pg_trigger
WHERE tgrelid = 'public.prediction_log'::regclass AND NOT tgisinternal;


-- ============================================================================
-- 6. AS CHECKLISTS DAS ORDENS CHEGAM A ALGUEM?
-- ============================================================================
-- Decide: as checklists casam por TEXTO LIVRE -- useChecklistsByProblemName(
-- wo.description), contra problem_descriptions por nome, com a descricao escrita a
-- mao pelo operador no tablet. Se a cobertura for residual, o mecanismo nao esta a
-- funcionar e o casamento tem de deixar de ser por nome.
SELECT
  (SELECT count(DISTINCT work_order_id) FROM public.checklist_responses
     WHERE created_at > now() - interval '90 days')            AS wos_com_checklist,
  (SELECT count(*) FROM public.work_orders
     WHERE created_at > now() - interval '90 days')            AS wos_no_periodo;


-- ============================================================================
-- 7. O CICLO DE VIDA REAL DAS ORDENS
-- ============================================================================
-- Decide: `completed` e inalcancavel pela aplicacao (os dois hooks que o escreveriam
-- nao tem chamador) e `rejected` nao tem coluna no quadro nem entra em
-- WO_TERMINAL_STATUSES. Se `completed` so existir em historico antigo, sai do enum
-- ou fica documentado como legado; se `rejected` for frequente, precisa de casa.
SELECT status, count(*), min(created_at)::date AS primeira, max(created_at)::date AS ultima
FROM public.work_orders
GROUP BY status ORDER BY count(*) DESC;

-- Ordens fechadas SEM assinatura -- o buraco que o commit 205dcec3 fechou daqui para
-- a frente. Estas sao as que ja la estao, e nenhuma e distinguivel, no registo, de
-- uma que ninguem reviu.
SELECT count(*) AS fechadas_sem_assinatura
FROM public.work_orders
WHERE status = 'closed' AND (operator_signature_name IS NULL OR operator_signature_name = '');

-- E as que ficaram fechadas a segurar uma linha parada (mesmo caminho do arrasto):
SELECT count(*) AS fechadas_com_linha_por_retomar
FROM public.work_orders
WHERE status IN ('closed','finished','completed','force_closed')
  AND line_stopped IS TRUE AND line_resumed_at IS NULL;


-- ============================================================================
-- 8. O SCORECARD V2 (ja respondido, aqui para repetir depois de aplicar)
-- ============================================================================
-- Corre supabase/tests/verify_scorecard_v2_deployment.sql -- tem os tres controlos
-- que fixam a fronteira. Medido em 16/08: das 125 tabelas e vistas que as migracoes
-- criam, faltam 17, todas deste modulo, e mais nada em todo o esquema.
