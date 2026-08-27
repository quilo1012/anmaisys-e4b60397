-- 227 employee records, readable by four people no screen ever showed them to.
--
-- `employees_read_roster` and `esh_read_roster` both grant SELECT to eight roles:
--
--   admin, manager, supervisor, planner, production_office_admin,
--   maintenance_manager, warehouse, quality_supervisor
--
-- Every screen that reads those tables — PeoplePage, LeavePage, AttendancePage,
-- FinanceClosePage, ProductionHeadcountPage, and the panels inside them — is gated by
-- `workforce.view` or `headcount.view`, and BOTH are admin-only in the matrix. So the
-- last three roles on that list hold no HR permission of any kind: not workforce.view,
-- not headcount.view, not attendance.manage. There is no reading of the matrix under
-- which they should have the roster.
--
-- They have it anyway, through the API, and it is not an empty table:
--
--   employees                     227 rows
--     with an email address         34
--     with free-text notes          14
--   employee_shift_history        who moved shift, and when
--
--   real accounts holding those three roles today:
--     quality_supervisor             2
--     maintenance_manager            1
--     warehouse                      1
--
-- Four people, and the columns are name, email, department, position, manager,
-- employment type, start and leave dates, and a notes field somebody has been writing
-- in. This is the one place in the audit where the gap leaks personal data rather than
-- production figures.
--
-- WHY ONLY THESE TWO TABLES. The rest of the HR family looks equally wide and is not:
-- attendance_days, daily_allocations, headcount_matrix and leave_requests grant
-- admin + manager + supervisor + planner + production_office_admin, which is exactly
-- `attendance.manage` in the matrix plus the office-admin role. Those policies agree
-- with a permission that exists; narrowing them would be a decision about whether
-- attendance management should exist at all, and that is not a bug to fix quietly.
--
-- (It is worth someone's attention separately: `attendance.manage` is granted to four
-- roles, and none of them can open the screen that uses it, because headcount.view is
-- admin-only. A permission nobody can exercise. Left alone here on purpose.)
--
-- WHAT THIS CHANGES FOR ADMINS: nothing. has_action returns true for admin
-- unconditionally, and no override grants workforce.view to anyone else, so the roster
-- keeps working exactly as it does today for the ten admin accounts.

-- =====================================================================
-- employees
-- =====================================================================

DROP POLICY IF EXISTS "employees_read_roster" ON public.employees;

CREATE POLICY "employees select by matrix" ON public.employees
  FOR SELECT TO authenticated
  USING (has_action(auth.uid(), 'workforce.view', ARRAY['admin'::app_role]));

-- =====================================================================
-- employee_shift_history
--
-- Same eight roles, same reasoning. Who changed shift and on what date is the same
-- personnel record, one column narrower.
-- =====================================================================

DROP POLICY IF EXISTS "esh_read_roster" ON public.employee_shift_history;

CREATE POLICY "employee_shift_history select by matrix" ON public.employee_shift_history
  FOR SELECT TO authenticated
  USING (has_action(auth.uid(), 'workforce.view', ARRAY['admin'::app_role]));

COMMENT ON TABLE public.employees IS
  'Registo de pessoal — 227 linhas, com email, departamento, chefia e notas em texto livre. '
  'Leitura por has_action(''workforce.view''), que hoje e so admin. Ate 27/08/2026 a politica '
  'nomeava oito papeis, incluindo warehouse, quality_supervisor e maintenance_manager, que nao '
  'tem permissao de RH nenhuma na matriz e nenhum ecra que leia esta tabela — quatro contas reais '
  'liam o roster inteiro pela API. Ver 20260911090000.';
