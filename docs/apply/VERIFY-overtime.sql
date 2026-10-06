-- Verify the overtime block landed. Every row should say `ok`.
select 'table ' || t as what,
       case when to_regclass('public.' || t) is not null then 'ok' else 'MISSING' end
  from unnest(array['overtime_requests','overtime_responses','overtime_outcomes']) t
union all
select 'function ' || f,
       case when exists (select 1 from pg_proc where proname = f) then 'ok' else 'MISSING' end
  from unnest(array['answer_overtime','link_me_to_employee','overtime_reliability',
                    'can_manage_overtime','my_employee_id','overtime_roster',
                    'my_overtime_identity','overtime_unlinked_names']) f
union all
select 'rls ' || c.relname,
       case when c.relrowsecurity then 'ok' else 'OFF' end
  from pg_class c join pg_namespace n on n.oid = c.relnamespace
 where n.nspname = 'public' and c.relkind = 'r'
   and c.relname in ('overtime_requests','overtime_responses','overtime_outcomes');
