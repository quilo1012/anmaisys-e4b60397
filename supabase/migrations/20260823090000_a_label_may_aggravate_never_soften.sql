-- A label may aggravate an action. It may never soften one.
--
-- The rule was: the priced labels REPLACE the grade. An action graded Critical carrying
-- one label priced at 1 was worth 1, and the card went on showing Critical in red. The
-- only place the two numbers meet is inside one expression, so nobody could see it — a
-- silent downgrade, in the direction that hurts, on a scorecard people are appraised on.
--
-- It becomes MAX(labels, grade). A label answers the narrower question and may say the
-- deviation was worse than the grade suggested; it may not say it was milder. The old
-- fall-through is subsumed rather than removed: no priced label means a label charge of
-- 0, and MAX(0, grade) is the grade, so an unpriced action behaves exactly as it did.
--
-- This is the SQL half. src/lib/qualityConstants.ts is the other, and they have to land
-- together: the trigger from 20260822090000 freezes every new action through THIS
-- function, so shipping the TypeScript alone would freeze new rows under the old rule
-- while every screen displayed the new one. src/__tests__/scoringVersionParity.test.ts
-- is what stands between those two drifting.
--
-- ON THE CEILING, and a deliberate departure from the specification. It asked for
-- MAX_LABEL_POINTS to start equal to Critical's points. In THIS system that would not
-- have been a ceiling, it would have been a price cut: labels here are priced above the
-- top grade on purpose — severityForPoints() documents 5 as "reachable only by pricing
-- a label" — so a Foreign Body at 5 against a Critical of 4 would have been quietly
-- charged 4 from the day this shipped. Making a food safety label cheaper as a side
-- effect of adding a safety rail is the opposite of the point. It therefore ships
-- ABSENT, meaning uncapped, on the same reasoning that every label ships at 0: on the
-- day this lands, nobody's score moves.

-- =====================================================================
-- 0. Order, enforced rather than requested
--
-- This migration REPLACES public.action_points_at, which 20260822090000 creates. Applied
-- before it, this one lands first and 20260822090000's version then overwrites it — so
-- the MAX rule vanishes with no error, no warning, and every sign of having been applied.
-- A silent revert is the worst failure this pair has, so the order stops being a request
-- and becomes a precondition.
--
-- Checked on the TABLE rather than on the function: the function is what this file
-- rewrites, so its presence proves nothing about which version is there.
-- =====================================================================

DO $order$ BEGIN
  IF to_regclass('public.scoring_version') IS NULL THEN
    RAISE EXCEPTION
      '20260822090000 tem de ser aplicada primeiro. Esta migracao substitui '
      'action_points_at, que essa cria — aplicadas ao contrario, a versao dela aterra '
      'por ultimo e a regra do MAX desaparece sem erro nenhum. Aplicar '
      '20260822090000_a_score_is_frozen_at_the_scale_of_its_day.sql e depois esta.'
      USING ERRCODE = 'invalid_table_definition';
  END IF;
END $order$;

-- =====================================================================
-- 1. The ceiling, where the other scoring parameters already live
--
-- NOT in scoring_version's own snapshot tables, and not in the source. It is a scoring
-- parameter, and an unversioned scoring parameter re-scores history the moment it moves
-- — the door 20260822090000 exists to close. leader_scorecard_threshold is already
-- dated and already the home of CAP_Gate, CAP_NotDone and CAP_HSAmber, and its name
-- CHECK already admits CAP_[A-Za-z]+. An action resolves it through its own version's
-- valid_from, which is the arrangement 20260822090000 documents for weights and caps.
--
-- No row is seeded. An absent parameter is the uncapped reading, and that is the state
-- this is meant to ship in: setting a ceiling is a decision, taken once, in the open.
-- =====================================================================

COMMENT ON TABLE public.leader_scorecard_threshold IS
  'Parametros datados do scorecard. CAP_LabelPoints (opcional, ausente = sem tecto) limita o TOTAL que as etiquetas precificadas de uma accao podem cobrar entre elas. Nao limita o grau: um Critical vale sempre o que Critical vale.';

