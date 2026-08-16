-- A gate is a ceiling, not a weight.
--
-- The scorecard gains a 0-100 score beside the RAG it already has. The two are
-- computed independently and shown together, because they answer different questions:
-- the score ranks and trends, the RAG decides and the rag_driver says what to fix. A
-- score of 82 does not tell a leader which check they missed, so the RAG is NOT
-- derived from the score and the score is not derived from the RAG.
--
-- The whole design is in one sentence: Production, Quality and Documentation are
-- WEIGHTS; food safety and Health & Safety are CEILINGS. If H&S were a fourth weight,
-- a lost-time injury would cost some number of points and a good volume week could buy
-- them back. It cannot. A ceiling is applied after the weighted sum and can only ever
-- lower it, so no arithmetic anywhere in this module can turn a failed CCP or an
-- injury into a good week. Nothing below may convert a gate into a weight, however
-- convenient the sum of the weights makes it look.
--
-- The three check sheets feed TWO pillars, and this is the part that is easy to get
-- wrong: a check that says 'Fail' is a product deviation and lands on QUALITY, while a
-- check that was never filled in is a discipline failure and lands on DOCUMENTATION.
-- That split is the entire reason the two pillars have separate weights. Do not
-- collapse them.
--
-- ON THE WEIGHTS THEMSELVES. This system already had three configurable weights, in
-- public.leader_score_weights, feeding the Leader Performance score computed in
-- src/lib/leaderScore.ts from production sessions and quality actions. That is a
-- different score over a different grain, but it is the same management judgement
-- about what this factory values, exposed on the same screen. Two tables of weights
-- with the same three names would drift, and the day they disagreed nobody would be
-- able to say which was the real one. So there is ONE source: the versioned rows
-- below. leader_score_weights stays as the editing surface the screen already writes
-- to, and a trigger turns each save into a new dated version here. Editing the weights
-- in November therefore cannot re-score July.

-- =====================================================================
-- 1. The parameter table has to admit parameters that are not thresholds
--
-- The name CHECK was '^THR_[A-Za-z]+$'. A weight is not a threshold and a ceiling is
-- not a threshold; naming them THR_ to satisfy a regex would have been the tail
-- wagging the dog. The pattern widens to the three prefixes this module now uses, and
-- stays closed: an arbitrary name is still rejected, because a typo'd parameter that
-- inserts happily is a parameter that silently reads NULL forever.
-- =====================================================================

ALTER TABLE public.leader_scorecard_threshold
  DROP CONSTRAINT IF EXISTS leader_scorecard_threshold_name_check;
ALTER TABLE public.leader_scorecard_threshold
  ADD CONSTRAINT leader_scorecard_threshold_name_check
  CHECK (name ~ '^(THR|W|CAP|USE)_[A-Za-z]+$');

ALTER TABLE public.leader_scorecard_threshold
  DROP CONSTRAINT IF EXISTS leader_scorecard_threshold_pillar_check;
ALTER TABLE public.leader_scorecard_threshold
  ADD CONSTRAINT leader_scorecard_threshold_pillar_check
  CHECK (pillar IN ('Volume', 'Health & Safety', 'Monitorado', 'Geral', 'Peso', 'Score'));

-- =====================================================================
-- 2. The new parameters
--
-- valid_from is the same early date as the rest of the seed: the weeks already typed
-- in have to resolve to a weight, or their score would read NULL and the module would
-- appear to have arrived empty.
-- =====================================================================

INSERT INTO public.leader_scorecard_threshold (name, value, pillar, valid_from, note)
SELECT v.name, v.value, v.pillar, DATE '2000-01-01', v.note
FROM (VALUES
  ('W_Production',       40.00, 'Peso',  'Peso do pilar Production. Os tres pesos TEM de somar 100.'),
  ('W_Quality',          35.00, 'Peso',  'Peso do pilar Quality: alimentado por checks "Fail".'),
  ('W_Documentation',    25.00, 'Peso',  'Peso do pilar Documentation: alimentado por checks "Not Done".'),
  ('CAP_Gate',           49.00, 'Score', 'Teto quando um gate dispara: check "Fail", LTI ou acidente reportavel.'),
  ('CAP_NotDone',        69.00, 'Score', 'Teto quando ha check nao realizado.'),
  ('CAP_HSAmber',        79.00, 'Score', 'Teto quando H&S esta Amber.'),
  ('THR_OverProdBand',    0.05, 'Score', 'Banda de penalidade de superproducao: acima do teto verde, perde 50 pontos por banda.'),
  ('THR_VolZero',         0.80, 'Score', 'Volume abaixo do qual ProdScore chega a 0.'),
  ('THR_QualFailPenalty',50.00, 'Score', 'Pontos perdidos por cada check "Fail".'),
  -- The pending decision of item M, made explicit instead of buried. 0 = the score
  -- reads the RAW volume, like the RAG does. Set it to 1 only with a decision from the
  -- business behind it, and understand what it buys: scoring the adjusted figure means
  -- a line that broke down more is scored on a smaller denominator, which rewards
  -- breakdown.
  ('USE_AdjustedForScore', 0.00, 'Score', '0 = ProdScore usa volume_pct BRUTO (como o RAG). 1 = usa o ajustado por downtime. DECISAO DE NEGOCIO.')
) AS v(name, value, pillar, note)
WHERE NOT EXISTS (
  SELECT 1 FROM public.leader_scorecard_threshold t WHERE t.name = v.name);

-- The live weights win over the seed if management has already moved them, the same
-- rule the v1 thresholds were carried over under — except that the business decision
-- recorded with this migration is to adopt 40/35/25, so the editing surface is moved
-- to match rather than the other way round. This is the one place the two scores are
-- knowingly re-based: the Leader Performance figure moves from 40/30/30 to 40/35/25.
UPDATE public.leader_score_weights
   SET production_pct = 40, quality_pct = 35, documentation_pct = 25, updated_at = now()
 WHERE id = true
   AND (production_pct, quality_pct, documentation_pct) IS DISTINCT FROM (40, 35, 25);

