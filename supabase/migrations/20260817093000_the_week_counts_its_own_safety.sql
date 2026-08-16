-- The week counts its own safety.
--
-- Seven of the scorecard's nine H&S fields stop being typed and start being counted from
-- the log. The two left out are percentages — PPE and training compliance — and a
-- percentage needs a denominator the log does not have: counting breaches is not the
-- same as knowing how many checks were made. That is also why the `ppe_breach` value of
-- public.safety_kind is not counted here: it is a numerator without a denominator.
--
-- DESVIO à spec (docs/superpowers/plans/2026-08-16-safety-actions-in-the-quality-log.md,
-- Task 7). A spec conta `overdue_hs_actions` como as acções por fechar cujo `due_date` já
-- passou, e manda confirmar que essa coluna existe. Confirmado contra a base: NÃO existe.
-- public.quality_actions tem closed_at, validated_at, recorded_at, updated_at — e nenhuma
-- coluna de prazo, com este ou qualquer outro nome. O formulário da qualidade também não
-- pede um. Sem prazo gravado não há atraso que se possa medir, e a spec é explícita sobre
-- o que fazer nesse caso: devolver NULL, não um número inventado. Um zero aqui leria-se
-- como "nada em atraso", que é a afirmação mais perigosa que esta função podia fazer.
--
-- Para fechar isto é preciso uma decisão de produto — que prazo tem uma acção de
-- segurança, e quem o define — seguida de uma coluna e de um campo no formulário. Até lá
-- a coluna do scorecard fica vazia, e vazia lê-se como "não registado".
CREATE OR REPLACE FUNCTION public.scorecard_safety_counts(
  _leader_id uuid, _line text, _week_ending date)
RETURNS TABLE (
  lost_time_injuries integer, reportable_accidents integer, first_aid_cases integer,
  near_misses_reported integer, safety_observations_done integer,
  toolbox_talks_done integer, overdue_hs_actions integer,
  rows_missing_attribution integer
) LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  WITH week AS (
    SELECT a.*
    FROM public.quality_actions a
    WHERE a.domain = 'safety'
      -- Rejected at validation means Quality looked and said it did not happen. The
      -- same rule the quality side already applies.
      AND a.validation_status IS DISTINCT FROM 'rejected'
      AND a.recorded_at::date BETWEEN _week_ending - 6 AND _week_ending
  ),
  mine AS (
    SELECT * FROM week WHERE leader_id = _leader_id AND line = _line
  )
  SELECT
    count(*) FILTER (WHERE safety_kind = 'lost_time_injury')::integer,
    count(*) FILTER (WHERE safety_kind = 'reportable_accident')::integer,
    count(*) FILTER (WHERE safety_kind = 'first_aid')::integer,
    -- Reported near misses. NEVER added to first_aid_cases: one is a consequence, the
    -- other is the leading signal, and zero here means under-reporting rather than a
    -- safe week — a reading that lives in the scorecard's H&S rule, not here.
    count(*) FILTER (WHERE safety_kind = 'near_miss')::integer,
    count(*) FILTER (WHERE safety_kind = 'safety_observation')::integer,
    count(*) FILTER (WHERE safety_kind = 'toolbox_talk')::integer,
    -- Sem coluna de prazo em quality_actions. Ver o desvio no cabeçalho.
    NULL::integer,
    -- Occurrences in this week that name no leader or no line. They cannot be counted
    -- above, and a count that drops rows silently is the failure this module exists to
    -- prevent — so they are reported rather than lost.
    (SELECT count(*) FROM week w WHERE w.leader_id IS NULL OR w.line IS NULL)::integer
  FROM mine;
$$;

COMMENT ON FUNCTION public.scorecard_safety_counts(uuid, text, date) IS
  'Contagens semanais de H&S para o scorecard do líder. overdue_hs_actions devolve NULL: '
  'quality_actions não tem coluna de prazo. Ver o cabeçalho da migração '
  '20260817093000_the_week_counts_its_own_safety.sql.';

REVOKE ALL ON FUNCTION public.scorecard_safety_counts(uuid, text, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scorecard_safety_counts(uuid, text, date) TO authenticated;
