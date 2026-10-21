-- ================================================================
-- BLOCO 113
-- 20261021160000_operators_have_no_overtime_or_attendance.sql
-- ================================================================
--
-- O operador continua a poder entrar, mas Overtime e Attendance deixam de existir para ele.
-- No ecra isso ja era assim (a matriz de permissoes nao da `overtime.respond` nem
-- `attendance.view_own` ao `operator`); aqui fecha-se no backend, que e o que conta: quem
-- chamar as funcoes directamente, sem passar pelo menu, tambem nao recebe nada.
--
-- Todas as funcoes "do proprio" (my_attendance, answer_overtime, my_overtime_clashes, o
-- sino do overtime, as respostas do proprio) perguntam quem e a pessoa a `my_employee_id()`.
-- Passa a responder NULL a um login de operador que nao tenha nenhuma das duas permissoes — com a mesma regra da
-- matriz (`has_action`, que respeita as excepcoes guardadas no ecra de Permissoes). Um
-- operador a quem o admin der a permissao la volta a ter acesso; sem ela, nao.
--
-- NAO apaga nem muda dados: registos de attendance e de overtime ficam como estao, e
-- admin / manager mantem tudo. `my_employee_id()` so e usada por overtime e attendance.
--
-- An operator can still sign in, but Overtime and Attendance do not exist for them. The
-- screen already hid both; this closes it in the database too. `my_employee_id()` — the one
-- function every "my own" overtime/attendance function asks — now answers NULL for an operator login unless it holds `overtime.respond` or `attendance.view_own` (same rule as the matrix, so a
-- grant on the Permissions screen still counts). No data is touched.

create or replace function public.my_employee_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select e.id
    from public.employees e
   where e.user_id = auth.uid()
     and e.active
     and (
       -- Only a login that is an operator is held back; everybody else is exactly as before.
       not exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'operator'::app_role)
       or public.has_action(auth.uid(), 'overtime.respond',
         array['admin','manager','production_office_admin','maintenance_manager',
               'warehouse','quality_supervisor','employee']::app_role[])
       or public.has_action(auth.uid(), 'attendance.view_own',
         array['admin','manager','production_office_admin','maintenance_manager',
               'warehouse','quality_supervisor','employee']::app_role[])
     )
   limit 1;
$$;

revoke all on function public.my_employee_id() from public, anon;
grant execute on function public.my_employee_id() to authenticated;

-- As ofertas de overtime eram legiveis por qualquer sessao (`using (true)`). Passam a nao ser
-- por um login que so seja operador: quem tem outro papel, ou a permissao de overtime/
-- attendance (por papel ou por excepcao), le como antes.
-- The asks themselves were readable by any signed-in session. A login that is only an
-- operator no longer reads them; anybody with another role, or the permission, reads as before.
drop policy if exists "overtime_requests_read" on public.overtime_requests;
create policy "overtime_requests_read" on public.overtime_requests
  for select to authenticated
  using (
    not exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'operator'::app_role)
    or public.my_employee_id() is not null
    or public.can_manage_overtime(auth.uid())
    or public.has_action(auth.uid(), 'overtime.respond',
         array['admin','manager','production_office_admin','maintenance_manager',
               'warehouse','quality_supervisor','employee']::app_role[])
  );

notify pgrst, 'reload schema';
