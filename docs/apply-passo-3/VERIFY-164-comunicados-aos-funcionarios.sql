-- Verificação do BLOCO 164. Só lê. Esperado: todas as linhas 'ok'.

select '164 coluna announcements.rung_at' as check,
       case when exists (select 1 from information_schema.columns
                          where table_schema = 'public' and table_name = 'announcements' and column_name = 'rung_at')
            then 'ok' else 'FALTA' end as result
union all
select '164 só um publish_announcement, com p_publish_at',
       case when (select count(*) from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                   where n.nspname = 'public' and p.proname = 'publish_announcement') = 1
             and exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = 'publish_announcement' and 'p_publish_at' = any (p.proargnames))
            then 'ok' else 'FALTA' end
union all
select '164 funções do ecrã: ' || f,
       case when exists (select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace
                          where n.nspname = 'public' and p.proname = f)
            then 'ok' else 'FALTA' end
  from unnest(array['update_announcement', 'delete_announcement', 'withdraw_announcement', 'read_announcement',
                    'my_announcements', 'announcements_manage_list', 'announcement_read_report',
                    'announcement_audience_options', 'announcement_audience_preview']) f
union all
select '164 anon não executa publish_announcement',
       case when not has_function_privilege('anon',
              'public.publish_announcement(text, text, text, text, text, boolean, boolean, timestamptz, text, timestamptz)', 'execute')
            then 'ok' else 'ANON PODE' end
union all
select '164 clientes não chamam announcement_ring nem announcement_report_rows',
       case when not has_function_privilege('authenticated', 'public.announcement_ring(uuid)', 'execute')
             and not has_function_privilege('authenticated', 'public.announcement_report_rows(uuid)', 'execute')
            then 'ok' else 'ABERTO' end
union all
select '164 nenhuma função de comunicados executável por PUBLIC',
       case when not exists (
              select 1 from pg_proc p join pg_namespace n on n.oid = p.pronamespace,
                     aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
               where n.nspname = 'public' and p.proname like '%announcement%' and a.grantee = 0)
            then 'ok' else 'PUBLIC PODE' end
union all
select '164 tabelas só de leitura para authenticated',
       case when not has_table_privilege('authenticated', 'public.announcements', 'INSERT')
             and not has_table_privilege('authenticated', 'public.announcement_reads', 'INSERT')
             and has_table_privilege('authenticated', 'public.announcements', 'SELECT')
            then 'ok' else 'ERRADO' end
union all
select '164 job announcements-ring-due',
       case when exists (select 1 from cron.job where jobname = 'announcements-ring-due' and schedule = '*/5 * * * *')
            then 'ok' else 'FALTA' end;
