-- The week is Red when the check is missed.
--
-- The weekly Line Leader scorecard, which until now lived in a spreadsheet: one row
-- per leader per week, with the volume against plan, the three food-safety checks,
-- attendance, training and near misses. It is NOT the leader card that already
-- exists in this system. That one (leader_self_scorecard + src/lib/leaderScorecard.ts)
-- reads production sessions and quality actions day by day, and deliberately keeps
-- its arithmetic in TypeScript so a leader and their manager cannot be shown two
-- different scores for the same person. This module shares no field and no surface
-- with it: nothing here is ever displayed on that card, so the two cannot disagree.
--
-- The arithmetic lives in the database here for one reason: the thresholds have to be
-- editable by management. A generated column cannot read another table, so it would
-- have to carry 0.97 in its own definition — and changing the band would mean
-- rewriting the table. A trigger would freeze each week's RAG at the moment it was
-- typed, so an edited threshold would leave the history disagreeing with the rule
-- that produced it until somebody remembered to backfill. A view computes on read:
-- one place, no backfill, and the whole history moves the day the band moves.
--
-- Quality is an absolute gate. In the overall_rag CASE below, the quality branch is
-- the first one, so no volume figure — however good — can lift a week where a CCP,
-- starter or volume/weight check was not completed. Nothing added later may be
-- placed above that branch.

-- =====================================================================
-- 1. Thresholds — configurable, never literal in a query
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.leader_scorecard_thresholds (
  id                boolean PRIMARY KEY DEFAULT true CHECK (id),
  volume_green_min  numeric(6,4) NOT NULL DEFAULT 1.0000,
  volume_amber_min  numeric(6,4) NOT NULL DEFAULT 0.9700,
  attendance_min    numeric(6,4) NOT NULL DEFAULT 0.9950,
  updated_at        timestamptz NOT NULL DEFAULT now(),
  updated_by        uuid,
  -- A half-finished edit must not be able to leave the amber band empty or inverted.
  CONSTRAINT thresholds_ordered CHECK (volume_amber_min <= volume_green_min),
  CONSTRAINT thresholds_in_range CHECK (
    volume_green_min > 0 AND volume_amber_min > 0 AND attendance_min BETWEEN 0 AND 1)
);

INSERT INTO public.leader_scorecard_thresholds (id) VALUES (true)
ON CONFLICT (id) DO NOTHING;

COMMENT ON TABLE public.leader_scorecard_thresholds IS
  'The RAG bands of the weekly leader scorecard. One row, read by every view in this module. There is deliberately no DELETE policy: the views CROSS JOIN this row, so deleting it would empty the whole scorecard rather than raise an error.';

-- =====================================================================
-- 2. The weekly record — the only table anyone types into
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.leader_weekly_scorecard (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),

  line_leader     text NOT NULL CHECK (btrim(line_leader) <> ''),
  -- leader_pins spells five of these people in capitals while the production tables
  -- spell them in title case, and leader_self_scorecard already had to fold case to
  -- stop cards opening at zero. Grouping a new module on the raw text would repeat
  -- that bug, so the key is folded once, here, and everything groups on it.
  line_leader_key text GENERATED ALWAYS AS (lower(btrim(line_leader))) STORED,

  week_ending     date NOT NULL,
  -- date_trunc(text, timestamp) is IMMUTABLE, and so is date -> timestamp, so both
  -- may sit in a generated column. to_char(..., 'Mon') may not: it reads lc_time and
  -- would render the month in whatever language the session happens to be in.
  -- The "Jul-2026" / "Q3-2026" labels are built on read, in the view.
  month_start     date GENERATED ALWAYS AS ((date_trunc('month',   week_ending::timestamp))::date) STORED,
  quarter_start   date GENERATED ALWAYS AS ((date_trunc('quarter', week_ending::timestamp))::date) STORED,

  planned_volume  integer CHECK (planned_volume > 0),
  actual_volume   integer CHECK (actual_volume >= 0),

  ccp_check_completed           char(1) CHECK (ccp_check_completed           IN ('Y','N')),
  starter_check_completed       char(1) CHECK (starter_check_completed       IN ('Y','N')),
  volume_weight_check_completed char(1) CHECK (volume_weight_check_completed IN ('Y','N')),

  leader_attendance_pct   numeric(5,4) CHECK (leader_attendance_pct   BETWEEN 0 AND 1),
  team_attendance_pct     numeric(5,4) CHECK (team_attendance_pct     BETWEEN 0 AND 1),
  training_compliance_pct numeric(5,4) CHECK (training_compliance_pct BETWEEN 0 AND 1),

  leader_lateness_incidents integer CHECK (leader_lateness_incidents >= 0),
  team_lateness_incidents   integer CHECK (team_lateness_incidents   >= 0),
  hs_near_misses_reported   integer CHECK (hs_near_misses_reported   >= 0),

  root_cause        text,
  corrective_action text,
  owner             text,
  due_date          date,

  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  updated_by uuid
);

