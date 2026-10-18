CREATE POLICY "employees read details" ON public.employees FOR SELECT TO authenticated USING (public.has_action((SELECT auth.uid()), 'employees.view', ARRAY['admin','manager']::public.app_role[]));
CREATE POLICY "employees update details" ON public.employees FOR UPDATE TO authenticated USING (public.has_action((SELECT auth.uid()), 'employees.manage', ARRAY['admin','manager']::public.app_role[])) WITH CHECK (public.has_action((SELECT auth.uid()), 'employees.manage', ARRAY['admin','manager']::public.app_role[]));
CREATE POLICY "employee_shift_history read details" ON public.employee_shift_history FOR SELECT TO authenticated USING (public.has_action((SELECT auth.uid()), 'employees.view', ARRAY['admin','manager']::public.app_role[]));
CREATE POLICY "employee_shift_history insert details" ON public.employee_shift_history FOR INSERT TO authenticated WITH CHECK (public.has_action((SELECT auth.uid()), 'employees.manage', ARRAY['admin','manager']::public.app_role[]));
CREATE POLICY "employee_shift_history update details" ON public.employee_shift_history FOR UPDATE TO authenticated USING (public.has_action((SELECT auth.uid()), 'employees.manage', ARRAY['admin','manager']::public.app_role[])) WITH CHECK (public.has_action((SELECT auth.uid()), 'employees.manage', ARRAY['admin','manager']::public.app_role[]));
CREATE TABLE public.employee_record_history (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), employee_id uuid NOT NULL REFERENCES public.employees(id) ON DELETE CASCADE,
 changed_at timestamptz NOT NULL DEFAULT now(), changed_by uuid, before_values jsonb NOT NULL, after_values jsonb NOT NULL
);
GRANT SELECT ON public.employee_record_history TO authenticated;
GRANT ALL ON public.employee_record_history TO service_role;
ALTER TABLE public.employee_record_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY "employee_record_history read details" ON public.employee_record_history FOR SELECT TO authenticated USING (public.has_action((SELECT auth.uid()), 'employees.view', ARRAY['admin','manager']::public.app_role[]) OR public.has_action((SELECT auth.uid()), 'workforce.view', ARRAY['admin']::public.app_role[]));
CREATE INDEX employee_record_history_employee_date ON public.employee_record_history(employee_id, changed_at DESC);
CREATE FUNCTION public.record_employee_detail_change() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
 IF (OLD.position, OLD.shift_group, OLD.shift_pattern_id) IS DISTINCT FROM (NEW.position, NEW.shift_group, NEW.shift_pattern_id) THEN
 INSERT INTO public.employee_record_history(employee_id, changed_by, before_values, after_values)
 VALUES (NEW.id, auth.uid(), jsonb_build_object('position', OLD.position, 'shift_group', OLD.shift_group, 'shift_pattern_id', OLD.shift_pattern_id), jsonb_build_object('position', NEW.position, 'shift_group', NEW.shift_group, 'shift_pattern_id', NEW.shift_pattern_id));
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION public.record_employee_detail_change() FROM PUBLIC, anon, authenticated;
CREATE TRIGGER employee_detail_change AFTER UPDATE OF position, shift_group, shift_pattern_id ON public.employees FOR EACH ROW EXECUTE FUNCTION public.record_employee_detail_change();