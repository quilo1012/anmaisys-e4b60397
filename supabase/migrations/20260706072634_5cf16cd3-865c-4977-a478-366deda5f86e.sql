-- #12 Reorder SKUs on Operator screen: add display_order to production_items
ALTER TABLE public.production_items
  ADD COLUMN IF NOT EXISTS display_order integer NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_production_items_session_display_order
  ON public.production_items (session_id, display_order, created_at);