COMMENT ON COLUMN public.leader_weekly_scorecard.planned_volume IS
  'NULL means the plan was not given, which is not the same as zero. Zero is refused by the CHECK: it is not a plan, it is a division that cannot be done.';
COMMENT ON COLUMN public.leader_weekly_scorecard.ccp_check_completed IS
  'Y, N, or NULL for not recorded. A blank is never read as a pass.';

CREATE UNIQUE INDEX IF NOT EXISTS leader_weekly_scorecard_leader_week_uk
  ON public.leader_weekly_scorecard (line_leader_key, week_ending);
CREATE INDEX IF NOT EXISTS leader_weekly_scorecard_week_idx
  ON public.leader_weekly_scorecard (week_ending DESC);
CREATE INDEX IF NOT EXISTS leader_weekly_scorecard_month_idx
  ON public.leader_weekly_scorecard (month_start, line_leader_key);
CREATE INDEX IF NOT EXISTS leader_weekly_scorecard_quarter_idx
  ON public.leader_weekly_scorecard (quarter_start, line_leader_key);

DROP TRIGGER IF EXISTS trg_leader_weekly_scorecard_updated_at ON public.leader_weekly_scorecard;
CREATE TRIGGER trg_leader_weekly_scorecard_updated_at
  BEFORE UPDATE ON public.leader_weekly_scorecard
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- =====================================================================
-- 3. The rules, as functions — one definition each
-- =====================================================================

