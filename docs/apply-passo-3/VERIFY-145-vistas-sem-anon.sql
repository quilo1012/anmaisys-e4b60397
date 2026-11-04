-- Verificação do BLOCO 145 — nenhuma vista responde sem sessão. Só lê o catálogo.
--
-- Esperado depois de colar: a primeira linha 'ok'. A segunda lista as vistas que correm
-- como o dono (passam por cima do RLS para quem tem sessão); a terceira as que o
-- authenticated deixou de ler, que deve ser 'nenhuma'.

select '145 vistas que o anon lê' as check,
       coalesce(string_agg(c.relname, ', ' order by c.relname), 'ok') as result
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
   and has_table_privilege('anon', c.oid, 'SELECT')
union all
select '145 vistas que correm como o dono (informação)',
       coalesce(string_agg(c.relname, ', ' order by c.relname), 'nenhuma')
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind = 'v'
   and coalesce((select lower(option_value) from pg_options_to_table(c.reloptions)
                  where option_name = 'security_invoker'), 'false') not in ('true', 'on', '1', 'yes')
union all
select '145 vistas que o authenticated não lê (informação)',
       coalesce(string_agg(c.relname, ', ' order by c.relname), 'nenhuma')
  from pg_class c
 where c.relnamespace = 'public'::regnamespace and c.relkind in ('v', 'm')
   and not has_table_privilege('authenticated', c.oid, 'SELECT');
