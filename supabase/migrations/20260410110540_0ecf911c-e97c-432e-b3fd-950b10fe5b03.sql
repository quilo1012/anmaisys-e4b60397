
-- machines: allow managers to manage
CREATE POLICY "Managers can manage machines" ON public.machines FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- problem_descriptions: allow managers to manage
CREATE POLICY "Managers can manage problem_descriptions" ON public.problem_descriptions FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- products: allow managers to view, insert, update (not delete - admin only)
CREATE POLICY "Managers can view products" ON public.products FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "Managers can insert products" ON public.products FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "Managers can update products" ON public.products FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- work_orders: allow managers
CREATE POLICY "Managers can create WOs" ON public.work_orders FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "Managers can delete WOs" ON public.work_orders FOR DELETE TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "Managers can view WOs" ON public.work_orders FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "Managers can update WOs" ON public.work_orders FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- profiles: allow managers to view all and update
CREATE POLICY "Managers can view all profiles" ON public.profiles FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "Managers can update profiles" ON public.profiles FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- user_roles: allow managers to view, insert, update (not delete - admin only)
CREATE POLICY "Managers can view all roles" ON public.user_roles FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "Managers can insert roles" ON public.user_roles FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "Managers can update roles" ON public.user_roles FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- audit_logs: allow managers to view
CREATE POLICY "Managers can view audit logs" ON public.audit_logs FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- engineer_scores: allow managers to view all and manage
CREATE POLICY "Managers can view all scores" ON public.engineer_scores FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "Managers can manage scores" ON public.engineer_scores FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- engineers: allow managers to manage
CREATE POLICY "Managers can manage engineers" ON public.engineers FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- checklists: allow managers to manage
CREATE POLICY "Managers can manage checklists" ON public.checklists FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- product_categories: allow managers to manage
CREATE POLICY "Managers can manage categories" ON public.product_categories FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- system_settings: allow managers
CREATE POLICY "Managers can manage system_settings" ON public.system_settings FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- machine_location_log: allow managers
CREATE POLICY "Managers can manage location logs" ON public.machine_location_log FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role))
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- parts_used: allow managers to view all
CREATE POLICY "Managers can view all parts used" ON public.parts_used FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- wo_photos: allow managers to view
CREATE POLICY "Managers can view wo_photos" ON public.wo_photos FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- work_order_logs: allow managers to insert and view
CREATE POLICY "Managers can insert work_order_logs" ON public.work_order_logs FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));

-- wo_messages: allow managers to view all
CREATE POLICY "Managers can view all wo_messages" ON public.wo_messages FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));

-- checklist_responses: allow managers
CREATE POLICY "Managers can insert checklist_responses" ON public.checklist_responses FOR INSERT TO authenticated
  WITH CHECK (has_role(auth.uid(), 'manager'::app_role));
CREATE POLICY "Managers can update checklist_responses" ON public.checklist_responses FOR UPDATE TO authenticated
  USING (has_role(auth.uid(), 'manager'::app_role));
