-- O engineer lia o plano de preventiva e nao o podia escrever.
--
-- `pm.view` incluia engineer e co_engineer desde que a matriz foi alargada. `pm.manage`
-- nao, e a RLS de pm_schedules e pm_tasks estava cravada em admin/manager/
-- maintenance_manager. O plano nascia longe da maquina: quem sabe o intervalo certo
-- pedia a alguem que nao a assiste que o gravasse por ele.
--
-- A matriz passa a dar-lhes `pm.manage`. Esta migracao poe a base a dizer o mesmo — sem
-- ela o botao "Create plan" aparece e o clique devolve um erro de RLS, que parece uma
-- avaria e nao uma permissao.
--
-- pm_executions ja nao precisava disto: a policy "PM executions insertable by
-- engineers/managers/admins" ja nomeia o engineer desde que registar uma execucao
-- passou a ser trabalho de quem a faz.
--
-- APLICAR ANTES DO MERGE. No Lovable o merge e o deploy, e codigo que chama uma
-- permissao que a base ainda nao da parte o ecra para toda a gente.

DROP POLICY IF EXISTS "PM schedules manageable by mgmt" ON public.pm_schedules;
CREATE POLICY "PM schedules manageable by mgmt" ON public.pm_schedules FOR ALL TO authenticated
  USING (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'maintenance_manager'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role)
    OR has_role(auth.uid(),'co_engineer'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'maintenance_manager'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role)
    OR has_role(auth.uid(),'co_engineer'::app_role)
  );

DROP POLICY IF EXISTS "PM tasks manageable by mgmt" ON public.pm_tasks;
CREATE POLICY "PM tasks manageable by mgmt" ON public.pm_tasks FOR ALL TO authenticated
  USING (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'maintenance_manager'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role)
    OR has_role(auth.uid(),'co_engineer'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'maintenance_manager'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role)
    OR has_role(auth.uid(),'co_engineer'::app_role)
  );