-- Rule 2. The only place a volume band is decided. It takes the thresholds as
-- arguments rather than reading them, so the same function serves the week and the
-- monthly/quarterly average ("the same band table applied to the mean").
CREATE OR REPLACE FUNCTION public.leader_volume_rag(
  _pct numeric, _green_min numeric, _amber_min numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _pct IS NULL       THEN NULL      -- no data is not a zero
    WHEN _pct >= _green_min THEN 'Green'
    WHEN _pct >= _amber_min THEN 'Amber'
    ELSE                         'Red'
  END;
$$;

-- "Jul-2026". Month names are fixed in English, as the spreadsheet writes them,
-- rather than left to lc_time.
CREATE OR REPLACE FUNCTION public.leader_month_label(_d date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _d IS NULL THEN NULL ELSE
    (ARRAY['Jan','Feb','Mar','Apr','May','Jun',
           'Jul','Aug','Sep','Oct','Nov','Dec'])[EXTRACT(MONTH FROM _d)::int]
    || '-' || EXTRACT(YEAR FROM _d)::text END;
$$;

-- "Q3-2026"
CREATE OR REPLACE FUNCTION public.leader_quarter_label(_d date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _d IS NULL THEN NULL ELSE
    'Q' || EXTRACT(QUARTER FROM _d)::text || '-' || EXTRACT(YEAR FROM _d)::text END;
$$;

-- 0.984 -> "98,4", for the driver text.
CREATE OR REPLACE FUNCTION public.leader_pct_label(_pct numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(to_char(round(_pct * 100, 1), 'FM990.0'), '.', ',');
$$;

-- =====================================================================
-- 4. The base view — every other view in this module reads this one
-- =====================================================================

CREATE OR REPLACE VIEW public.v_leader_weekly_scorecard
WITH (security_invoker = true) AS
SELECT
  s.id,
  s.line_leader,
  s.line_leader_key,
  s.week_ending,
  s.month_start,
  s.quarter_start,
  public.leader_month_label(s.month_start)     AS month,
  public.leader_quarter_label(s.quarter_start) AS quarter,

  s.planned_volume,
  s.actual_volume,

  -- Rule 1. NULL if either side is missing; the CHECK already rules out plan = 0.
  v.volume_pct,

  -- Rule 2.
  v.volume_rag,

  -- Rule 3. Red if ANY check is N, Green only if all three are Y, NULL when all three
  -- are blank. One Y and two blanks is NOT Green: the sheet does not claim the other
  -- two were done, and in a BRC-HACCP context an unrecorded check is not a pass.
  q.quality_rag,

  -- Rule 4.
  a.attendance_status,

  -- Rule 5. THE GATE. The quality branch is first and nothing may be put above it.
  CASE
    WHEN q.quality_rag = 'Red'                         THEN 'Red'
    WHEN q.quality_rag IS NULL OR v.volume_rag IS NULL THEN NULL
    ELSE v.volume_rag
  END AS overall_rag,

  -- Rule 6. Only the applicable parts, in the order the sheet writes them.
  NULLIF(btrim(
      CASE WHEN q.quality_rag = 'Red' THEN
        'Qualidade: '
        || concat_ws(', ',
             CASE WHEN s.ccp_check_completed           = 'N' THEN 'CCP'      END,
             CASE WHEN s.starter_check_completed       = 'N' THEN 'Starter'  END,
             CASE WHEN s.volume_weight_check_completed = 'N' THEN 'Vol&Peso' END)
        || ' não concluído.' ELSE '' END
   || CASE WHEN v.volume_rag = 'Red'   THEN ' Volume ' || public.leader_pct_label(v.volume_pct)
                                            || '% do plano (>3% abaixo).' ELSE '' END
   || CASE WHEN v.volume_rag = 'Amber' THEN ' Volume ' || public.leader_pct_label(v.volume_pct)
                                            || '% (até 3% abaixo).' ELSE '' END
   || CASE WHEN a.attendance_status = 'Not Met' THEN ' Assiduidade abaixo de '
            || public.leader_pct_label(t.attendance_min) || '%.' ELSE '' END
   || CASE WHEN a.attendance_status IS NULL       THEN ' Dados de assiduidade ausentes.' ELSE '' END
   || CASE WHEN s.training_compliance_pct IS NULL THEN ' Treinamento não informado.'     ELSE '' END
  ), '') AS rag_driver,

  -- People: tracked and flagged, individually. It carries no weight in overall_rag.
  s.leader_attendance_pct,
  s.team_attendance_pct,
  s.leader_lateness_incidents,
  s.team_lateness_incidents,
  s.training_compliance_pct,
  s.hs_near_misses_reported,
  (s.leader_attendance_pct IS NULL AND s.team_attendance_pct IS NULL) AS missing_attendance_data,
  (s.training_compliance_pct IS NULL)                                 AS missing_training_data,

  s.root_cause, s.corrective_action, s.owner, s.due_date,
  s.created_at, s.updated_at
FROM public.leader_weekly_scorecard s
CROSS JOIN public.leader_scorecard_thresholds t
CROSS JOIN LATERAL (
  SELECT CASE WHEN s.planned_volume IS NULL OR s.actual_volume IS NULL THEN NULL
              ELSE s.actual_volume::numeric / s.planned_volume::numeric END AS volume_pct
) p
CROSS JOIN LATERAL (
  SELECT p.volume_pct,
         public.leader_volume_rag(p.volume_pct, t.volume_green_min, t.volume_amber_min) AS volume_rag
) v
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN s.ccp_check_completed IS NULL
     AND s.starter_check_completed IS NULL
     AND s.volume_weight_check_completed IS NULL  THEN NULL
    WHEN 'N' IN (s.ccp_check_completed,
                 s.starter_check_completed,
                 s.volume_weight_check_completed) THEN 'Red'
    WHEN s.ccp_check_completed           = 'Y'
     AND s.starter_check_completed       = 'Y'
     AND s.volume_weight_check_completed = 'Y'    THEN 'Green'
    ELSE NULL                                     -- partly filled in: a gap, not a pass
  END AS quality_rag
) q
CROSS JOIN LATERAL (
  SELECT CASE
    WHEN s.leader_attendance_pct IS NULL
     AND s.team_attendance_pct   IS NULL                          THEN NULL
    -- One side blank and the other below the line is still Not Met: the figure that
    -- exists already fails.
    WHEN COALESCE(s.leader_attendance_pct, 1) < t.attendance_min
      OR COALESCE(s.team_attendance_pct,   1) < t.attendance_min  THEN 'Not Met'
    ELSE 'Met'
  END AS attendance_status
) a;

COMMENT ON VIEW public.v_leader_weekly_scorecard IS
  'The weekly leader scorecard, calculated. The single definition of volume_pct, volume_rag, quality_rag, attendance_status, overall_rag and rag_driver — the rollups and the summary read this view and never restate a rule.';

-- ---------------------------------------------------------------------
-- EXTENSION POINT — deliberately not implemented.
-- People (attendance, lateness, training, near misses) is tracked and named in
-- rag_driver but carries NO weight in overall_rag. If that changes, only the
-- overall_rag CASE above changes, plus weight columns on
-- leader_scorecard_thresholds. The `WHEN quality_rag = 'Red' THEN 'Red'` branch
-- must remain the first one: quality is an absolute gate, because it is food safety.
-- ---------------------------------------------------------------------

-- =====================================================================
-- 5. Monthly rollup
--
-- Driven by a leader x period grid, LEFT JOINed to the weeks. A leader with no week
-- in a month therefore still produces a row, reading 'Sem dados' — where a plain
-- GROUP BY over the weeks would have dropped the group entirely, and a COUNTIFS over
-- "weeks with a quality failure = 0" would have called that month clean.
-- =====================================================================

CREATE OR REPLACE VIEW public.v_leader_scorecard_monthly
WITH (security_invoker = true) AS
WITH leaders AS (SELECT DISTINCT line_leader_key, line_leader FROM public.v_leader_weekly_scorecard),
     months  AS (SELECT DISTINCT month_start FROM public.v_leader_weekly_scorecard),
     grid    AS (SELECT l.line_leader_key, l.line_leader, m.month_start
                   FROM leaders l CROSS JOIN months m)
SELECT
  g.line_leader,
  g.month_start,
  public.leader_month_label(g.month_start) AS month,
  COUNT(w.id)                              AS weeks_recorded,
  AVG(w.volume_pct)                        AS avg_volume_pct,
  public.leader_volume_rag(AVG(w.volume_pct), t.volume_green_min, t.volume_amber_min) AS volume_rag,
  COUNT(*) FILTER (WHERE w.quality_rag = 'Red')                                       AS weeks_with_quality_fail,
  CASE
    WHEN COUNT(w.id) = 0                                          THEN 'Sem dados'
    WHEN COUNT(*) FILTER (WHERE w.quality_rag = 'Red') > 0        THEN 'Red'
    WHEN COUNT(w.id) FILTER (WHERE w.quality_rag IS NOT NULL) = 0 THEN 'Sem dados'
    ELSE 'Green'
  END                                      AS quality_rag,
  AVG(w.leader_attendance_pct)             AS avg_leader_attendance_pct,
  AVG(w.team_attendance_pct)               AS avg_team_attendance_pct,
  SUM(w.leader_lateness_incidents)         AS total_leader_lateness,
  SUM(w.team_lateness_incidents)           AS total_team_lateness,
  SUM(w.hs_near_misses_reported)           AS total_near_misses,
  AVG(w.training_compliance_pct)           AS avg_training_compliance_pct,
  -- Rule 5 again, same gate, same order.
  CASE
    WHEN COUNT(*) FILTER (WHERE w.quality_rag = 'Red') > 0        THEN 'Red'
    WHEN COUNT(w.id) = 0                                          THEN NULL
    WHEN COUNT(w.id) FILTER (WHERE w.quality_rag IS NOT NULL) = 0 THEN NULL
    ELSE public.leader_volume_rag(AVG(w.volume_pct), t.volume_green_min, t.volume_amber_min)
  END                                      AS overall_rag
FROM grid g
CROSS JOIN public.leader_scorecard_thresholds t
LEFT JOIN public.v_leader_weekly_scorecard w
       ON w.line_leader_key = g.line_leader_key
      AND w.month_start     = g.month_start
GROUP BY g.line_leader, g.month_start, t.volume_green_min, t.volume_amber_min;

COMMENT ON VIEW public.v_leader_scorecard_monthly IS
  'Monthly rollup per leader. Built from a leader x month grid so that a leader with no week recorded in a month appears as "Sem dados" instead of silently vanishing or reading Green.';

-- =====================================================================
-- 6. Quarterly rollup — the same shape, over quarter_start
-- =====================================================================

CREATE OR REPLACE VIEW public.v_leader_scorecard_quarterly
WITH (security_invoker = true) AS
WITH leaders  AS (SELECT DISTINCT line_leader_key, line_leader FROM public.v_leader_weekly_scorecard),
     quarters AS (SELECT DISTINCT quarter_start FROM public.v_leader_weekly_scorecard),
     grid     AS (SELECT l.line_leader_key, l.line_leader, q.quarter_start
                    FROM leaders l CROSS JOIN quarters q)
SELECT
  g.line_leader,
  g.quarter_start,
  public.leader_quarter_label(g.quarter_start) AS quarter,
  COUNT(w.id)                          AS weeks_recorded,
  AVG(w.volume_pct)                    AS avg_volume_pct,
  public.leader_volume_rag(AVG(w.volume_pct), t.volume_green_min, t.volume_amber_min) AS volume_rag,
  COUNT(*) FILTER (WHERE w.quality_rag = 'Red')                                       AS weeks_with_quality_fail,
  CASE
    WHEN COUNT(w.id) = 0                                          THEN 'Sem dados'
    WHEN COUNT(*) FILTER (WHERE w.quality_rag = 'Red') > 0        THEN 'Red'
    WHEN COUNT(w.id) FILTER (WHERE w.quality_rag IS NOT NULL) = 0 THEN 'Sem dados'
    ELSE 'Green'
  END                                  AS quality_rag,
  AVG(w.leader_attendance_pct)         AS avg_leader_attendance_pct,
  AVG(w.team_attendance_pct)           AS avg_team_attendance_pct,
  SUM(w.leader_lateness_incidents)     AS total_leader_lateness,
  SUM(w.team_lateness_incidents)       AS total_team_lateness,
  SUM(w.hs_near_misses_reported)       AS total_near_misses,
  AVG(w.training_compliance_pct)       AS avg_training_compliance_pct,
  CASE
    WHEN COUNT(*) FILTER (WHERE w.quality_rag = 'Red') > 0        THEN 'Red'
    WHEN COUNT(w.id) = 0                                          THEN NULL
    WHEN COUNT(w.id) FILTER (WHERE w.quality_rag IS NOT NULL) = 0 THEN NULL
    ELSE public.leader_volume_rag(AVG(w.volume_pct), t.volume_green_min, t.volume_amber_min)
  END                                  AS overall_rag
FROM grid g
CROSS JOIN public.leader_scorecard_thresholds t
LEFT JOIN public.v_leader_weekly_scorecard w
       ON w.line_leader_key = g.line_leader_key
      AND w.quarter_start   = g.quarter_start
GROUP BY g.line_leader, g.quarter_start, t.volume_green_min, t.volume_amber_min;

COMMENT ON VIEW public.v_leader_scorecard_quarterly IS
  'Quarterly rollup per leader. Same grid as the monthly view, for the same reason.';

-- =====================================================================
-- 7. Per-leader view
-- =====================================================================

CREATE OR REPLACE VIEW public.v_leader_scorecard_by_leader
WITH (security_invoker = true) AS
SELECT
  w.line_leader                                 AS leader,
  COUNT(*)                                      AS weeks,
  AVG(w.volume_pct)                             AS avg_volume_pct,
  COUNT(*) FILTER (WHERE w.quality_rag = 'Red') AS quality_fails,
  COALESCE(SUM(w.team_lateness_incidents), 0)   AS team_lateness,
  CASE
    WHEN COUNT(*) FILTER (WHERE w.overall_rag = 'Red')   > 0 THEN 'Red'
    WHEN COUNT(*) FILTER (WHERE w.overall_rag = 'Amber') > 0 THEN 'Amber'
    WHEN COUNT(*) FILTER (WHERE w.overall_rag = 'Green') > 0 THEN 'Green'
    ELSE 'Sem dados'
  END                                           AS worst_rag
FROM public.v_leader_weekly_scorecard w
GROUP BY w.line_leader;

-- =====================================================================
-- 8. Summary block over a free period
--
-- Aggregates with no GROUP BY, so an empty period still returns exactly one row
-- reading zero weeks — rather than no row at all, which a caller would have to guess
-- the meaning of. pct_weeks_red is NULL, not 0%, when there is nothing to divide.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.leader_scorecard_summary(_from date, _to date)
RETURNS TABLE (
  weeks_recorded bigint, weeks_green bigint, weeks_amber bigint, weeks_red bigint,
  pct_weeks_red numeric, avg_volume_vs_plan numeric,
  weeks_with_quality_fail bigint, weeks_volume_below_97pct bigint,
  total_team_lateness bigint, total_near_misses bigint,
  rows_missing_attendance_data bigint, rows_missing_training_data bigint
) LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE w.overall_rag = 'Green'),
    COUNT(*) FILTER (WHERE w.overall_rag = 'Amber'),
    COUNT(*) FILTER (WHERE w.overall_rag = 'Red'),
    COUNT(*) FILTER (WHERE w.overall_rag = 'Red')::numeric / NULLIF(COUNT(*), 0),
    AVG(w.volume_pct),
    COUNT(*) FILTER (WHERE w.quality_rag = 'Red'),
    -- Named for the default band, read from the configuration, so editing the band
    -- moves this count with it.
    COUNT(*) FILTER (WHERE w.volume_pct < (SELECT th.volume_amber_min
                                             FROM public.leader_scorecard_thresholds th)),
    COALESCE(SUM(w.team_lateness_incidents), 0),
    COALESCE(SUM(w.hs_near_misses_reported), 0),
    COUNT(*) FILTER (WHERE w.missing_attendance_data),
    COUNT(*) FILTER (WHERE w.missing_training_data)
  FROM public.v_leader_weekly_scorecard w
  WHERE w.week_ending BETWEEN _from AND _to;
$$;

COMMENT ON FUNCTION public.leader_scorecard_summary(date, date) IS
  'Summary block of the weekly leader scorecard over a period. Always returns exactly one row; pct_weeks_red is NULL rather than 0 when no week was recorded.';

REVOKE ALL ON FUNCTION public.leader_scorecard_summary(date, date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leader_scorecard_summary(date, date) FROM anon;
GRANT EXECUTE ON FUNCTION public.leader_scorecard_summary(date, date) TO authenticated;

-- =====================================================================
-- 9. RLS
--
-- Everyone signed in reads: the card is discussed with the leader it is about.
-- Management writes. production_office_admin is included because this is operational
-- record-keeping, which is exactly the set that role covers.
-- No DELETE policy on the thresholds: the single row must survive.
-- =====================================================================

ALTER TABLE public.leader_weekly_scorecard     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leader_scorecard_thresholds ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed in reads weekly scorecard" ON public.leader_weekly_scorecard;
CREATE POLICY "Signed in reads weekly scorecard"
  ON public.leader_weekly_scorecard FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Management writes weekly scorecard" ON public.leader_weekly_scorecard;
CREATE POLICY "Management writes weekly scorecard"
  ON public.leader_weekly_scorecard FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
    OR public.has_role(auth.uid(),'quality_supervisor'::app_role)
    OR public.has_role(auth.uid(),'production_office_admin'::app_role))
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
    OR public.has_role(auth.uid(),'quality_supervisor'::app_role)
    OR public.has_role(auth.uid(),'production_office_admin'::app_role));

DROP POLICY IF EXISTS "Signed in reads scorecard thresholds" ON public.leader_scorecard_thresholds;
CREATE POLICY "Signed in reads scorecard thresholds"
  ON public.leader_scorecard_thresholds FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Management sets scorecard thresholds" ON public.leader_scorecard_thresholds;
CREATE POLICY "Management sets scorecard thresholds"
  ON public.leader_scorecard_thresholds FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
    OR public.has_role(auth.uid(),'quality_supervisor'::app_role))
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'manager'::app_role)
    OR public.has_role(auth.uid(),'quality_supervisor'::app_role));