-- =====================================================================
-- 3. The weights must total 100 — in the database, not in the form
--
-- A CHECK cannot see three rows, so this is a constraint trigger. DEFERRABLE INITIALLY
-- DEFERRED matters: re-weighting means closing three rows and opening three more, and
-- every intermediate state of that transaction has a sum that is not 100. Checking per
-- statement would make a legal edit impossible; checking at COMMIT asks the only
-- question worth asking, which is whether what was left behind adds up.
--
-- It is checked at every date where the weights change, not just today, so a
-- backdated correction cannot leave a period in the past scored on 95 points of
-- weight while every other period is scored on 100.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.scorecard_weights_total_100()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE _bad record;
BEGIN
  SELECT d.on_date, w.total INTO _bad
  FROM (
    SELECT DISTINCT valid_from AS on_date
      FROM public.leader_scorecard_threshold
     WHERE name IN ('W_Production', 'W_Quality', 'W_Documentation')
  ) d
  CROSS JOIN LATERAL (
    SELECT sum(t.value) AS total, count(*) AS n
      FROM public.leader_scorecard_threshold t
     WHERE t.name IN ('W_Production', 'W_Quality', 'W_Documentation')
       AND d.on_date >= t.valid_from
       AND (t.valid_to IS NULL OR d.on_date <= t.valid_to)
  ) w
  WHERE w.n <> 3 OR w.total <> 100
  LIMIT 1;

  IF FOUND THEN
    RAISE EXCEPTION
      'Os pesos Production + Quality + Documentation tem de somar 100 em toda a vigencia. Em % somam %.',
      _bad.on_date, coalesce(_bad.total::text, 'nada')
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_scorecard_weights_total_100 ON public.leader_scorecard_threshold;
CREATE CONSTRAINT TRIGGER trg_scorecard_weights_total_100
  AFTER INSERT OR UPDATE OR DELETE ON public.leader_scorecard_threshold
  DEFERRABLE INITIALLY DEFERRED
  FOR EACH ROW EXECUTE FUNCTION public.scorecard_weights_total_100();

-- =====================================================================
-- 4. One editing surface, versioned storage
--
-- The screen keeps writing to leader_score_weights, which still carries its own
-- sum-100 CHECK and so rejects 40/35/30 before this trigger is even reached. What the
-- trigger adds is history: today's rows are closed yesterday and the new values open
-- today, so every week already recorded keeps resolving the weights it was actually
-- scored under.
--
-- A second save on the same day corrects that day's version in place rather than
-- opening a second one, because a day cannot have two sets of weights and the
-- exclusion constraint would refuse it anyway.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.scorecard_version_weights()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE
  _today date := current_date;
  _w     record;
BEGIN
  FOR _w IN
    SELECT * FROM (VALUES
      ('W_Production',    NEW.production_pct),
      ('W_Quality',       NEW.quality_pct),
      ('W_Documentation', NEW.documentation_pct)
    ) AS v(name, value)
  LOOP
    -- A version that has not started being used yet is an edit of today's decision,
    -- not a new one.
    IF EXISTS (SELECT 1 FROM public.leader_scorecard_threshold
                WHERE name = _w.name AND valid_to IS NULL AND valid_from >= _today) THEN
      UPDATE public.leader_scorecard_threshold
         SET value = _w.value
       WHERE name = _w.name AND valid_to IS NULL AND valid_from >= _today;
    ELSE
      UPDATE public.leader_scorecard_threshold
         SET valid_to = _today - 1
       WHERE name = _w.name AND valid_to IS NULL AND valid_from < _today;

      INSERT INTO public.leader_scorecard_threshold (name, value, pillar, valid_from, note)
      VALUES (_w.name, _w.value, 'Peso', _today,
              'Versao aberta pela edicao dos pesos no ecra.');
    END IF;
  END LOOP;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_scorecard_version_weights ON public.leader_score_weights;
CREATE TRIGGER trg_scorecard_version_weights
  AFTER UPDATE ON public.leader_score_weights
  FOR EACH ROW
  WHEN (OLD.production_pct    IS DISTINCT FROM NEW.production_pct
     OR OLD.quality_pct       IS DISTINCT FROM NEW.quality_pct
     OR OLD.documentation_pct IS DISTINCT FROM NEW.documentation_pct)
  EXECUTE FUNCTION public.scorecard_version_weights();

COMMENT ON TABLE public.leader_score_weights IS
  'Os pesos correntes, e o ecra onde se editam. NAO e a fonte da verdade historica: cada gravacao aqui abre uma versao datada em leader_scorecard_threshold (W_Production, W_Quality, W_Documentation), e e essa que o scorecard le a data da semana. Alterar os pesos hoje nao re-pontua o passado.';

-- =====================================================================
-- 5. Layer 1 — the numeric score, one function per pillar
--
-- IMMUTABLE and taking their parameters as arguments, exactly like the RAG rules in
-- the previous migration, so a week and the average of a quarter are scored by the
-- same code under whichever weights that period ran with.
-- =====================================================================

DO $$ BEGIN
  CREATE TYPE public.scorecard_score_eval AS (
    prod_score  numeric,
    qual_score  numeric,
    doc_score   numeric,
    score_bruto numeric,
    score_final numeric,
    cap_reason  text);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Production. The bands are the volume RAG's bands, turned into a ramp so that two
