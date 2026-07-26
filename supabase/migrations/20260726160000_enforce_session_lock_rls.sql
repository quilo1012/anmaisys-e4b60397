-- Enforce the session lock server-side.
--
-- Until now `production_sessions.locked` was only honoured by the UI: an
-- operator hitting the API directly (or any non-UI path) could still write to
-- a locked session's items/blenders. This adds a real RLS gate.
--
-- Scope: the lock blocks OPERATOR writes (insert/update/delete) on a locked
-- session's production_items and production_blender_entries. admin / manager /
-- maintenance_manager are intentionally NOT gated — they own the lock (they're
-- the only roles that can set or clear it) and need to correct finalized data,
-- so gating them would only add friction with no security benefit.

-- Helper: is this session locked? SECURITY DEFINER so the check works
-- regardless of the caller's read scope on production_sessions.
CREATE OR REPLACE FUNCTION public.is_session_locked(_session_id uuid)
 RETURNS boolean
 LANGUAGE sql
 STABLE
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
  SELECT COALESCE((SELECT locked FROM public.production_sessions WHERE id = _session_id), false);
$function$;

-- ── production_items: operator write policies ──────────────────────────────
DROP POLICY IF EXISTS "production_items operator insert own line" ON public.production_items;
CREATE POLICY "production_items operator insert own line" ON public.production_items
  FOR INSERT TO authenticated
  WITH CHECK (
    has_role(auth.uid(), 'operator'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.production_sessions ps
      WHERE ps.id = production_items.session_id AND ps.line = ANY (current_user_line_names())
    )
    AND NOT public.is_session_locked(production_items.session_id)
  );

DROP POLICY IF EXISTS "production_items operator update own line" ON public.production_items;
CREATE POLICY "production_items operator update own line" ON public.production_items
  FOR UPDATE TO authenticated
  USING (
    has_role(auth.uid(), 'operator'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.production_sessions ps
      WHERE ps.id = production_items.session_id AND ps.line = ANY (current_user_line_names())
    )
    AND NOT public.is_session_locked(production_items.session_id)
  )
  WITH CHECK (
    has_role(auth.uid(), 'operator'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.production_sessions ps
      WHERE ps.id = production_items.session_id AND ps.line = ANY (current_user_line_names())
    )
    AND NOT public.is_session_locked(production_items.session_id)
  );

DROP POLICY IF EXISTS "production_items operator delete own line" ON public.production_items;
CREATE POLICY "production_items operator delete own line" ON public.production_items
  FOR DELETE TO authenticated
  USING (
    has_role(auth.uid(), 'operator'::app_role)
    AND EXISTS (
      SELECT 1 FROM public.production_sessions ps
      WHERE ps.id = production_items.session_id AND ps.line = ANY (current_user_line_names())
    )
    AND NOT public.is_session_locked(production_items.session_id)
  );

-- ── production_blender_entries: operator write policies ────────────────────
DROP POLICY IF EXISTS "blender_entries_operator_write" ON public.production_blender_entries;
CREATE POLICY "blender_entries_operator_write" ON public.production_blender_entries
  FOR INSERT TO authenticated
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.production_sessions ps
      JOIN public.lines l ON l.name = ps.line
      JOIN public.operator_line_accounts ola ON ola.user_id = auth.uid()
      WHERE ps.id = production_blender_entries.session_id AND l.id = ANY (ola.line_ids)
    )
    AND NOT public.is_session_locked(production_blender_entries.session_id)
  );

DROP POLICY IF EXISTS "blender_entries_operator_update" ON public.production_blender_entries;
CREATE POLICY "blender_entries_operator_update" ON public.production_blender_entries
  FOR UPDATE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.production_sessions ps
      JOIN public.lines l ON l.name = ps.line
      JOIN public.operator_line_accounts ola ON ola.user_id = auth.uid()
      WHERE ps.id = production_blender_entries.session_id AND l.id = ANY (ola.line_ids)
    )
    AND NOT public.is_session_locked(production_blender_entries.session_id)
  );

DROP POLICY IF EXISTS "blender_entries_operator_delete" ON public.production_blender_entries;
CREATE POLICY "blender_entries_operator_delete" ON public.production_blender_entries
  FOR DELETE TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.production_sessions ps
      JOIN public.lines l ON l.name = ps.line
      JOIN public.operator_line_accounts ola ON ola.user_id = auth.uid()
      WHERE ps.id = production_blender_entries.session_id AND l.id = ANY (ola.line_ids)
    )
    AND NOT public.is_session_locked(production_blender_entries.session_id)
  );

GRANT EXECUTE ON FUNCTION public.is_session_locked(uuid) TO authenticated;
