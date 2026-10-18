-- Depois de colar o BLOCO 95 (e o 96). Só leitura. Cada linha deve dizer true.
select 'employees_user_id_key'            as what, to_regclass('public.employees_user_id_key') is not null as ok
union all
select 'employees_employee_ref_norm_key',  to_regclass('public.employees_employee_ref_norm_key') is not null
union all
select 'employees_user_id_fkey',           exists (select 1 from pg_constraint where conname = 'employees_user_id_fkey')
union all
select 'esh insert by matrix',             exists (select 1 from pg_policies where tablename = 'employee_shift_history' and policyname = 'employee_shift_history insert by matrix')
union all
select 'no login on two people',           not exists (select 1 from public.employees where user_id is not null group by user_id having count(*) > 1)
union all
-- BLOCO 93, que o 96 precisa e que de fora não se consegue ver:
select 'bridge trigger (93)',              exists (select 1 from pg_trigger where tgname = 'overtime_response_to_board_t')
union all
select 'edited ask trigger (96)',          exists (select 1 from pg_trigger where tgname = 'overtime_request_moved_to_board_t');
