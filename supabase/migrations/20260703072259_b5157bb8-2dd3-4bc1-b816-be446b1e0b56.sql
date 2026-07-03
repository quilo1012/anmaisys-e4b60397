-- Blender-level production entries + operator stamp on RAG actual

ALTER TABLE public.rag_weekly_entries
  ADD COLUMN IF NOT EXISTS actual_updated_by uuid REFERENCES auth.users(id);

CREATE TABLE IF NOT EXISTS public.production_blender_entries (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  session_id uuid NOT NULL REFERENCES public.production_sessions(id) ON DELETE CASCADE,
  production_item_id uuid NOT NULL REFERENCES public.production_items(id) ON DELETE CASCADE,
  blender_number smallint NOT NULL CHECK (blender_number BETWEEN 1 AND 4),
  quantity integer NOT NULL DEFAULT 0 CHECK (quantity >= 0),
  entered_by uuid REFERENCES auth.users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (production_item_id, blender_number)
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.production_blender_entries TO authenticated;
GRANT ALL ON public.production_blender_entries TO service_role;

ALTER TABLE public.production_blender_entries ENABLE ROW LEVEL SECURITY;

-- Admin/manager full access
CREATE POLICY "blender_entries_admin_all"
  ON public.production_blender_entries FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.has_role(auth.uid(),'manager'::app_role));

-- Engineers can read
CREATE POLICY "blender_entries_engineer_read"
  ON public.production_blender_entries FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(),'engineer'::app_role));

-- Operators: read+write for sessions on their bound lines
CREATE POLICY "blender_entries_operator_read"
  ON public.production_blender_entries FOR SELECT TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.production_sessions ps
      JOIN public.lines l ON l.name = ps.line
      JOIN public.operator_line_accounts ola ON ola.user_id = auth.uid()
      WHERE ps.id = production_blender_entries.session_id
        AND l.id = ANY(ola.line_ids)
    )
  );

CREATE POLICY "blender_entries_operator_write"
  ON public.production_blender_entries FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.production_sessions ps
      JOIN public.lines l ON l.name = ps.line
      JOIN public.operator_line_accounts ola ON ola.user_id = auth.uid()
      WHERE ps.id = production_blender_entries.session_id
        AND l.id = ANY(ola.line_ids)
    )
  );

CREATE POLICY "blender_entries_operator_update"
  ON public.production_blender_entries FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.production_sessions ps
      JOIN public.lines l ON l.name = ps.line
      JOIN public.operator_line_accounts ola ON ola.user_id = auth.uid()
      WHERE ps.id = production_blender_entries.session_id
        AND l.id = ANY(ola.line_ids)
    )
  );

CREATE POLICY "blender_entries_operator_delete"
  ON public.production_blender_entries FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1
      FROM public.production_sessions ps
      JOIN public.lines l ON l.name = ps.line
      JOIN public.operator_line_accounts ola ON ola.user_id = auth.uid()
      WHERE ps.id = production_blender_entries.session_id
        AND l.id = ANY(ola.line_ids)
    )
  );

CREATE TRIGGER trg_blender_entries_updated_at
  BEFORE UPDATE ON public.production_blender_entries
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- Sync production_items.actual_qty from blender sum
CREATE OR REPLACE FUNCTION public.sync_item_actual_from_blenders()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _item_id uuid;
  _sum integer;
BEGIN
  _item_id := COALESCE(NEW.production_item_id, OLD.production_item_id);
  SELECT COALESCE(SUM(quantity),0) INTO _sum
    FROM public.production_blender_entries
   WHERE production_item_id = _item_id;
  UPDATE public.production_items
     SET actual_qty = _sum,
         updated_at = now()
   WHERE id = _item_id;
  RETURN NULL;
END;
$$;

CREATE TRIGGER trg_sync_item_actual_from_blenders
  AFTER INSERT OR UPDATE OR DELETE ON public.production_blender_entries
  FOR EACH ROW EXECUTE FUNCTION public.sync_item_actual_from_blenders();

CREATE INDEX IF NOT EXISTS idx_blender_entries_session
  ON public.production_blender_entries(session_id);
CREATE INDEX IF NOT EXISTS idx_blender_entries_item
  ON public.production_blender_entries(production_item_id);