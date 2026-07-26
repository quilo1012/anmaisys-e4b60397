-- Audit follow-ups E and B (applied live; kept for the record).

-- E: co_engineer could open Quality (route maps co_engineer→engineer) but the
-- RLS SELECT policy ran under the real role and omitted co_engineer, so the list
-- rendered empty. Add co_engineer as a full reader (read-only; also retargets the
-- policy to `authenticated`).
DROP POLICY IF EXISTS "quality_actions scoped read" ON public.quality_actions;
CREATE POLICY "quality_actions scoped read" ON public.quality_actions
  FOR SELECT TO authenticated
  USING (
    has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role)
    OR has_role(auth.uid(), 'maintenance_manager'::app_role) OR has_role(auth.uid(), 'engineer'::app_role)
    OR has_role(auth.uid(), 'co_engineer'::app_role) OR has_role(auth.uid(), 'supervisor'::app_role)
    OR has_role(auth.uid(), 'quality_supervisor'::app_role)
    OR (line = ANY (current_user_line_names()))
  );

-- B: the operator line screen lets the tablet save per-shift observations, but
-- operators have no UPDATE policy on production_sessions, so the save 403'd. A
-- blanket operator UPDATE policy would also expose locked/leader/etc., so route
-- notes through a SECURITY DEFINER RPC that touches only `notes` and enforces
-- line scope + the session lock for operators.
CREATE OR REPLACE FUNCTION public.save_session_notes(_session_id uuid, _notes text)
 RETURNS void
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE _uid uuid := auth.uid(); _line text; _locked boolean;
BEGIN
  IF _uid IS NULL THEN RAISE EXCEPTION 'Not authenticated'; END IF;
  SELECT line, locked INTO _line, _locked FROM public.production_sessions WHERE id = _session_id;
  IF _line IS NULL THEN RAISE EXCEPTION 'Session not found'; END IF;

  IF has_role(_uid,'admin'::app_role) OR has_role(_uid,'manager'::app_role)
     OR has_role(_uid,'maintenance_manager'::app_role) OR has_role(_uid,'supervisor'::app_role) THEN
    UPDATE public.production_sessions SET notes = _notes, updated_at = now() WHERE id = _session_id;
    RETURN;
  END IF;

  IF has_role(_uid,'operator'::app_role) AND _line = ANY (current_user_line_names()) THEN
    IF _locked THEN RAISE EXCEPTION 'That shift is locked'; END IF;
    UPDATE public.production_sessions SET notes = _notes, updated_at = now() WHERE id = _session_id;
    RETURN;
  END IF;

  RAISE EXCEPTION 'not_authorized';
END; $function$;

REVOKE EXECUTE ON FUNCTION public.save_session_notes(uuid, text) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.save_session_notes(uuid, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.save_session_notes(uuid, text) TO authenticated;
