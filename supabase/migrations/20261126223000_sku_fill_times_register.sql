-- Fill time per line: the same managers who approve may register a SKU the CSV did not carry.
GRANT INSERT (machine_name, sku_code, product_description, approved_seconds, time_basis, units_per_cycle) ON public.sku_fill_times TO authenticated;
CREATE POLICY "SKU managers register fill times" ON public.sku_fill_times FOR INSERT TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'manager') OR public.has_role(auth.uid(), 'production_office_admin'));
