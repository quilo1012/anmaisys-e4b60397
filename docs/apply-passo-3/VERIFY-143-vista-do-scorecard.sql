-- Verificação do BLOCO 143 — a vista do scorecard semanal lê como quem pergunta. Só lê.
--
-- Pode correr-se na produção a qualquer hora. Lê o catálogo, não lê nenhuma linha da vista.
-- Esperado depois de colar: as duas linhas 'ok'.

select '143 v_leader_weekly_scorecard tem security_invoker' as check,
       case when coalesce((select option_value from pg_options_to_table(c.reloptions)
                            where option_name = 'security_invoker'), 'false') in ('true', 'on')
            then 'ok' else 'desligado' end as result
  from pg_class c where c.oid = 'public.v_leader_weekly_scorecard'::regclass
union all
select '143 anon não lê v_leader_weekly_scorecard',
       case when has_table_privilege('anon', 'public.v_leader_weekly_scorecard'::regclass, 'SELECT')
            then 'anon ainda tem SELECT' else 'ok' end;
