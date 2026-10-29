-- Verificação do BLOCO 138 — voltar a marcar o que se cancelou a tempo. Só lê.
--
-- Pode correr-se na produção a qualquer hora. Lê o catálogo (md5 do corpo, o mesmo que
-- src/__tests__/thePaste138IsBlock138.test.ts calcula a partir da migração) e as permissões,
-- e conta quem poderia usar o botão hoje. Não escreve nada.
--
-- Esperado depois de colar: as três primeiras linhas 'ok'.

select '138 rebook_my_overtime existe e é a da migração' as check,
       coalesce((select case when md5(p.prosrc) = '4462e9362db5269e3c901d56ff08dfc0' then 'ok'
                             else 'diferente (md5 ' || md5(p.prosrc) || ')' end
                   from pg_proc p where p.proname = 'rebook_my_overtime' and p.pronamespace = 'public'::regnamespace),
                'em falta: colar APLICAR-138') as result
union all
select '138 quem tem sessão pode chamá-la',
       case when to_regprocedure('public.rebook_my_overtime(uuid)') is null then 'em falta'
            when has_function_privilege('authenticated', 'public.rebook_my_overtime(uuid)', 'EXECUTE') then 'ok'
            else 'sem permissão para authenticated' end
union all
select '138 o anónimo não pode',
       case when to_regprocedure('public.rebook_my_overtime(uuid)') is null then 'em falta'
            when has_function_privilege('anon', 'public.rebook_my_overtime(uuid)', 'EXECUTE') then 'MAU: anon pode chamar'
            else 'ok' end
union all
select '138 marcações canceladas a tempo pela própria pessoa, em pedidos abertos por começar (informação)',
       count(*)::text || coalesce(' (' || string_agg(coalesce(e.employee_ref, e.full_name) || ' ' || to_char(q.on_date, 'DD/MM'), ', ' order by q.on_date) || ')', '')
  from public.overtime_responses r
  join public.overtime_outcomes o on o.response_id = r.id and o.outcome = 'cancelled_in_time'
  join public.employees e on e.id = r.employee_id
  join public.overtime_requests q on q.id = r.request_id
 where r.decision = 'accepted' and o.recorded_by = e.user_id
   and q.status = 'open' and (q.on_date + q.starts_at) > (now() at time zone 'Europe/London');
