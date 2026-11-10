-- Verificação do BLOCO 160. Só lê. Esperado: todas as linhas 'ok'.

select '160 política pergunta uma vez' as check,
       case when (select qual from pg_policies where schemaname = 'public' and tablename = 'intouch_status_log'
                   and policyname = 'staff read intouch status log') like '(( SELECT has_role(%'
            then 'ok' else 'FALTA' end as result
union all
select '160 só uma política de leitura',
       case when (select count(*) from pg_policies where schemaname = 'public' and tablename = 'intouch_status_log') = 1
            then 'ok' else 'VER POLÍTICAS' end
union all
select '160 RLS continua ligado',
       case when (select relrowsecurity from pg_class where oid = 'public.intouch_status_log'::regclass)
            then 'ok' else 'RLS DESLIGADO' end;
