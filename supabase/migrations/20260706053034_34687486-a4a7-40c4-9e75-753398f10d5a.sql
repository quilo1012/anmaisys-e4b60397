CREATE POLICY "Admins can update WOs" ON public.work_orders FOR UPDATE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role)) WITH CHECK (public.has_role(auth.uid(), 'admin'::app_role));

CREATE POLICY "Admins can delete downtime" ON public.downtime FOR DELETE TO authenticated USING (public.has_role(auth.uid(), 'admin'::app_role));