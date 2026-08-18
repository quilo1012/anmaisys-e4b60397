-- 1) Fix mutable search_path on scorecard helper functions
ALTER FUNCTION public.scorecard_doc_score(scorecard_check_status[]) SET search_path = public;
ALTER FUNCTION public.scorecard_hs_evaluate(integer,integer,integer,integer,integer,integer,numeric,numeric,integer,numeric,numeric,numeric,numeric,numeric,numeric) SET search_path = public;
ALTER FUNCTION public.scorecard_month_label(date) SET search_path = public;
ALTER FUNCTION public.scorecard_overall_rag(text,text,text) SET search_path = public;
ALTER FUNCTION public.scorecard_pct_label(numeric) SET search_path = public;
ALTER FUNCTION public.scorecard_prod_score(numeric,numeric,numeric,numeric,numeric,numeric,numeric) SET search_path = public;
ALTER FUNCTION public.scorecard_qual_score(scorecard_check_status[],numeric) SET search_path = public;
ALTER FUNCTION public.scorecard_quality_fail_type(scorecard_check_status[]) SET search_path = public;
ALTER FUNCTION public.scorecard_quality_rag(scorecard_check_status[]) SET search_path = public;
ALTER FUNCTION public.scorecard_quarter_label(date) SET search_path = public;
ALTER FUNCTION public.scorecard_score_evaluate(numeric,scorecard_check_status[],integer,integer,text,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric,numeric) SET search_path = public;
ALTER FUNCTION public.scorecard_score_label(numeric) SET search_path = public;
ALTER FUNCTION public.scorecard_volume_pct_adjusted(numeric,numeric,numeric,numeric) SET search_path = public;
ALTER FUNCTION public.scorecard_volume_rag(numeric,numeric,numeric,numeric) SET search_path = public;

-- 2) Security definer view -> security invoker, keeping the board readable for staff
CREATE POLICY "Signed in reads intouch machine map"
  ON public.intouch_machine_map FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE POLICY "Signed in reads stop code map"
  ON public.intouch_stop_code_map FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

ALTER VIEW public.v_line_live_status SET (security_invoker = on);

-- 3) Restrict overly broad reads
DROP POLICY IF EXISTS "Signed in reads leader line assignment" ON public.leader_line_assignment;
CREATE POLICY "Management reads leader line assignment"
  ON public.leader_line_assignment FOR SELECT TO authenticated
  USING (
    public.is_owner(auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'quality_supervisor'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
    OR public.has_role(auth.uid(), 'planner'::app_role)
  );

DROP POLICY IF EXISTS "Signed in reads weekly scorecard" ON public.leader_weekly_scorecard;
CREATE POLICY "Management reads weekly scorecard"
  ON public.leader_weekly_scorecard FOR SELECT TO authenticated
  USING (
    public.is_owner(auth.uid())
    OR public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'quality_supervisor'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  );