-- Green weeks at 100% and 104% do not score identically when one of them is closer to
-- the ceiling. Above the green ceiling the score falls away: over-production can never
-- reach 100, because making more than the plan is inventory nobody ordered.
CREATE OR REPLACE FUNCTION public.scorecard_prod_score(
  _pct numeric, _amber_min numeric, _green_min numeric, _green_max numeric,
  _over_band numeric, _vol_zero numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _pct IS NULL THEN NULL                        -- no data is not a zero
    WHEN _pct > _green_max THEN
      GREATEST(0, 100 - ((_pct - _green_max) / NULLIF(_over_band, 0)) * 50)
    WHEN _pct >= _green_min THEN 100
    WHEN _pct >= _amber_min THEN
      50 + 50 * (_pct - _amber_min) / NULLIF(_green_min - _amber_min, 0)
    ELSE
      GREATEST(0, 50 * (_pct - _vol_zero) / NULLIF(_amber_min - _vol_zero, 0))
  END;
$$;

-- Quality. Only 'Fail' is priced here: a check that was not done did not fail a test,
-- it was not done, and it is charged to Documentation instead.
CREATE OR REPLACE FUNCTION public.scorecard_qual_score(
  _checks public.scorecard_check_status[], _penalty numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN cardinality(array_remove(_checks, NULL::public.scorecard_check_status)) = 0 THEN NULL
    ELSE GREATEST(0, 100 - (
      SELECT count(*) FROM unnest(_checks) c WHERE c = 'Fail') * _penalty)
  END;
$$;

-- Documentation. Out of three, always three: a week with one check recorded and two
-- blank has not done two thirds of its paperwork, and dividing by the number filled in
-- would score it as if the blanks had never been asked for.
--
-- A blank counts exactly as 'Not Done', because that is already what the rest of the
-- module decided a blank means: scorecard_quality_rag makes a partly filled row Red
-- and scorecard_quality_fail_type calls it 'Not Done'. Counting only the explicit
-- 'Not Done' here would let a row with one Pass and two blanks score 100 on paperwork
-- while the RAG beside it says the checks were not done — the same number disagreeing
-- with itself on one screen.
--
-- A 'Fail' is NOT missing paperwork: that check was done, it was written down, and it
-- failed. It is charged in full to Quality and costs nothing here. That is the split
-- the two weights exist for.
CREATE OR REPLACE FUNCTION public.scorecard_doc_score(
  _checks public.scorecard_check_status[])
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN cardinality(array_remove(_checks, NULL::public.scorecard_check_status)) = 0 THEN NULL
    ELSE (3 - (SELECT count(*) FROM unnest(_checks) c
                WHERE c IS NULL OR c = 'Not Done'))::numeric / 3 * 100
  END;
$$;

-- =====================================================================
-- 6. Layer 2 — the ceilings, and the two layers in one function
--
-- The order of the ceilings is a precedence, not a preference: the hardest ceiling
-- wins, and each one names itself in cap_reason so the number on the screen can always
-- say why it is not the weighted sum.
--
-- score_bruto is NULL if any component is NULL, and a NULL score is NOT capped and
-- NOT zero. This is the same distinction the rollups already make between "no data"
-- and "zero", and it hides more easily inside a weighted average than anywhere else:
-- a pillar with nothing in it, scored as zero, is indistinguishable from a pillar that
-- genuinely earned nothing.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.scorecard_score_evaluate(
  _volume_pct numeric,
  _checks public.scorecard_check_status[],
  _lti integer, _reportable integer, _hs_rag text,
  _w_prod numeric, _w_qual numeric, _w_doc numeric,
  _amber_min numeric, _green_min numeric, _green_max numeric,
  _over_band numeric, _vol_zero numeric, _fail_penalty numeric,
  _cap_gate numeric, _cap_not_done numeric, _cap_hs_amber numeric)
RETURNS public.scorecard_score_eval LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  _prod  numeric := public.scorecard_prod_score(_volume_pct, _amber_min, _green_min, _green_max, _over_band, _vol_zero);
  _qual  numeric := public.scorecard_qual_score(_checks, _fail_penalty);
  _doc   numeric := public.scorecard_doc_score(_checks);
  _fail_type text := public.scorecard_quality_fail_type(_checks);
  _bruto numeric;
  _final numeric;
  _why   text;
BEGIN
  IF _prod IS NULL OR _qual IS NULL OR _doc IS NULL THEN
    -- Not zero, and not capped either: there is nothing here to put a ceiling on.
    RETURN ROW(_prod, _qual, _doc, NULL, NULL, NULL)::public.scorecard_score_eval;
  END IF;

  _bruto := (_prod * _w_prod + _qual * _w_qual + _doc * _w_doc) / 100;

  IF _fail_type = 'Fail' OR coalesce(_lti, 0) > 0 OR coalesce(_reportable, 0) > 0 THEN
    _final := LEAST(_bruto, _cap_gate);
    _why := 'Teto ' || to_char(_cap_gate, 'FM999D99') || ': ' || concat_ws('; ',
      CASE WHEN _fail_type = 'Fail'            THEN 'check reprovado (Fail)' END,
      CASE WHEN coalesce(_lti, 0) > 0          THEN 'acidente com afastamento' END,
      CASE WHEN coalesce(_reportable, 0) > 0   THEN 'acidente reportavel' END) || '.';
  ELSIF _fail_type = 'Not Done' THEN
    _final := LEAST(_bruto, _cap_not_done);
    _why := 'Teto ' || to_char(_cap_not_done, 'FM999D99') || ': check nao realizado.';
  ELSIF _hs_rag = 'Amber' THEN
    _final := LEAST(_bruto, _cap_hs_amber);
    _why := 'Teto ' || to_char(_cap_hs_amber, 'FM999D99') || ': Health & Safety em Amber.';
  ELSE
    _final := _bruto;
    _why := NULL;
  END IF;

  RETURN ROW(_prod, _qual, _doc, _bruto, _final, _why)::public.scorecard_score_eval;
END $$;

COMMENT ON FUNCTION public.scorecard_score_evaluate IS
  'As duas camadas do score 0-100: a soma ponderada dos tres pilares, e depois os tetos. Os tetos NUNCA sao pesos: Health & Safety e o Fail de CCP limitam o resultado por cima e nao podem ser compensados por volume. Um score nulo nao e zero e nao leva teto.';

-- =====================================================================
-- 7. The weekly view gains the score
--
-- The dependants come down first. v_leader_weekly_scorecard_periods selects w.*, and
-- a view's star is expanded and frozen when it is created: without dropping it, the
-- new score columns would exist on the weekly view and be invisible to every rollup
-- reading through it. The rollups and the two ranking views are dropped only because
-- they sit on top of that one; they are recreated below unchanged apart from the two
-- score columns item M asks for. The trend views are NOT dropped: they read the weekly
-- view by explicit column name and are untouched by anything here.
-- =====================================================================

DROP VIEW IF EXISTS public.v_scorecard_ranking_line;
DROP VIEW IF EXISTS public.v_scorecard_ranking_leader;
DROP VIEW IF EXISTS public.v_scorecard_rollup_line;
DROP VIEW IF EXISTS public.v_scorecard_rollup_leader;
DROP VIEW IF EXISTS public.v_scorecard_rollup_leader_line;
DROP VIEW IF EXISTS public.v_leader_weekly_scorecard_periods;

CREATE OR REPLACE VIEW public.v_leader_weekly_scorecard
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.leader_id,
  ll.name  AS leader_name,
  s.line_id,
  ln.name  AS line_name,
  s.week_ending,
  s.month_start,
  s.quarter_start,
  public.scorecard_month_label(s.month_start)     AS month,
  public.scorecard_quarter_label(s.quarter_start) AS quarter,

  -- Volume
  s.planned_volume,
  s.actual_volume,
  s.unplanned_downtime_minutes,
  s.downtime_reason,
  v.volume_pct,
  v.volume_pct_adjusted,
  v.volume_rag,

  -- Quality
  s.ccp_check_status,
  s.starter_check_status,
  s.volume_weight_check_status,
  q.quality_rag,
  q.quality_fail_type,
  (q.quality_fail_type = 'Fail') AS capa_required,

  -- Health & Safety
  s.lost_time_injuries,
  s.reportable_accidents,
  s.first_aid_cases,
  s.near_misses_reported,
  s.safety_observations_done,
  s.toolbox_talks_done,
  s.ppe_compliance_pct,
  s.hs_training_compliance_pct,
  s.overdue_hs_actions,
  (h.eval).rag     AS hs_rag,
  (h.eval).drivers AS hs_driver,
  ((h.eval).rag IS NULL) AS missing_hs_data,

  -- Monitored — collected, shown, aggregated, and scoring nothing
  s.leader_attendance_pct,
  s.team_attendance_pct,
  s.leader_lateness_incidents,
  s.team_lateness_incidents,
  (s.leader_attendance_pct IS NOT NULL AND s.leader_attendance_pct < t.attend_target)
    AS leader_attendance_below_target,

  -- Rule G
  public.scorecard_overall_rag(v.volume_rag, q.quality_rag, (h.eval).rag) AS overall_rag,

  -- Rule H. Quality, H&S, Volume, missing data — in that order, only the applicable
  -- parts, and every part sourced from a value computed above rather than re-derived.
  NULLIF(concat_ws(' ',
    CASE WHEN q.quality_rag = 'Red' THEN
      'Qualidade: ' || concat_ws('; ',
        CASE s.ccp_check_status WHEN 'Fail' THEN 'CCP reprovado'
                                WHEN 'Not Done' THEN 'CCP nao realizado' END,
        CASE s.starter_check_status WHEN 'Fail' THEN 'Starter reprovado'
                                    WHEN 'Not Done' THEN 'Starter nao realizado' END,
        CASE s.volume_weight_check_status WHEN 'Fail' THEN 'Vol&Peso reprovado'
                                          WHEN 'Not Done' THEN 'Vol&Peso nao realizado' END,
        CASE WHEN s.ccp_check_status IS NULL OR s.starter_check_status IS NULL
               OR s.volume_weight_check_status IS NULL THEN 'check nao registado' END)
      || CASE WHEN q.quality_fail_type = 'Fail' THEN '; CAPA obrigatoria.' ELSE '.' END
    END,
    CASE WHEN (h.eval).rag IN ('Red', 'Amber')
      THEN 'H&S: ' || array_to_string((h.eval).drivers, '; ') || '.' END,
    CASE
      WHEN v.volume_rag = 'Red'
        THEN 'Volume ' || public.scorecard_pct_label(v.volume_pct) || '% (abaixo do plano).'
      WHEN v.volume_rag = 'Amber' AND v.volume_pct > t.vol_green_max
        THEN 'Volume ' || public.scorecard_pct_label(v.volume_pct) || '% (superproducao).'
      WHEN v.volume_rag = 'Amber'
        THEN 'Volume ' || public.scorecard_pct_label(v.volume_pct) || '% (levemente abaixo do plano).'
    END,
    CASE WHEN s.line_id IS NULL     THEN 'Linha de producao nao informada.' END,
    CASE WHEN (h.eval).rag IS NULL  THEN 'Dados de H&S ausentes.' END,
    CASE WHEN v.volume_pct IS NULL  THEN 'Volume nao informado.' END
  ), '') AS rag_driver,

  -- CAPA
  s.root_cause, s.corrective_action, s.capa_owner, s.capa_due_date, s.capa_status,
  s.effectiveness_verified_by, s.effectiveness_verified_on,

  -- Audit trail
  s.submitted_by, s.submitted_at, s.approved_by, s.approved_at,
  (s.approved_at IS NULL) AS pending_approval,
  s.created_at, s.updated_at,

  -- Rule M. The score sits BESIDE the RAG and is not derived from it, nor it from the
  -- score. Ranking and trend read score_final; the leader reads rag_driver to find out
  -- what to do. A single number cannot do both jobs: 82 does not name a missed check.
  sc.prod_score,
  sc.qual_score,
  sc.doc_score,
  sc.score_bruto,
  sc.score_final,
  sc.cap_reason,
  (sc.cap_reason IS NOT NULL) AS cap_applied,
  -- Printed next to the score, because a score whose weights nobody can see is a score
  -- nobody can check.
  t.w_prod AS weight_production,
  t.w_qual AS weight_quality,
  t.w_doc  AS weight_documentation

FROM public.leader_weekly_scorecard s
LEFT JOIN public.line_leaders ll ON ll.id = s.leader_id
LEFT JOIN public.lines        ln ON ln.id = s.line_id

-- The thresholds as of the week being judged. One pass over the table per row, pivoted
-- here so no rule below has to know how the table is shaped.
CROSS JOIN LATERAL (
  SELECT
    max(th.value) FILTER (WHERE th.name = 'THR_VolAmberMin')  AS vol_amber_min,
    max(th.value) FILTER (WHERE th.name = 'THR_VolGreenMin')  AS vol_green_min,
    max(th.value) FILTER (WHERE th.name = 'THR_VolGreenMax')  AS vol_green_max,
    max(th.value) FILTER (WHERE th.name = 'THR_ProdMinutes')  AS prod_minutes,
    max(th.value) FILTER (WHERE th.name = 'THR_HSTrainRed')   AS hs_train_red,
    max(th.value) FILTER (WHERE th.name = 'THR_HSTrainGreen') AS hs_train_green,
    max(th.value) FILTER (WHERE th.name = 'THR_NearMissMin')  AS near_miss_min,
    max(th.value) FILTER (WHERE th.name = 'THR_SafetyObsMin') AS safety_obs_min,
    max(th.value) FILTER (WHERE th.name = 'THR_ToolboxMin')   AS toolbox_min,
    max(th.value) FILTER (WHERE th.name = 'THR_PPEMin')       AS ppe_min,
    max(th.value) FILTER (WHERE th.name = 'THR_AttendTarget') AS attend_target,
    -- The score's parameters, resolved on exactly the same as-of date as the RAG's, so
    -- a week can never be banded under one vintage and scored under another.
    max(th.value) FILTER (WHERE th.name = 'W_Production')        AS w_prod,
    max(th.value) FILTER (WHERE th.name = 'W_Quality')           AS w_qual,
    max(th.value) FILTER (WHERE th.name = 'W_Documentation')     AS w_doc,
    max(th.value) FILTER (WHERE th.name = 'THR_OverProdBand')    AS over_prod_band,
    max(th.value) FILTER (WHERE th.name = 'THR_VolZero')         AS vol_zero,
    max(th.value) FILTER (WHERE th.name = 'THR_QualFailPenalty') AS qual_fail_penalty,
    max(th.value) FILTER (WHERE th.name = 'CAP_Gate')            AS cap_gate,
    max(th.value) FILTER (WHERE th.name = 'CAP_NotDone')         AS cap_not_done,
    max(th.value) FILTER (WHERE th.name = 'CAP_HSAmber')         AS cap_hs_amber,
    max(th.value) FILTER (WHERE th.name = 'USE_AdjustedForScore') AS use_adjusted
  FROM public.leader_scorecard_threshold th
  WHERE s.week_ending >= th.valid_from
    AND (th.valid_to IS NULL OR s.week_ending <= th.valid_to)
) t

CROSS JOIN LATERAL (
  SELECT
    CASE WHEN s.planned_volume IS NULL OR s.actual_volume IS NULL THEN NULL
         ELSE s.actual_volume::numeric / s.planned_volume::numeric END AS volume_pct
) p
CROSS JOIN LATERAL (
  SELECT
    p.volume_pct,
    public.scorecard_volume_pct_adjusted(
      s.actual_volume, s.planned_volume, s.unplanned_downtime_minutes, t.prod_minutes)
      AS volume_pct_adjusted,
    -- The official band reads the RAW figure. The adjusted one is displayed beside it
    -- and judges nothing.
    public.scorecard_volume_rag(
      p.volume_pct, t.vol_amber_min, t.vol_green_min, t.vol_green_max) AS volume_rag
) v
CROSS JOIN LATERAL (
  SELECT ARRAY[s.ccp_check_status, s.starter_check_status, s.volume_weight_check_status]
    AS checks
) c
CROSS JOIN LATERAL (
  SELECT public.scorecard_quality_rag(c.checks)       AS quality_rag,
         public.scorecard_quality_fail_type(c.checks) AS quality_fail_type
) q
CROSS JOIN LATERAL (
  SELECT public.scorecard_hs_evaluate(
    s.lost_time_injuries, s.reportable_accidents, s.first_aid_cases,
    s.near_misses_reported, s.safety_observations_done, s.toolbox_talks_done,
    s.ppe_compliance_pct, s.hs_training_compliance_pct, s.overdue_hs_actions,
    t.hs_train_red, t.hs_train_green, t.near_miss_min,
    t.safety_obs_min, t.toolbox_min, t.ppe_min) AS eval
) h

-- Rule M, both layers, in one call. It is given the H&S band that h computed rather
-- than the raw H&S fields, so the ceiling and the RAG cannot ever disagree about
-- whether the week was Amber.
-- Called in FROM rather than as (f(...)).* in the select list: the star form re-runs
-- the function once per column it expands, and this one is six columns wide.
CROSS JOIN LATERAL public.scorecard_score_evaluate(
    -- The raw figure by default. USE_AdjustedForScore is the business decision, held
    -- as a parameter precisely so it is never an accident.
    CASE WHEN coalesce(t.use_adjusted, 0) = 1 THEN v.volume_pct_adjusted ELSE p.volume_pct END,
    c.checks, s.lost_time_injuries, s.reportable_accidents, (h.eval).rag,
    t.w_prod, t.w_qual, t.w_doc,
    t.vol_amber_min, t.vol_green_min, t.vol_green_max,
    t.over_prod_band, t.vol_zero, t.qual_fail_penalty,
    t.cap_gate, t.cap_not_done, t.cap_hs_amber) AS sc;

COMMENT ON VIEW public.v_leader_weekly_scorecard IS
  'O scorecard semanal calculado, ao nivel lider x linha x semana. Definicao unica de volume_pct, volume_pct_adjusted, volume_rag, quality_rag, quality_fail_type, hs_rag, hs_driver, overall_rag e rag_driver: os rollups, o resumo, a tendencia e o ranking leem esta view e nao repetem nenhuma regra.';


-- The weekly view, once per period it belongs to, so the three rollups group the same
-- rows the same way without any of them restating what a month is.
CREATE OR REPLACE VIEW public.v_leader_weekly_scorecard_periods
WITH (security_invoker = true) AS
SELECT w.*, x.period_type, x.period_start
FROM public.v_leader_weekly_scorecard w
CROSS JOIN LATERAL (
  VALUES ('mensal', w.month_start), ('trimestral', w.quarter_start)
) AS x(period_type, period_start);

-- =====================================================================

CREATE OR REPLACE VIEW public.v_scorecard_rollup_leader_line
WITH (security_invoker = true) AS
SELECT
  sp.period_type,
  sp.period_start,
  sp.period_label,
  sp.leader_id,
  ll.name AS leader_name,
  sp.line_id,
  ln.name AS line_name,

  count(w.id)                                       AS weeks_recorded,

  -- Volume
  avg(w.volume_pct)                                 AS avg_volume_pct,
  avg(w.volume_pct_adjusted)                        AS avg_volume_pct_adjusted,
  public.scorecard_volume_rag(avg(w.volume_pct), t.vol_amber_min, t.vol_green_min, t.vol_green_max)
                                                    AS volume_rag,
  coalesce(sum(w.unplanned_downtime_minutes), 0)    AS total_unplanned_downtime_minutes,
  mode() WITHIN GROUP (ORDER BY w.downtime_reason)
    FILTER (WHERE w.downtime_reason IS NOT NULL AND w.downtime_reason <> 'NA')
                                                    AS top_downtime_reason,

  -- Quality. The two counts are kept apart because only one of them means a product
  -- deviation, and an auditor asks for that one by name.
  count(*) FILTER (WHERE w.quality_rag = 'Red')          AS weeks_quality_red,
  count(*) FILTER (WHERE w.quality_fail_type = 'Fail')   AS weeks_with_fail,
  count(*) FILTER (WHERE w.quality_fail_type = 'Not Done') AS weeks_with_not_done,
  -- GUARD 1. Nothing recorded is 'Sem dados'. Never Green.
  CASE
    WHEN count(w.id) = 0                                   THEN 'Sem dados'
    WHEN count(*) FILTER (WHERE w.quality_rag = 'Red') > 0 THEN 'Red'
    WHEN count(*) FILTER (WHERE w.quality_rag IS NOT NULL) = 0 THEN 'Sem dados'
    ELSE 'Green'
  END                                               AS quality_rag,

  -- Health & Safety
  coalesce(sum(w.lost_time_injuries), 0)            AS total_lti,
  coalesce(sum(w.reportable_accidents), 0)          AS total_reportable,
  coalesce(sum(w.first_aid_cases), 0)               AS total_first_aid,
  coalesce(sum(w.near_misses_reported), 0)          AS total_near_misses,
  -- Per week, and NULL rather than 0 when there is no week to divide by: a rate over
  -- nothing is not a rate of zero.
  sum(w.near_misses_reported)::numeric / nullif(count(w.id), 0) AS near_misses_per_week,
  coalesce(sum(w.safety_observations_done), 0)      AS total_safety_observations,
  coalesce(sum(w.toolbox_talks_done), 0)            AS total_toolbox_talks,
  avg(w.ppe_compliance_pct)                         AS avg_ppe_pct,
  avg(w.hs_training_compliance_pct)                 AS avg_hs_training_pct,
  max(w.overdue_hs_actions)                         AS max_overdue_hs_actions,
  -- GUARD 2. Weeks recorded but no H&S in any of them is 'Sem dados', NOT Amber.
  -- Without this line near_misses_per_week = 0 fires the under-reporting rule and a
  -- group nobody collected anything for is reported as merely amber, which hides the
  -- fact that nobody collected anything.
  CASE
    WHEN count(w.id) = 0                                THEN 'Sem dados'
    WHEN count(*) FILTER (WHERE w.hs_rag IS NOT NULL) = 0 THEN 'Sem dados'
    WHEN count(*) FILTER (WHERE w.hs_rag = 'Red')   > 0 THEN 'Red'
    WHEN count(*) FILTER (WHERE w.hs_rag = 'Amber') > 0 THEN 'Amber'
    ELSE 'Green'
  END                                               AS hs_rag,

  -- The same gate as the week, entered through the same function. 'Sem dados' is
  -- handed in as NULL so a group with nothing recorded cannot come out Green.
  public.scorecard_overall_rag(
    public.scorecard_volume_rag(avg(w.volume_pct), t.vol_amber_min, t.vol_green_min, t.vol_green_max),
    CASE
      WHEN count(w.id) = 0                                   THEN NULL
      WHEN count(*) FILTER (WHERE w.quality_rag = 'Red') > 0 THEN 'Red'
      WHEN count(*) FILTER (WHERE w.quality_rag IS NOT NULL) = 0 THEN NULL
      ELSE 'Green' END,
    CASE
      WHEN count(*) FILTER (WHERE w.hs_rag IS NOT NULL) = 0 THEN NULL
      WHEN count(*) FILTER (WHERE w.hs_rag = 'Red')   > 0   THEN 'Red'
      WHEN count(*) FILTER (WHERE w.hs_rag = 'Amber') > 0   THEN 'Amber'
      ELSE 'Green' END)                             AS overall_rag,

  -- Monitored. Aggregated, displayed, and scoring nothing.
  avg(w.leader_attendance_pct)                      AS avg_leader_attendance,
  avg(w.team_attendance_pct)                        AS avg_team_attendance,
  coalesce(sum(w.team_lateness_incidents), 0)       AS total_team_lateness,

  count(*) FILTER (WHERE w.capa_status = 'Verificada')::numeric
    / nullif(count(*) FILTER (WHERE w.capa_status IS NOT NULL), 0) AS capa_closure_rate,

  -- Rule M, aggregated. avg() already skips NULLs, and that is the whole point: a week
  -- with no checks recorded has no score, and counting it as a zero would drag the
  -- average down as if the leader had earned nothing. In a weighted score that mistake
  -- is invisible, because "nothing recorded" and "scored nothing" arrive as the same
  -- number.
  avg(w.score_final)                          AS avg_score_final,
  count(*) FILTER (WHERE w.cap_applied)       AS weeks_with_cap_applied

FROM public.v_scorecard_period_spine sp
LEFT JOIN public.line_leaders ll ON ll.id = sp.leader_id
LEFT JOIN public.lines        ln ON ln.id = sp.line_id
LEFT JOIN public.v_leader_weekly_scorecard_periods w
       ON w.leader_id   = sp.leader_id
      AND w.line_id     = sp.line_id
      AND w.period_type = sp.period_type
      AND w.period_start = sp.period_start
-- Bands as of the end of the period being summarised, so a re-banding mid-period does
-- not leave the average judged under a rule that only started later.
CROSS JOIN LATERAL (
  SELECT
    max(th.value) FILTER (WHERE th.name = 'THR_VolAmberMin') AS vol_amber_min,
    max(th.value) FILTER (WHERE th.name = 'THR_VolGreenMin') AS vol_green_min,
    max(th.value) FILTER (WHERE th.name = 'THR_VolGreenMax') AS vol_green_max
  FROM public.leader_scorecard_threshold th
  WHERE sp.period_end >= th.valid_from
    AND (th.valid_to IS NULL OR sp.period_end <= th.valid_to)
) t
GROUP BY sp.period_type, sp.period_start, sp.period_label, sp.leader_id, ll.name,
         sp.line_id, ln.name, t.vol_amber_min, t.vol_green_min, t.vol_green_max;

COMMENT ON VIEW public.v_scorecard_rollup_leader_line IS
  'Rollup C: lider x linha x periodo, mensal e trimestral na mesma view (period_type). Contem os dois guards de "Sem dados".';


-- =====================================================================

CREATE OR REPLACE VIEW public.v_scorecard_rollup_leader
WITH (security_invoker = true) AS
SELECT
  sp.period_type, sp.period_start, sp.period_label,
  sp.leader_id, ll.name AS leader_name,
  count(w.id) AS weeks_recorded,
  avg(w.volume_pct) AS avg_volume_pct,
  avg(w.volume_pct_adjusted) AS avg_volume_pct_adjusted,
  public.scorecard_volume_rag(avg(w.volume_pct), t.vol_amber_min, t.vol_green_min, t.vol_green_max) AS volume_rag,
  coalesce(sum(w.unplanned_downtime_minutes), 0) AS total_unplanned_downtime_minutes,
  mode() WITHIN GROUP (ORDER BY w.downtime_reason)
    FILTER (WHERE w.downtime_reason IS NOT NULL AND w.downtime_reason <> 'NA') AS top_downtime_reason,
  count(*) FILTER (WHERE w.quality_rag = 'Red')            AS weeks_quality_red,
  count(*) FILTER (WHERE w.quality_fail_type = 'Fail')     AS weeks_with_fail,
  count(*) FILTER (WHERE w.quality_fail_type = 'Not Done') AS weeks_with_not_done,
  CASE
    WHEN count(w.id) = 0                                       THEN 'Sem dados'
    WHEN count(*) FILTER (WHERE w.quality_rag = 'Red') > 0     THEN 'Red'
    WHEN count(*) FILTER (WHERE w.quality_rag IS NOT NULL) = 0 THEN 'Sem dados'
    ELSE 'Green' END                                        AS quality_rag,
  coalesce(sum(w.lost_time_injuries), 0)       AS total_lti,
  coalesce(sum(w.reportable_accidents), 0)     AS total_reportable,
  coalesce(sum(w.first_aid_cases), 0)          AS total_first_aid,
  coalesce(sum(w.near_misses_reported), 0)     AS total_near_misses,
  sum(w.near_misses_reported)::numeric / nullif(count(w.id), 0) AS near_misses_per_week,
  coalesce(sum(w.safety_observations_done), 0) AS total_safety_observations,
  coalesce(sum(w.toolbox_talks_done), 0)       AS total_toolbox_talks,
  avg(w.ppe_compliance_pct)                    AS avg_ppe_pct,
  avg(w.hs_training_compliance_pct)            AS avg_hs_training_pct,
  max(w.overdue_hs_actions)                    AS max_overdue_hs_actions,
  CASE
    WHEN count(w.id) = 0                                  THEN 'Sem dados'
    WHEN count(*) FILTER (WHERE w.hs_rag IS NOT NULL) = 0 THEN 'Sem dados'
    WHEN count(*) FILTER (WHERE w.hs_rag = 'Red')   > 0   THEN 'Red'
    WHEN count(*) FILTER (WHERE w.hs_rag = 'Amber') > 0   THEN 'Amber'
    ELSE 'Green' END                            AS hs_rag,
  public.scorecard_overall_rag(
    public.scorecard_volume_rag(avg(w.volume_pct), t.vol_amber_min, t.vol_green_min, t.vol_green_max),
    CASE WHEN count(w.id) = 0 THEN NULL
         WHEN count(*) FILTER (WHERE w.quality_rag = 'Red') > 0 THEN 'Red'
         WHEN count(*) FILTER (WHERE w.quality_rag IS NOT NULL) = 0 THEN NULL
         ELSE 'Green' END,
    CASE WHEN count(*) FILTER (WHERE w.hs_rag IS NOT NULL) = 0 THEN NULL
         WHEN count(*) FILTER (WHERE w.hs_rag = 'Red')   > 0 THEN 'Red'
         WHEN count(*) FILTER (WHERE w.hs_rag = 'Amber') > 0 THEN 'Amber'
         ELSE 'Green' END)                      AS overall_rag,
  avg(w.leader_attendance_pct)                  AS avg_leader_attendance,
  avg(w.team_attendance_pct)                    AS avg_team_attendance,
  coalesce(sum(w.team_lateness_incidents), 0)   AS total_team_lateness,
  count(*) FILTER (WHERE w.capa_status = 'Verificada')::numeric
    / nullif(count(*) FILTER (WHERE w.capa_status IS NOT NULL), 0) AS capa_closure_rate,

  -- Rule M, aggregated. avg() already skips NULLs, and that is the whole point: a week
  -- with no checks recorded has no score, and counting it as a zero would drag the
  -- average down as if the leader had earned nothing. In a weighted score that mistake
  -- is invisible, because "nothing recorded" and "scored nothing" arrive as the same
  -- number.
  avg(w.score_final)                          AS avg_score_final,
  count(*) FILTER (WHERE w.cap_applied)       AS weeks_with_cap_applied
FROM (SELECT DISTINCT period_type, period_start, period_end, period_label, leader_id
        FROM public.v_scorecard_period_spine) sp
LEFT JOIN public.line_leaders ll ON ll.id = sp.leader_id
LEFT JOIN public.v_leader_weekly_scorecard_periods w
       ON w.leader_id = sp.leader_id
      AND w.period_type = sp.period_type
      AND w.period_start = sp.period_start
CROSS JOIN LATERAL (
  SELECT max(th.value) FILTER (WHERE th.name = 'THR_VolAmberMin') AS vol_amber_min,
         max(th.value) FILTER (WHERE th.name = 'THR_VolGreenMin') AS vol_green_min,
         max(th.value) FILTER (WHERE th.name = 'THR_VolGreenMax') AS vol_green_max
  FROM public.leader_scorecard_threshold th
  WHERE sp.period_end >= th.valid_from AND (th.valid_to IS NULL OR sp.period_end <= th.valid_to)
) t
GROUP BY sp.period_type, sp.period_start, sp.period_label, sp.leader_id, ll.name,
         t.vol_amber_min, t.vol_green_min, t.vol_green_max;

COMMENT ON VIEW public.v_scorecard_rollup_leader IS
  'Rollup A: lider x periodo. Media sobre as SEMANAS do lider, nao media das medias por linha — senao uma linha com uma semana pesaria o mesmo que uma com dez.';


CREATE OR REPLACE VIEW public.v_scorecard_rollup_line
WITH (security_invoker = true) AS
SELECT
  sp.period_type, sp.period_start, sp.period_label,
  sp.line_id, ln.name AS line_name,
  count(w.id) AS weeks_recorded,
  avg(w.volume_pct) AS avg_volume_pct,
  avg(w.volume_pct_adjusted) AS avg_volume_pct_adjusted,
  public.scorecard_volume_rag(avg(w.volume_pct), t.vol_amber_min, t.vol_green_min, t.vol_green_max) AS volume_rag,
  coalesce(sum(w.unplanned_downtime_minutes), 0) AS total_unplanned_downtime_minutes,
  mode() WITHIN GROUP (ORDER BY w.downtime_reason)
    FILTER (WHERE w.downtime_reason IS NOT NULL AND w.downtime_reason <> 'NA') AS top_downtime_reason,
  count(*) FILTER (WHERE w.quality_rag = 'Red')            AS weeks_quality_red,
  count(*) FILTER (WHERE w.quality_fail_type = 'Fail')     AS weeks_with_fail,
  count(*) FILTER (WHERE w.quality_fail_type = 'Not Done') AS weeks_with_not_done,
  CASE
    WHEN count(w.id) = 0                                       THEN 'Sem dados'
    WHEN count(*) FILTER (WHERE w.quality_rag = 'Red') > 0     THEN 'Red'
    WHEN count(*) FILTER (WHERE w.quality_rag IS NOT NULL) = 0 THEN 'Sem dados'
    ELSE 'Green' END                                        AS quality_rag,
  coalesce(sum(w.lost_time_injuries), 0)       AS total_lti,
  coalesce(sum(w.reportable_accidents), 0)     AS total_reportable,
  coalesce(sum(w.first_aid_cases), 0)          AS total_first_aid,
  coalesce(sum(w.near_misses_reported), 0)     AS total_near_misses,
  sum(w.near_misses_reported)::numeric / nullif(count(w.id), 0) AS near_misses_per_week,
  coalesce(sum(w.safety_observations_done), 0) AS total_safety_observations,
  coalesce(sum(w.toolbox_talks_done), 0)       AS total_toolbox_talks,
  avg(w.ppe_compliance_pct)                    AS avg_ppe_pct,
  avg(w.hs_training_compliance_pct)            AS avg_hs_training_pct,
  max(w.overdue_hs_actions)                    AS max_overdue_hs_actions,
  CASE
    WHEN count(w.id) = 0                                  THEN 'Sem dados'
    WHEN count(*) FILTER (WHERE w.hs_rag IS NOT NULL) = 0 THEN 'Sem dados'
    WHEN count(*) FILTER (WHERE w.hs_rag = 'Red')   > 0   THEN 'Red'
    WHEN count(*) FILTER (WHERE w.hs_rag = 'Amber') > 0   THEN 'Amber'
    ELSE 'Green' END                            AS hs_rag,
  public.scorecard_overall_rag(
    public.scorecard_volume_rag(avg(w.volume_pct), t.vol_amber_min, t.vol_green_min, t.vol_green_max),
    CASE WHEN count(w.id) = 0 THEN NULL
         WHEN count(*) FILTER (WHERE w.quality_rag = 'Red') > 0 THEN 'Red'
         WHEN count(*) FILTER (WHERE w.quality_rag IS NOT NULL) = 0 THEN NULL
         ELSE 'Green' END,
    CASE WHEN count(*) FILTER (WHERE w.hs_rag IS NOT NULL) = 0 THEN NULL
         WHEN count(*) FILTER (WHERE w.hs_rag = 'Red')   > 0 THEN 'Red'
         WHEN count(*) FILTER (WHERE w.hs_rag = 'Amber') > 0 THEN 'Amber'
         ELSE 'Green' END)                      AS overall_rag,
  avg(w.leader_attendance_pct)                  AS avg_leader_attendance,
  avg(w.team_attendance_pct)                    AS avg_team_attendance,
  coalesce(sum(w.team_lateness_incidents), 0)   AS total_team_lateness,
  count(*) FILTER (WHERE w.capa_status = 'Verificada')::numeric
    / nullif(count(*) FILTER (WHERE w.capa_status IS NOT NULL), 0) AS capa_closure_rate,

  -- Rule M, aggregated. avg() already skips NULLs, and that is the whole point: a week
  -- with no checks recorded has no score, and counting it as a zero would drag the
  -- average down as if the leader had earned nothing. In a weighted score that mistake
  -- is invisible, because "nothing recorded" and "scored nothing" arrive as the same
  -- number.
  avg(w.score_final)                          AS avg_score_final,
  count(*) FILTER (WHERE w.cap_applied)       AS weeks_with_cap_applied
FROM (SELECT DISTINCT period_type, period_start, period_end, period_label, line_id
        FROM public.v_scorecard_period_spine) sp
LEFT JOIN public.lines ln ON ln.id = sp.line_id
LEFT JOIN public.v_leader_weekly_scorecard_periods w
       ON w.line_id = sp.line_id
      AND w.period_type = sp.period_type
      AND w.period_start = sp.period_start
CROSS JOIN LATERAL (
  SELECT max(th.value) FILTER (WHERE th.name = 'THR_VolAmberMin') AS vol_amber_min,
         max(th.value) FILTER (WHERE th.name = 'THR_VolGreenMin') AS vol_green_min,
         max(th.value) FILTER (WHERE th.name = 'THR_VolGreenMax') AS vol_green_max
  FROM public.leader_scorecard_threshold th
  WHERE sp.period_end >= th.valid_from AND (th.valid_to IS NULL OR sp.period_end <= th.valid_to)
) t
GROUP BY sp.period_type, sp.period_start, sp.period_label, sp.line_id, ln.name,
         t.vol_amber_min, t.vol_green_min, t.vol_green_max;

COMMENT ON VIEW public.v_scorecard_rollup_line IS
  'Rollup B: linha x periodo. Uma linha coberta por dois lideres no mesmo periodo aparece uma so vez, com as semanas dos dois.';


-- =====================================================================

CREATE OR REPLACE VIEW public.v_scorecard_ranking_leader
WITH (security_invoker = true) AS
WITH agg AS (
  SELECT
    w.period_type, w.period_start, w.leader_id,
    count(*)                                             AS weeks_recorded,
    count(*) FILTER (WHERE w.overall_rag = 'Red')        AS weeks_red,
    count(*) FILTER (WHERE w.quality_fail_type = 'Fail') AS weeks_with_fail,
    coalesce(sum(w.lost_time_injuries), 0)               AS total_lti
  FROM public.v_leader_weekly_scorecard_periods w
  GROUP BY w.period_type, w.period_start, w.leader_id
)
SELECT
  a.period_type, a.period_start,
  CASE WHEN a.period_type = 'mensal' THEN public.scorecard_month_label(a.period_start)
       ELSE public.scorecard_quarter_label(a.period_start) END AS period_label,
  a.leader_id, ll.name AS leader_name,
  a.weeks_recorded, a.weeks_red, a.weeks_with_fail, a.total_lti,
  a.weeks_red::numeric / nullif(a.weeks_recorded, 0) AS pct_weeks_red,
  rank() OVER (PARTITION BY a.period_type, a.period_start
               ORDER BY a.weeks_red::numeric / nullif(a.weeks_recorded, 0) DESC,
                        a.weeks_with_fail DESC, a.total_lti DESC) AS rank
FROM agg a
LEFT JOIN public.line_leaders ll ON ll.id = a.leader_id
CROSS JOIN LATERAL (
  SELECT max(th.value) FILTER (WHERE th.name = 'THR_MinWeeks') AS min_weeks
  FROM public.leader_scorecard_threshold th
  WHERE a.period_start >= th.valid_from AND (th.valid_to IS NULL OR a.period_start <= th.valid_to)
) t
WHERE a.weeks_recorded >= t.min_weeks;

CREATE OR REPLACE VIEW public.v_scorecard_ranking_line
WITH (security_invoker = true) AS
WITH agg AS (
  SELECT
    w.period_type, w.period_start, w.line_id,
    count(*)                                             AS weeks_recorded,
    count(*) FILTER (WHERE w.overall_rag = 'Red')        AS weeks_red,
    count(*) FILTER (WHERE w.quality_fail_type = 'Fail') AS weeks_with_fail,
    coalesce(sum(w.lost_time_injuries), 0)               AS total_lti
  FROM public.v_leader_weekly_scorecard_periods w
  WHERE w.line_id IS NOT NULL
  GROUP BY w.period_type, w.period_start, w.line_id
)
SELECT
  a.period_type, a.period_start,
  CASE WHEN a.period_type = 'mensal' THEN public.scorecard_month_label(a.period_start)
       ELSE public.scorecard_quarter_label(a.period_start) END AS period_label,
  a.line_id, ln.name AS line_name,
  a.weeks_recorded, a.weeks_red, a.weeks_with_fail, a.total_lti,
  a.weeks_red::numeric / nullif(a.weeks_recorded, 0) AS pct_weeks_red,
  rank() OVER (PARTITION BY a.period_type, a.period_start
               ORDER BY a.weeks_red::numeric / nullif(a.weeks_recorded, 0) DESC,
                        a.weeks_with_fail DESC, a.total_lti DESC) AS rank
FROM agg a
LEFT JOIN public.lines ln ON ln.id = a.line_id
CROSS JOIN LATERAL (
  SELECT max(th.value) FILTER (WHERE th.name = 'THR_MinWeeks') AS min_weeks
  FROM public.leader_scorecard_threshold th
  WHERE a.period_start >= th.valid_from AND (th.valid_to IS NULL OR a.period_start <= th.valid_to)
) t
WHERE a.weeks_recorded >= t.min_weeks;

