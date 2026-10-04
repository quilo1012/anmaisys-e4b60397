-- A RLS de `employees` passa a ler a matriz de permissões, como o ecrã já lê.
--
-- O painel do empregado abre o formulário a quem tem `workforce.manage`. O
-- `production_office_admin` TEM, por override gravado no ecrã de Permissões
-- (`role_permission_overrides`), e são cinco contas reais. A RLS, no entanto, só tinha
-- a policy `employees admin` (ALL, has_role('admin')): essas cinco pessoas abriam o
-- formulário, escreviam, e o PATCH do PostgREST devolvia 204 com zero linhas e sem
-- erro. O toast dizia "Saved" e o painel voltava ao valor antigo.
--
-- Isto só ACRESCENTA policies. A `employees admin` fica como está, e o DELETE continua
-- a ser só de admin de propósito: `employee_attendance` e `overtime_entries` fazem
-- cascade, portanto apagar alguém leva a assiduidade e as horas com ele. O caminho
-- para uma saída é o `active = false` com `left_on`, que é um UPDATE.
--
-- `has_action` é SECURITY DEFINER e lê `user_roles` + `role_permission_overrides`,
-- nunca `employees` — não há recursão. É a mesma função que a policy de SELECT já usa,
-- com o mesmo baseline, para que o ecrã e a base não possam voltar a discordar.

DROP POLICY IF EXISTS "employees update by matrix" ON public.employees;
CREATE POLICY "employees update by matrix"
  ON public.employees
  FOR UPDATE
  TO authenticated
  USING (public.has_action((SELECT auth.uid()), 'workforce.manage', ARRAY['admin']::app_role[]))
  WITH CHECK (public.has_action((SELECT auth.uid()), 'workforce.manage', ARRAY['admin']::app_role[]));

DROP POLICY IF EXISTS "employees insert by matrix" ON public.employees;
CREATE POLICY "employees insert by matrix"
  ON public.employees
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_action((SELECT auth.uid()), 'workforce.manage', ARRAY['admin']::app_role[]));
