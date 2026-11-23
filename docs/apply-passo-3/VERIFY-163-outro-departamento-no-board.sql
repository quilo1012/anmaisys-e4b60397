-- Verificação do BLOCO 163. Só lê. Esperado: todas as linhas 'ok'.

select '163 daily_allocations aceita other_department' as check,
       case when pg_get_constraintdef(c.oid) like '%other_department%' then 'ok' else 'FALTA' end as result
  from pg_constraint c
 where c.conrelid = 'public.daily_allocations'::regclass
   and c.conname = 'daily_allocations_status_check'
union all
select '163 continua a aceitar training',
       case when pg_get_constraintdef(c.oid) like '%training%' then 'ok' else 'FALTA' end
  from pg_constraint c
 where c.conrelid = 'public.daily_allocations'::regclass
   and c.conname = 'daily_allocations_status_check';