-- =====================================================================
-- 2. The rule
-- =====================================================================

CREATE OR REPLACE FUNCTION public.action_points_at(
  _domain text,
  _severity text,
  _labels text[],
  _validation_status text,
  _version_id bigint)
RETURNS integer
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  _norm     text[];
  _excluded text[];
  _charge   integer;
  _grade    integer;
  _cap      numeric;
  _from     date;
BEGIN
  -- Safety is counted, never charged. Reporting a near miss has to stay free, or the
  -- reporting stops and the number that looks best is the one that means least.
  IF _domain = 'safety' THEN RETURN 0; END IF;
  IF _validation_status = 'rejected' THEN RETURN 0; END IF;

  SELECT coalesce(array_agg(l), ARRAY[]::text[]) INTO _norm
    FROM (SELECT DISTINCT lower(trim(x)) AS l
            FROM unnest(coalesce(_labels, ARRAY[]::text[])) AS x
           WHERE trim(coalesce(x, '')) <> '') s;

  SELECT coalesce(array_agg(label), ARRAY[]::text[]) INTO _excluded
    FROM public.scoring_version_excluded_label WHERE version_id = _version_id;

  -- countsAgainstLeader: one attributable label is enough, and NO labels also counts.
  -- The second half is not an oversight — leaving the labels blank must not quietly
  -- remove a deviation from somebody's score.
  IF cardinality(_norm) > 0
     AND NOT EXISTS (SELECT 1 FROM unnest(_norm) AS l WHERE NOT (l = ANY(_excluded)))
  THEN
    RETURN 0;
  END IF;

  SELECT coalesce(sum(v.points), 0) INTO _charge
    FROM unnest(_norm) AS l
    JOIN public.scoring_version_label v
      ON v.version_id = _version_id AND v.label = l
   WHERE NOT (l = ANY(_excluded));

  -- The ceiling in force on the date this action's own version opened, not today's.
  -- Resolving it against current_date would let raising the cap in November change what
  -- a July action is worth — through the one number this whole module was rebuilt to
  -- stop moving.
  SELECT valid_from INTO _from FROM public.scoring_version WHERE id = _version_id;
  IF _from IS NOT NULL THEN
    SELECT max(value) INTO _cap
      FROM public.leader_scorecard_threshold
     WHERE name = 'CAP_LabelPoints'
       AND valid_from <= _from
       AND (valid_to IS NULL OR valid_to >= _from);
  END IF;
  -- NULL is uncapped, and LEAST would return the charge unchanged anyway — written out
  -- so the absent-parameter case is a stated reading rather than a lucky one.
  IF _cap IS NOT NULL THEN
    _charge := LEAST(_charge, _cap::integer);
  END IF;

  SELECT coalesce(points, 0) INTO _grade
    FROM public.scoring_version_severity
   WHERE version_id = _version_id AND severity = _severity;

  RETURN GREATEST(_charge, coalesce(_grade, 0));
END $$;

COMMENT ON FUNCTION public.action_points_at(text, text, text[], text, bigint) IS
  'O gemeo SQL de actionPoints() em src/lib/qualityConstants.ts, contra uma versao datada. MAX(etiquetas, grau): a etiqueta agrava, nunca atenua. Mudar um, mudar o outro.';

-- =====================================================================
-- 3. What this does NOT do, said out loud
--
-- It does not re-freeze anything. Every action already carrying points_at_creation
-- keeps it, including any that the replace rule under-charged. That is not an oversight
-- being deferred — it is the freeze working: those actions were scored under the rule in
-- force on their date, and a report already printed about them still reproduces.
--
-- Re-scoring the affected history with the new rule is a separate, explicit, auditable
-- act, which is what 20260822090000 made possible in the first place. It needs a
-- decision about which periods, and it will move published numbers.
-- =====================================================================
