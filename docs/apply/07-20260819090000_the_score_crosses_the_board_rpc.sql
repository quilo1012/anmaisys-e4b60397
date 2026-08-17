-- ================================================================
-- 20260819090000_the_score_crosses_the_board_rpc
-- ================================================================
-- The score crosses the board RPC.
--
-- scorecard_week_board already reads public.v_leader_weekly_scorecard through its
-- LEFT JOIN w, but stopped at the four RAG columns plus rag_driver/capa_required —
-- the 0-100 weighted score that migration 20260818090000 added to the view
-- (score_final, score_bruto, cap_reason, cap_applied) never left the view. The write
-- screen cannot show a number the board's own function does not hand it.
--
-- PostgreSQL will not let CREATE OR REPLACE change a function's RETURNS TABLE shape,
-- so the function must be dropped and recreated. Dropping takes the function's
-- privileges with it — a fresh function starts with none — so the REVOKE/GRANT pair
-- from migration 20260816090000 is repeated verbatim at the end of this file.
-- scorecard_derived_volume is untouched by this change; its own grants survive because
-- that function is never dropped here.
--
-- Everything else below is copied forward from 20260816090000, not retyped from memory:
-- same existing columns, same order, same LEFT JOIN, same WHERE, same
-- ORDER BY ll.name, ln.name. The four new columns are appended at the end and stay
-- nullable, because a week with no entry (w.id IS NULL) must keep reading as
-- "no data", not as a zero score.

DROP FUNCTION IF EXISTS public.scorecard_week_board(date);

CREATE FUNCTION public.scorecard_week_board(_week_ending date)
RETURNS TABLE (
  leader_id uuid, leader_name text, line_id uuid, line_name text,
  entry_id uuid, state text,
  volume_rag text, quality_rag text, hs_rag text, overall_rag text,
  rag_driver text, capa_required boolean,
  score_final numeric, score_bruto numeric, cap_reason text, cap_applied boolean
) LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT
    a.leader_id, ll.name, a.line_id, ln.name,
    w.id,
    CASE
      WHEN w.id IS NULL            THEN 'por preencher'
      WHEN w.approved_at IS NOT NULL THEN 'aprovada'
      WHEN w.submitted_at IS NOT NULL THEN 'submetida'
      ELSE 'rascunho'
    END,
    w.volume_rag, w.quality_rag, w.hs_rag, w.overall_rag,
    w.rag_driver, w.capa_required,
    w.score_final, w.score_bruto, w.cap_reason, w.cap_applied
  FROM public.leader_line_assignment a
  JOIN public.line_leaders ll ON ll.id = a.leader_id
  JOIN public.lines        ln ON ln.id = a.line_id
  LEFT JOIN public.v_leader_weekly_scorecard w
         ON w.leader_id = a.leader_id
        AND w.line_id   = a.line_id
        AND w.week_ending = _week_ending
  WHERE _week_ending >= a.valid_from
    AND (a.valid_to IS NULL OR _week_ending <= a.valid_to)
  ORDER BY ll.name, ln.name;
$$;

REVOKE ALL ON FUNCTION public.scorecard_week_board(date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scorecard_week_board(date) TO authenticated;


