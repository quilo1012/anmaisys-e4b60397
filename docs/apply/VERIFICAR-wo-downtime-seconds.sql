-- Só leitura. Correr no SQL editor do Lovable (More → Cloud → SQL editor).
-- Responde a: quem pode executar as duas funções que v_wo_metrics chama, e quem
-- recebeu o erro "permission denied for function wo_downtime_seconds".
-- Não devolve dados de pessoas: só metadados e contagens.

-- 1) Definição, dono, SECURITY DEFINER/INVOKER e EXECUTE por papel.
--    wo_downtime_seconds foi criada pelo Lovable a 13/08/2026 directamente na base:
--    não existe em supabase/migrations/, por isso este é o único sítio onde se vê.
SELECT p.oid::regprocedure                                   AS funcao,
       pg_get_userbyid(p.proowner)                           AS dono,
       CASE WHEN p.prosecdef THEN 'DEFINER' ELSE 'INVOKER' END AS seguranca,
       p.provolatile                                         AS volatilidade,
       has_function_privilege('anon',          p.oid, 'EXECUTE') AS anon,
       has_function_privilege('authenticated', p.oid, 'EXECUTE') AS authenticated,
       has_function_privilege('service_role',  p.oid, 'EXECUTE') AS service_role,
       p.proacl::text                                        AS acl
FROM pg_proc p
JOIN pg_namespace n ON n.oid = p.pronamespace
WHERE n.nspname = 'public'
  AND p.proname IN ('wo_downtime_seconds', 'wo_total_pause_seconds');

-- 2) A view: security_invoker e quem tem SELECT.
SELECT c.relname, c.reloptions,
       has_table_privilege('anon',          c.oid, 'SELECT') AS anon_select,
       has_table_privilege('authenticated', c.oid, 'SELECT') AS authenticated_select
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public' AND c.relname = 'v_wo_metrics';

-- 3) Os registos do erro: por papel e por status HTTP (401 = pedido sem token, como anon;
--    403 = utilizador autenticado sem privilégio). Só contagens.
SELECT coalesce(user_role, '(sem papel)')       AS papel,
       (user_id IS NULL)                         AS sem_user_id,
       metadata->>'status'                       AS status,
       count(*)                                  AS registos,
       min(created_at)                           AS primeiro,
       max(created_at)                           AS ultimo
FROM public.system_telemetry_logs
WHERE error_type = 'RLS_ERROR'
  AND message ILIKE '%wo_downtime_seconds%'
GROUP BY 1, 2, 3
ORDER BY registos DESC;

-- 4) Os PUSH_STATE de iPhone na app do ecrã principal ainda em 'default', por papel.
--    O operator não vê o cartão "Turn on" (PushPromptBanner esconde-o de propósito).
SELECT coalesce(user_role, '(sem papel)')              AS papel,
       metadata->>'ios_version'                         AS ios,
       metadata->'last_error'->>'code'                  AS ultimo_erro,
       count(DISTINCT user_id)                          AS pessoas,
       max(created_at)                                  AS ultimo
FROM public.system_telemetry_logs
WHERE error_type = 'PUSH_STATE'
  AND metadata->>'platform'   = 'ios'
  AND metadata->>'display'    = 'standalone'
  AND metadata->>'permission' = 'default'
  AND created_at > now() - interval '14 days'
GROUP BY 1, 2, 3
ORDER BY pessoas DESC;
