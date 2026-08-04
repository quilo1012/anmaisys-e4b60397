-- Supervisor, maintenance manager and planner can raise an order.
--
-- All three carry `wo.create` in the permission matrix and are shown the Create WO
-- button, and none of them had an INSERT policy: the click reached the database and
-- came back an RLS error. It failed closed, so nothing leaked — it simply did not
-- work, for three of the roles most likely to be standing next to a stopped line.
--
-- Found by auditing the matrix against `pg_policies` rather than against the UI,
-- which agreed with the matrix and was equally wrong.

CREATE POLICY "Planning and maintenance leads can create WOs"
  ON public.work_orders FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'supervisor'::app_role)
    OR has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR has_role(auth.uid(), 'planner'::app_role)
  );
