-- Hardening (security audit M2): two policies were bound to the `public` role
-- (which includes anon) instead of `authenticated`. Their USING/CHECK already
-- call has_role(auth.uid(), ...) which is false for anon, so there was no live
-- leak — but binding them to `public` violates least-privilege and is one policy
-- edit away from exposure. Repoint both to `authenticated`.
ALTER POLICY "production_items quality_supervisor read" ON public.production_items TO authenticated;
ALTER POLICY "sku_backup admin manage" ON public.sku_products_backup TO authenticated;
