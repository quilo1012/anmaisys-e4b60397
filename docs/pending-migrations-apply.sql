-- As migracoes que estao no repo e NAO estao na base, por ordem cronologica.
--
-- Verificado em 16/08/2026 por duas medicoes independentes: curl a partir do .env e,
-- do lado do browser, a chave anon tirada do bundle de producao. Os doze objectos do
-- modulo respondem 404 PGRST205 (tabela ausente), 404 PGRST202 (funcao ausente) ou
-- 400 42703 (coluna ausente). O 42703 vem do Postgres depois de analisar a query, por
-- isso exclui a hipotese de ser cache velha do PostgREST.
--
-- ORDEM: e a cronologica e importa. A de 19/08 substitui a funcao scorecard_week_board
-- criada pela de 16/08, e as de 18 e 19 dependem das tabelas criadas pela de 15/08.
--
-- NAO inclui 20260814090000 (v1 do scorecard): a v2 cria a tabela se ela nao existir.
--
-- AVISO: as duas ultimas (18/08 e 19/08) foram escritas noutra sessao e NAO foram
-- revistas por mim. Se preferir isolar o risco, cole um bloco de cada vez em vez do
-- ficheiro inteiro: assim uma falha para na fronteira e diz qual foi.
--
-- Depois de aplicar:
--   1. correr supabase/tests/leader_weekly_scorecard_test.sql (abre transacao, faz ROLLBACK)
--   2. confirmar com to_regclass('public.leader_weekly_scorecard') e
--      to_regproc('public.scorecard_week_board') -- nao ha cache nenhuma pelo meio
--   3. regenerar src/integrations/supabase/types.ts

-- ================================================================
-- 20260815120000_a_label_can_carry_its_own_points
-- ================================================================
-- What a label is worth, alongside what a severity is worth.
--
-- Severity grades a deviation in the abstract. A label says what actually happened,
-- and a foreign body is not a paperwork slip however either one was graded. Quality
-- can now price the label, and when a label carries a price it is the charge — the
-- severity steps aside. See `actionPoints()` in src/lib/qualityConstants.ts, which is
-- the only place that decides it.
--
-- Every row starts at 0, which means "this label does not price the action". So the
-- day this runs, nobody's score moves: an action with no priced label is worth its
-- severity, exactly as before. Pricing is opt-in, one label at a time.
--
-- Derived, never stored on the action — the same rule as quality_severity_points.
-- Re-pricing a label re-scores the history, and no action is left holding a stale
-- number. That is deliberate: a board that says "Foreign Body" while its score says
-- otherwise is worse than either.
ALTER TABLE public.quality_options
  ADD COLUMN IF NOT EXISTS points integer NOT NULL DEFAULT 0;

-- The same ceiling as a severity weight, for the same reason: a typo'd 50000 in one
-- box should not silently outrank the entire scoring model.
DO $$ BEGIN
  ALTER TABLE public.quality_options
    ADD CONSTRAINT quality_options_points_range CHECK (points >= 0 AND points <= 1000);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Departments are not labels and never price anything. Enforced rather than merely
-- hidden in the UI: the editor only shows the box on labels, but the rule belongs
-- where it cannot be bypassed by whoever writes the next screen.
DO $$ BEGIN
  ALTER TABLE public.quality_options
    ADD CONSTRAINT quality_options_only_labels_are_priced
    CHECK (kind = 'label' OR points = 0);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.quality_options.points IS
  'What this label charges an action, 0 = unpriced (the action keeps its severity weight). Labels only.';

-- ================================================================
-- 20260815140000_health_and_safety_is_the_second_gate
-- ================================================================
-- Health & Safety is the second gate.
--
-- v2 of the weekly Line Leader scorecard. v1
-- (20260814090000_the_week_is_red_when_the_check_is_missed.sql) held one gate:
-- food safety. This adds the second — a person hurt on the line — and with it the
-- production line as a dimension of its own, so the same week can be read by leader
-- and by line.
--
-- Four changes of shape, each of which the spreadsheet had already made:
--
--  1. The three check sheets stop being booleans. "Fail" and "Not Done" both make the
--     week Red, but they are not the same event: a Fail is a deviation of product and
--     demands a CAPA, a Not Done is a failure of discipline and demands a
--     conversation. v1's 'N' cannot tell them apart, so it migrates to 'Not Done' —
--     the safer of the two readings, because calling a missed check a failed test
--     would invent a product deviation that never happened. Whoever knows better
--     re-types the Fails by hand.
--  2. The People pillar becomes Health & Safety, and attendance leaves scoring
--     altogether. It is still collected and still shown; it just no longer moves a RAG.
--  3. Thresholds gain a validity period. v1 kept one editable row, so changing a band
--     silently rewrote every week ever recorded. A closed quarter must keep the bands
--     it was judged under.
--  4. The leader/line pair is versioned. A leader who moves line mid-quarter has to
--     roll up correctly on both sides of the move, which a single `line` column on the
--     leader cannot express.
--
-- Reuse, deliberately: the dimensions are public.lines and public.line_leaders, which
-- already exist and are already maintained. This module adds no parallel line table
-- and no parallel leader table. What it adds is the one thing neither of them has —
-- leader_line_assignment, the pairing with dates on it.
--
-- The gates live in exactly one CASE, in v_leader_weekly_scorecard. Every rollup, the
-- summary, the trend and the ranking read that view and restate no rule.

-- =====================================================================
-- 0. Extension needed for the no-overlap constraints
--
-- btree_gist is what lets a GiST exclusion constraint mix an equality column (uuid,
-- text) with a range. Without it neither the assignment nor the threshold table can
-- refuse an overlap in the database, and "versioned by date" becomes a convention
-- that the first careless UPDATE breaks.
-- =====================================================================

CREATE EXTENSION IF NOT EXISTS btree_gist WITH SCHEMA extensions;

-- =====================================================================
-- 1. Closed enums
--
-- Text with a CHECK would have done, but these three vocabularies are read by
-- application code and an enum is the version the generated types can see.
-- =====================================================================

DO $$ BEGIN
  CREATE TYPE public.scorecard_check_status AS ENUM ('Pass', 'Fail', 'Not Done');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.scorecard_downtime_reason AS ENUM (
    'Quebra', 'Falta de Materia Prima', 'Troca de Mix', 'Falta de Pessoal', 'Outro', 'NA');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.scorecard_capa_status AS ENUM (
    'Aberta', 'Em Andamento', 'Concluida', 'Verificada');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The H&S rule has to return the band AND every condition that produced it, in one
-- call, or the driver text would have to restate the rule to explain itself.
DO $$ BEGIN
  CREATE TYPE public.scorecard_hs_eval AS (rag text, drivers text[]);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- RAG stays text rather than an enum. The weekly bands are Red/Amber/Green, but every
-- rollup has a fourth outcome — 'Sem dados' — and an enum shared between the two would
-- let 'Sem dados' be written into a week, where it means nothing.

-- =====================================================================
-- 2. The versioned leader <-> line assignment
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.leader_line_assignment (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  leader_id  uuid NOT NULL REFERENCES public.line_leaders(id) ON DELETE RESTRICT,
  line_id    uuid NOT NULL REFERENCES public.lines(id)        ON DELETE RESTRICT,
  valid_from date NOT NULL,
  -- NULL means "still covering it". Not a far-future date: a sentinel would sort and
  -- compare as a real date and eventually be reported as one.
  valid_to   date,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CONSTRAINT leader_line_assignment_dates CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

DO $$ BEGIN
  ALTER TABLE public.leader_line_assignment
    ADD CONSTRAINT leader_line_assignment_no_overlap
    EXCLUDE USING gist (
      leader_id WITH =,
      line_id   WITH =,
      daterange(valid_from, valid_to, '[]') WITH &&);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS leader_line_assignment_leader_idx
  ON public.leader_line_assignment (leader_id, valid_from);
CREATE INDEX IF NOT EXISTS leader_line_assignment_line_idx
  ON public.leader_line_assignment (line_id, valid_from);

COMMENT ON TABLE public.leader_line_assignment IS
  'Which leader covered which line, between which dates. A leader may cover several lines at once, so the exclusion constraint forbids only the same PAIR overlapping itself. This is what makes a mid-quarter line change roll up correctly on both sides of the move; line_leaders.line holds only where somebody is today.';

-- =====================================================================
-- 3. Thresholds, versioned by validity
--
-- One row per threshold per period of validity. No band, count or minimum appears in
-- any query, view or function below: they are all read from here, as of the week being
-- judged, so re-banding the scorecard next quarter leaves last quarter judged under
-- the bands it was actually run under.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.leader_scorecard_threshold (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name       text NOT NULL CHECK (name ~ '^THR_[A-Za-z]+$'),
  value      numeric NOT NULL,
  pillar     text NOT NULL CHECK (pillar IN ('Volume', 'Health & Safety', 'Monitorado', 'Geral')),
  valid_from date NOT NULL,
  valid_to   date,
  note       text,
  created_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid DEFAULT auth.uid(),
  CONSTRAINT leader_scorecard_threshold_dates CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

DO $$ BEGIN
  ALTER TABLE public.leader_scorecard_threshold
    ADD CONSTRAINT leader_scorecard_threshold_no_overlap
    EXCLUDE USING gist (
      name WITH =,
      daterange(valid_from, valid_to, '[]') WITH &&);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS leader_scorecard_threshold_lookup_idx
  ON public.leader_scorecard_threshold (name, valid_from DESC);

COMMENT ON TABLE public.leader_scorecard_threshold IS
  'Every band, minimum and target of the leader scorecard, each with the period it applied to. Editing a threshold means closing the current row (valid_to) and inserting the next one — never UPDATEing the value, which would rewrite the judgement of every week already recorded.';

-- The seed. valid_from is deliberately early rather than today: the weeks already
-- typed in must resolve to a threshold, and these are the values they were judged
-- under in the spreadsheet.
INSERT INTO public.leader_scorecard_threshold (name, value, pillar, valid_from, note)
SELECT v.name, v.value, v.pillar, DATE '2000-01-01', v.note
FROM (VALUES
  ('THR_VolGreenMin',   1.000, 'Volume',          'Volume no plano ou acima: Green a partir daqui.'),
  ('THR_VolAmberMin',   0.970, 'Volume',          'Abaixo disto o volume e Red.'),
  ('THR_VolGreenMax',   1.050, 'Volume',          'Acima disto ha superproducao, que e desperdicio: Amber.'),
  ('THR_ProdMinutes', 2400.000, 'Volume',         'Minutos produtivos por semana, denominador do volume ajustado.'),
  ('THR_HSTrainRed',    0.900, 'Health & Safety', 'Compliance de formacao abaixo disto e Red.'),
  ('THR_HSTrainGreen',  1.000, 'Health & Safety', 'Abaixo de 100% e Amber.'),
  ('THR_NearMissMin',   1.000, 'Health & Safety', 'Minimo de near-misses REPORTADOS. Menos que isto sinaliza sub-reporte.'),
  ('THR_SafetyObsMin',  2.000, 'Health & Safety', 'Minimo de observacoes de seguranca por semana.'),
  ('THR_ToolboxMin',    1.000, 'Health & Safety', 'Minimo de toolbox talks por semana.'),
  ('THR_PPEMin',        1.000, 'Health & Safety', 'Compliance de EPI exigida.'),
  ('THR_AttendTarget',  0.995, 'Monitorado',      'Alvo de assiduidade. Monitorado, NAO pontua em nenhum RAG.'),
  ('THR_MinWeeks',      4.000, 'Geral',           'Minimo de semanas registadas para entrar em ranking.'),
  -- The one parameter not in the source specification. The alternative was a literal
  -- inside the trend view deciding when a slope counts as movement, and a literal in a
  -- query is the one thing this module refuses outright. Set it to 0 to make the
  -- direction read purely off the sign of the slope.
  ('THR_TrendEpsilon',  0.050, 'Geral',           'Inclinacao minima (por semana) para a tendencia deixar de ser "estavel".')
) AS v(name, value, pillar, note)
WHERE NOT EXISTS (
  SELECT 1 FROM public.leader_scorecard_threshold t WHERE t.name = v.name);

-- v1 kept three of these in a single editable row. If management had already moved
-- them there, that edit is the truth and the seed above is not: carry it over rather
-- than silently re-banding the history back to the defaults.
DO $$
DECLARE _g numeric; _a numeric; _t numeric;
BEGIN
  IF to_regclass('public.leader_scorecard_thresholds') IS NULL THEN RETURN; END IF;
  EXECUTE 'SELECT volume_green_min, volume_amber_min, attendance_min
             FROM public.leader_scorecard_thresholds LIMIT 1'
    INTO _g, _a, _t;
  UPDATE public.leader_scorecard_threshold SET value = _g WHERE name = 'THR_VolGreenMin'  AND _g IS NOT NULL;
  UPDATE public.leader_scorecard_threshold SET value = _a WHERE name = 'THR_VolAmberMin'  AND _a IS NOT NULL;
  UPDATE public.leader_scorecard_threshold SET value = _t WHERE name = 'THR_AttendTarget' AND _t IS NOT NULL;
END $$;

-- =====================================================================
-- 4. The v1 views come down before their columns move underneath them
-- =====================================================================

DROP VIEW IF EXISTS public.v_leader_scorecard_by_leader;
DROP VIEW IF EXISTS public.v_leader_scorecard_quarterly;
DROP VIEW IF EXISTS public.v_leader_scorecard_monthly;
DROP VIEW IF EXISTS public.v_leader_weekly_scorecard;
DROP FUNCTION IF EXISTS public.leader_scorecard_summary(date, date);

-- =====================================================================
-- 5. The weekly record grows a line, a second gate, and a CAPA
--
-- First, the table itself, if it is not there. v1 was written but a probe of the live
-- database found no leader_weekly_scorecard and no leader_scorecard_thresholds: the
-- migration exists in the repository and never reached the database. So this one has
-- to stand alone on a database that has never seen v1, without stopping working on one
-- that has.
--
-- The skeleton below is deliberately v1's shape, not v2's, so that everything after it
-- is a SINGLE code path: the same ALTERs, the same renames and the same backfill run
-- whether the table was created a second ago or a year ago. Two paths would be two
-- things to keep in agreement, and they would drift.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.leader_weekly_scorecard (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  line_leader     text NOT NULL CHECK (btrim(line_leader) <> ''),
  line_leader_key text GENERATED ALWAYS AS (lower(btrim(line_leader))) STORED,
  week_ending     date NOT NULL,
  -- date_trunc(text, timestamp) is IMMUTABLE, so these may be generated columns.
  -- to_char(..., 'Mon') may not: it reads lc_time. The "jul-2026" / "Q3-2026" labels
  -- are built on read, in the view.
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

-- The NOT NULL on line_leader is v1's, and v2 drops the column entirely a few
-- statements below. On a fresh database the table is empty, so nothing has to satisfy
-- it in between.

DROP TRIGGER IF EXISTS trg_leader_weekly_scorecard_updated_at ON public.leader_weekly_scorecard;
CREATE TRIGGER trg_leader_weekly_scorecard_updated_at
  BEFORE UPDATE ON public.leader_weekly_scorecard
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.leader_weekly_scorecard ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed in reads weekly scorecard" ON public.leader_weekly_scorecard;
CREATE POLICY "Signed in reads weekly scorecard"
  ON public.leader_weekly_scorecard FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Management writes weekly scorecard" ON public.leader_weekly_scorecard;
CREATE POLICY "Management writes weekly scorecard"
  ON public.leader_weekly_scorecard FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'quality_supervisor'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role))
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'quality_supervisor'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role));

ALTER TABLE public.leader_weekly_scorecard
  -- Identification
  ADD COLUMN IF NOT EXISTS leader_id uuid REFERENCES public.line_leaders(id) ON DELETE RESTRICT,
  -- Nullable on purpose. A week typed in before anybody knew which line it was is a
  -- week with a gap, and the driver text names that gap; refusing the row would just
  -- send the record back to the spreadsheet.
  ADD COLUMN IF NOT EXISTS line_id   uuid REFERENCES public.lines(id)        ON DELETE RESTRICT,

  -- Volume
  ADD COLUMN IF NOT EXISTS unplanned_downtime_minutes integer,
  ADD COLUMN IF NOT EXISTS downtime_reason public.scorecard_downtime_reason,

  -- Quality, tri-state
  ADD COLUMN IF NOT EXISTS ccp_check_status           public.scorecard_check_status,
  ADD COLUMN IF NOT EXISTS starter_check_status       public.scorecard_check_status,
  ADD COLUMN IF NOT EXISTS volume_weight_check_status public.scorecard_check_status,

  -- Health & Safety
  ADD COLUMN IF NOT EXISTS lost_time_injuries       integer,
  ADD COLUMN IF NOT EXISTS reportable_accidents     integer,
  ADD COLUMN IF NOT EXISTS first_aid_cases          integer,
  ADD COLUMN IF NOT EXISTS safety_observations_done integer,
  ADD COLUMN IF NOT EXISTS toolbox_talks_done       integer,
  ADD COLUMN IF NOT EXISTS ppe_compliance_pct       numeric(5,4),
  ADD COLUMN IF NOT EXISTS overdue_hs_actions       integer,

  -- CAPA
  ADD COLUMN IF NOT EXISTS capa_status               public.scorecard_capa_status,
  ADD COLUMN IF NOT EXISTS effectiveness_verified_by uuid,
  ADD COLUMN IF NOT EXISTS effectiveness_verified_on date,

  -- Audit trail. Nothing may be self-declared without a trace: BRC asks who said so.
  ADD COLUMN IF NOT EXISTS submitted_by uuid,
  ADD COLUMN IF NOT EXISTS submitted_at timestamptz,
  ADD COLUMN IF NOT EXISTS approved_by  uuid,
  ADD COLUMN IF NOT EXISTS approved_at  timestamptz;

-- Renames, guarded so the migration is re-runnable. training_compliance_pct changes
-- pillar as well as name — it is now H&S training, and it is the only H&S field that
-- can turn a week Red on its own.
DO $$ BEGIN
  ALTER TABLE public.leader_weekly_scorecard
    RENAME COLUMN training_compliance_pct TO hs_training_compliance_pct;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.leader_weekly_scorecard
    RENAME COLUMN hs_near_misses_reported TO near_misses_reported;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.leader_weekly_scorecard RENAME COLUMN owner TO capa_owner;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.leader_weekly_scorecard RENAME COLUMN due_date TO capa_due_date;
EXCEPTION WHEN undefined_column THEN NULL; END $$;

-- Y -> Pass, N -> Not Done. See the header: N cannot distinguish a failed test from a
-- test nobody ran, and inventing the failure would invent a product deviation.
UPDATE public.leader_weekly_scorecard SET
  ccp_check_status = CASE ccp_check_completed
    WHEN 'Y' THEN 'Pass'::public.scorecard_check_status
    WHEN 'N' THEN 'Not Done'::public.scorecard_check_status END,
  starter_check_status = CASE starter_check_completed
    WHEN 'Y' THEN 'Pass'::public.scorecard_check_status
    WHEN 'N' THEN 'Not Done'::public.scorecard_check_status END,
  volume_weight_check_status = CASE volume_weight_check_completed
    WHEN 'Y' THEN 'Pass'::public.scorecard_check_status
    WHEN 'N' THEN 'Not Done'::public.scorecard_check_status END
WHERE ccp_check_status IS NULL
  AND starter_check_status IS NULL
  AND volume_weight_check_status IS NULL;

-- The leader stops being loose text and becomes a row in the dimension that already
-- exists. Match on folded name — the same fold v1 used, and for the same reason:
-- leader_pins spells five of these people in capitals.
UPDATE public.leader_weekly_scorecard s
   SET leader_id = l.id
  FROM public.line_leaders l
 WHERE s.leader_id IS NULL
   AND lower(btrim(l.name)) = s.line_leader_key;

-- If a typed name matches nobody, a human decides whether it is a new leader or a
-- typo. Guessing here would either invent a leader or drop a week of record.
DO $$
DECLARE _orphans text;
BEGIN
  SELECT string_agg(DISTINCT line_leader, ', ')
    INTO _orphans
    FROM public.leader_weekly_scorecard WHERE leader_id IS NULL;
  IF _orphans IS NOT NULL THEN
    RAISE EXCEPTION
      'leader_weekly_scorecard tem semanas cujo lider nao existe em line_leaders: %. Crie-os (ou corrija a grafia) e volte a correr esta migracao.', _orphans;
  END IF;
END $$;

ALTER TABLE public.leader_weekly_scorecard
  ALTER COLUMN leader_id SET NOT NULL;

ALTER TABLE public.leader_weekly_scorecard
  DROP COLUMN IF EXISTS line_leader_key,
  DROP COLUMN IF EXISTS line_leader,
  DROP COLUMN IF EXISTS ccp_check_completed,
  DROP COLUMN IF EXISTS starter_check_completed,
  DROP COLUMN IF EXISTS volume_weight_check_completed;

-- Domain rules. Counters are counts, so they cannot be negative; percentages are
-- fractions, so they live in [0,1]. Neither says anything about NULL, which stays
-- legal everywhere and everywhere means "not recorded".
DO $$ BEGIN
  ALTER TABLE public.leader_weekly_scorecard ADD CONSTRAINT leader_weekly_scorecard_domains CHECK (
    (unplanned_downtime_minutes IS NULL OR unplanned_downtime_minutes >= 0)
    AND (lost_time_injuries       IS NULL OR lost_time_injuries       >= 0)
    AND (reportable_accidents     IS NULL OR reportable_accidents     >= 0)
    AND (first_aid_cases          IS NULL OR first_aid_cases          >= 0)
    AND (near_misses_reported     IS NULL OR near_misses_reported     >= 0)
    AND (safety_observations_done IS NULL OR safety_observations_done >= 0)
    AND (toolbox_talks_done       IS NULL OR toolbox_talks_done       >= 0)
    AND (overdue_hs_actions       IS NULL OR overdue_hs_actions       >= 0)
    AND (ppe_compliance_pct         IS NULL OR ppe_compliance_pct         BETWEEN 0 AND 1)
    AND (hs_training_compliance_pct IS NULL OR hs_training_compliance_pct BETWEEN 0 AND 1)
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- An approval is a signature and a moment. Half of one is not a trail.
DO $$ BEGIN
  ALTER TABLE public.leader_weekly_scorecard ADD CONSTRAINT leader_weekly_scorecard_approval_pair CHECK (
    (approved_by IS NULL) = (approved_at IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE public.leader_weekly_scorecard ADD CONSTRAINT leader_weekly_scorecard_verification_pair CHECK (
    (effectiveness_verified_by IS NULL) = (effectiveness_verified_on IS NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The grain is leader x line x week. NULLS NOT DISTINCT so that the line-less rows
-- still collide with each other: without it a leader could hold any number of
-- line-less weeks for the same week_ending, and every average would double-count.
DROP INDEX IF EXISTS public.leader_weekly_scorecard_leader_week_uk;
DROP INDEX IF EXISTS public.leader_weekly_scorecard_month_idx;
DROP INDEX IF EXISTS public.leader_weekly_scorecard_quarter_idx;

CREATE UNIQUE INDEX IF NOT EXISTS leader_weekly_scorecard_grain_uk
  ON public.leader_weekly_scorecard (leader_id, line_id, week_ending) NULLS NOT DISTINCT;

-- One index per rollup grouping (A, B, C).
CREATE INDEX IF NOT EXISTS leader_weekly_scorecard_leader_month_idx
  ON public.leader_weekly_scorecard (leader_id, month_start);
CREATE INDEX IF NOT EXISTS leader_weekly_scorecard_leader_quarter_idx
  ON public.leader_weekly_scorecard (leader_id, quarter_start);
CREATE INDEX IF NOT EXISTS leader_weekly_scorecard_line_month_idx
  ON public.leader_weekly_scorecard (line_id, month_start);
CREATE INDEX IF NOT EXISTS leader_weekly_scorecard_line_quarter_idx
  ON public.leader_weekly_scorecard (line_id, quarter_start);
CREATE INDEX IF NOT EXISTS leader_weekly_scorecard_leader_line_week_idx
  ON public.leader_weekly_scorecard (leader_id, line_id, week_ending DESC);

COMMENT ON COLUMN public.leader_weekly_scorecard.near_misses_reported IS
  'Quase-acidentes REPORTADOS. Logica invertida: reportar e o comportamento desejado e zero indica sub-reporte, nao uma linha segura. Nunca somar com first_aid_cases, que e consequencia e nao sinal antecedente.';
COMMENT ON COLUMN public.leader_weekly_scorecard.ccp_check_status IS
  'Pass / Fail / Not Done, ou NULL para nao registado. Fail e Not Done dao ambos Red, mas so o Fail exige CAPA.';
COMMENT ON COLUMN public.leader_weekly_scorecard.leader_attendance_pct IS
  'MONITORADO — nao pontua. Nao entra em nenhum RAG e nao pode ser diluido dentro de Health & Safety.';

-- =====================================================================
-- 6. The rules, one definition each
--
-- All of them IMMUTABLE and all of them taking their thresholds as arguments rather
-- than reading the table, so the same function judges a week and the average of a
-- quarter, under whichever bands that period was run with.
-- =====================================================================

-- Rule C. Bands in the spreadsheet's own order. Above the green ceiling is Amber, not
-- Green: making more than the plan is inventory nobody asked for.
CREATE OR REPLACE FUNCTION public.scorecard_volume_rag(
  _pct numeric, _amber_min numeric, _green_min numeric, _green_max numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _pct IS NULL      THEN NULL          -- no data is not a zero
    WHEN _pct <  _amber_min THEN 'Red'
    WHEN _pct <  _green_min THEN 'Amber'
    WHEN _pct <= _green_max THEN 'Green'
    ELSE                         'Amber'      -- superproducao
  END;
$$;

-- Rule C, the adjusted figure. Informative only: it never feeds a RAG. It exists so
-- the root-cause conversation can separate "the line under-ran" from "the line stood
-- still for two hours waiting for material", without that excuse reaching the number
-- the leader is measured on.
CREATE OR REPLACE FUNCTION public.scorecard_volume_pct_adjusted(
  _actual numeric, _planned numeric, _downtime numeric, _prod_minutes numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _actual IS NULL OR _planned IS NULL OR _planned = 0 THEN NULL
    WHEN _downtime IS NULL THEN _actual / _planned
    ELSE _actual / NULLIF(
      _planned * (1 - LEAST(_downtime / NULLIF(_prod_minutes, 0), 0.9)), 0)
  END;
$$;

-- Rule D. A check nobody recorded is not a check that passed — in a BRC-HACCP context
-- that reading is the whole failure mode. So: NULL only when all three are blank; a
-- partially filled row is Red, and its fail type is 'Not Done'.
CREATE OR REPLACE FUNCTION public.scorecard_quality_rag(_checks public.scorecard_check_status[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN cardinality(array_remove(_checks, NULL::public.scorecard_check_status)) = 0 THEN NULL
    WHEN 'Fail'::public.scorecard_check_status     = ANY (array_remove(_checks, NULL::public.scorecard_check_status)) THEN 'Red'
    WHEN 'Not Done'::public.scorecard_check_status = ANY (array_remove(_checks, NULL::public.scorecard_check_status)) THEN 'Red'
    WHEN cardinality(array_remove(_checks, NULL::public.scorecard_check_status)) = 3 THEN 'Green'
    ELSE 'Red'
  END;
$$;

-- Rule D again, the half BRC actually audits on. Same Red, different obligation.
CREATE OR REPLACE FUNCTION public.scorecard_quality_fail_type(_checks public.scorecard_check_status[])
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN public.scorecard_quality_rag(_checks) IS DISTINCT FROM 'Red' THEN NULL
    WHEN 'Fail'::public.scorecard_check_status = ANY (array_remove(_checks, NULL::public.scorecard_check_status)) THEN 'Fail'
    ELSE 'Not Done'
  END;
$$;

-- 0.984 -> "98,4". Carried over from v1, renamed into this module's prefix. Declared
-- before the H&S rule, which calls it.
CREATE OR REPLACE FUNCTION public.scorecard_pct_label(_pct numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT replace(to_char(round(_pct * 100, 1), 'FM990.0'), '.', ',');
$$;

-- Rule E. Returns the band AND every condition that fired, because the driver text
-- has to name all of them and must not re-derive them to do it.
--
-- Two NULL conventions, and they are not the same:
--   * all nine fields blank  -> NULL. Nothing was collected; the week is not safe and
--     it is not unsafe, it is unknown. Never Green.
--   * some fields blank      -> the blanks are gaps, and a gap in a week that DID get
--     collected is Amber. Except the two Red conditions, which demand a real number:
--     a blank training figure must not be able to turn a week Red on its own.
CREATE OR REPLACE FUNCTION public.scorecard_hs_evaluate(
  _lti integer, _reportable integer, _first_aid integer,
  _near_misses integer, _safety_obs integer, _toolbox integer,
  _ppe numeric, _training numeric, _overdue integer,
  _train_red numeric, _train_green numeric, _near_min numeric,
  _obs_min numeric, _toolbox_min numeric, _ppe_min numeric)
RETURNS public.scorecard_hs_eval LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  _red   text[] := ARRAY[]::text[];
  _amber text[] := ARRAY[]::text[];
BEGIN
  IF _lti IS NULL AND _reportable IS NULL AND _first_aid IS NULL
     AND _near_misses IS NULL AND _safety_obs IS NULL AND _toolbox IS NULL
     AND _ppe IS NULL AND _training IS NULL AND _overdue IS NULL THEN
    RETURN ROW(NULL, NULL)::public.scorecard_hs_eval;
  END IF;

  IF COALESCE(_lti, 0) > 0 THEN
    _red := _red || format('%s acidente(s) com afastamento', _lti);
  END IF;
  IF COALESCE(_reportable, 0) > 0 THEN
    _red := _red || format('%s acidente(s) reportavel(eis)', _reportable);
  END IF;
  IF _training IS NOT NULL AND _training < _train_red THEN
    _red := _red || format('formacao de H&S em %s%% (abaixo do minimo)',
                           public.scorecard_pct_label(_training));
  END IF;

  IF COALESCE(_overdue, 0) > 0 THEN
    _amber := _amber || format('%s acao(oes) vencida(s)', _overdue);
  END IF;
  -- The inverted one. Zero reported near-misses is under-reporting, never a clean
  -- week, so it belongs here and not among the things that make a week look good.
  IF COALESCE(_near_misses, 0) < _near_min THEN
    _amber := _amber || 'near-miss abaixo do minimo (possivel sub-reporte)';
  END IF;
  IF COALESCE(_safety_obs, 0) < _obs_min THEN
    _amber := _amber || 'observacoes de seguranca abaixo do minimo';
  END IF;
  IF COALESCE(_toolbox, 0) < _toolbox_min THEN
    _amber := _amber || 'toolbox talks abaixo do minimo';
  END IF;
  IF _ppe IS NULL THEN
    _amber := _amber || 'compliance de EPI nao informada';
  ELSIF _ppe < _ppe_min THEN
    _amber := _amber || format('EPI em %s%%', public.scorecard_pct_label(_ppe));
  END IF;
  IF _training IS NULL THEN
    _amber := _amber || 'formacao de H&S nao informada';
  ELSIF _training < _train_green AND _training >= _train_red THEN
    _amber := _amber || format('formacao de H&S em %s%%', public.scorecard_pct_label(_training));
  END IF;

  -- Worst wins, and every condition is carried either way.
  RETURN ROW(
    CASE WHEN cardinality(_red) > 0 THEN 'Red'
         WHEN cardinality(_amber) > 0 THEN 'Amber'
         ELSE 'Green' END,
    _red || _amber
  )::public.scorecard_hs_eval;
END $$;

-- "jul-2026" / "Q3-2026". Month names fixed in an array rather than to_char('Mon'),
-- which reads lc_time and would render the label in whatever language the session
-- happens to be in — and, being STABLE, could not be indexed or generated either.
CREATE OR REPLACE FUNCTION public.scorecard_month_label(_d date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _d IS NULL THEN NULL ELSE
    (ARRAY['jan','fev','mar','abr','mai','jun',
           'jul','ago','set','out','nov','dez'])[EXTRACT(MONTH FROM _d)::int]
    || '-' || EXTRACT(YEAR FROM _d)::text END;
$$;

CREATE OR REPLACE FUNCTION public.scorecard_quarter_label(_d date)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _d IS NULL THEN NULL ELSE
    'Q' || EXTRACT(QUARTER FROM _d)::text || '-' || EXTRACT(YEAR FROM _d)::text END;
$$;

-- Rule G, the two gates, as one function so that the week and every rollup enter the
-- gate through the same door.
--
-- DEVIATION, deliberate, and the one place this module does not follow the written
-- specification to the letter. The spec lists "NULL if volume_rag or quality_rag is
-- null" as the first rule, which would let a week with a lost-time injury read NULL
-- merely because nobody typed the plan. A gate that a missing figure can open is not
-- a gate. So Red and Amber are decided first, and NULL is what is left when no gate
-- fired and volume or quality has nothing to say. To restore the literal reading,
-- move the two NULL lines back to the top of this CASE — nothing else changes.
CREATE OR REPLACE FUNCTION public.scorecard_overall_rag(
  _volume_rag text, _quality_rag text, _hs_rag text)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _quality_rag = 'Red'   THEN 'Red'     -- gate 1: food safety
    WHEN _hs_rag      = 'Red'   THEN 'Red'     -- gate 2: people
    WHEN _hs_rag      = 'Amber' THEN 'Amber'
    WHEN _volume_rag IS NULL OR _quality_rag IS NULL THEN NULL
    ELSE _volume_rag                            -- H&S NULL does not block; volume rules
  END;
$$;

-- =====================================================================
-- 7. The base view — the single place C to H are computed
--
-- A view, not generated columns and not a trigger. Generated columns must be
-- IMMUTABLE and cannot read another table, so every band would have to be a literal
-- inside the column definition and re-banding would mean rewriting the table. A
-- trigger would freeze each week's RAG at the moment it was typed, leaving history
-- disagreeing with the rule that produced it until somebody remembered to backfill.
-- A view computes on read: one definition, no backfill, and because the thresholds are
-- resolved as of week_ending, a closed quarter keeps the bands it was judged under.
-- =====================================================================

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
  s.created_at, s.updated_at

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
    max(th.value) FILTER (WHERE th.name = 'THR_AttendTarget') AS attend_target
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
) h;

COMMENT ON VIEW public.v_leader_weekly_scorecard IS
  'O scorecard semanal calculado, ao nivel lider x linha x semana. Definicao unica de volume_pct, volume_pct_adjusted, volume_rag, quality_rag, quality_fail_type, hs_rag, hs_driver, overall_rag e rag_driver: os rollups, o resumo, a tendencia e o ranking leem esta view e nao repetem nenhuma regra.';

-- ---------------------------------------------------------------------
-- EXTENSION POINT — deliberately not implemented.
-- Assiduidade e atrasos (leader_attendance_pct, team_attendance_pct e os dois
-- contadores de atraso) sao recolhidos, exibidos e agregados, e NAO pontuam. Se um dia
-- voltarem a pontuar, tem de se tornar um pilar proprio, com peso explicito e com o
-- seu proprio *_rag ao lado dos outros quatro. NAO os diluir dentro de Health &
-- Safety: um atraso nao e um acidente, e misturar os dois torna impossivel ler
-- qualquer um deles. As duas primeiras linhas de scorecard_overall_rag sao gates
-- absolutos e nada pode ser colocado acima delas.
-- ---------------------------------------------------------------------

-- =====================================================================
-- 8. The period spine
--
-- This is what makes guard 1 possible. A GROUP BY over the weekly view can only ever
-- produce groups that HAVE weeks, so the case the spreadsheet got wrong — a leader
-- with nothing recorded in a month reading Green because a COUNTIFS of failures
-- returned zero — cannot even be expressed as a row. The rollups below are therefore
-- driven by leader x line x period taken from the ASSIGNMENT, LEFT JOINed to the
-- weeks; a group with no weeks still produces a row, and that row says 'Sem dados'.
-- =====================================================================

CREATE OR REPLACE VIEW public.v_scorecard_period_spine
WITH (security_invoker = true) AS
WITH bounds AS (
  SELECT min(week_ending) AS from_date, max(week_ending) AS to_date
    FROM public.leader_weekly_scorecard
),
months AS (
  SELECT gs::date AS period_start, 'mensal'::text AS period_type
    FROM bounds b,
         generate_series(date_trunc('month', b.from_date::timestamp),
                         date_trunc('month', b.to_date::timestamp), interval '1 month') gs
  WHERE b.from_date IS NOT NULL
),
quarters AS (
  SELECT gs::date AS period_start, 'trimestral'::text AS period_type
    FROM bounds b,
         generate_series(date_trunc('quarter', b.from_date::timestamp),
                         date_trunc('quarter', b.to_date::timestamp), interval '3 months') gs
  WHERE b.from_date IS NOT NULL
),
periods AS (
  SELECT period_type, period_start,
         (period_start + CASE WHEN period_type = 'mensal' THEN interval '1 month'
                              ELSE interval '3 months' END - interval '1 day')::date AS period_end
    FROM (SELECT * FROM months UNION ALL SELECT * FROM quarters) u
)
SELECT
  p.period_type,
  p.period_start,
  p.period_end,
  CASE WHEN p.period_type = 'mensal' THEN public.scorecard_month_label(p.period_start)
       ELSE public.scorecard_quarter_label(p.period_start) END AS period_label,
  a.leader_id,
  a.line_id
FROM periods p
JOIN public.leader_line_assignment a
  -- The assignment counts for the period if it was live for any part of it, which is
  -- exactly the mid-quarter line change: the leader appears under both lines, each
  -- with the weeks that actually fell on it.
  ON daterange(a.valid_from, a.valid_to, '[]') && daterange(p.period_start, p.period_end, '[]');

COMMENT ON VIEW public.v_scorecard_period_spine IS
  'Lider x linha x periodo (mensal e trimestral), a partir da atribuicao versionada. E a espinha dos rollups: existe para que um grupo SEM semanas registadas continue a produzir uma linha, que dira "Sem dados" em vez de desaparecer ou de aparecer Green.';

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
-- 9. Rollup C — leader x line x period
--
-- Written first because A and B are the same aggregate over a coarser spine. The two
-- guards live here, and both of them exist because a count of failures returns zero
-- when it finds nothing, and zero failures is not the same as nothing to fail.
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
    / nullif(count(*) FILTER (WHERE w.capa_status IS NOT NULL), 0) AS capa_closure_rate

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
-- 10. Rollup A — leader x period.  Rollup B — line x period.
--
-- Same aggregate, coarser spine. They are NOT sums of rollup C: a leader on two lines
-- has to average his weeks once, not average two averages, which would weight a line
-- with one week the same as a line with ten.
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
    / nullif(count(*) FILTER (WHERE w.capa_status IS NOT NULL), 0) AS capa_closure_rate
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
    / nullif(count(*) FILTER (WHERE w.capa_status IS NOT NULL), 0) AS capa_closure_rate
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
-- 11. Trend
--
-- A snapshot answers "is it bad?" and cannot answer "is it getting worse?". Four-week
-- moving averages, and a direction read off the slope of the last eight weeks.
-- =====================================================================

CREATE OR REPLACE VIEW public.v_scorecard_trend_leader
WITH (security_invoker = true) AS
WITH weekly AS (
  -- A leader covering two lines has two rows in a week; collapse to one first, or the
  -- moving average would count that week twice.
  SELECT
    leader_id,
    week_ending,
    avg(volume_pct)          AS volume_pct,
    sum(near_misses_reported) AS near_misses,
    avg(CASE overall_rag WHEN 'Green' THEN 2 WHEN 'Amber' THEN 1 WHEN 'Red' THEN 0 END) AS overall_num
  FROM public.v_leader_weekly_scorecard
  GROUP BY leader_id, week_ending
),
numbered AS (
  SELECT w.*, row_number() OVER (PARTITION BY leader_id ORDER BY week_ending) AS wk
  FROM weekly w
)
SELECT
  n.leader_id,
  ll.name AS leader_name,
  n.week_ending,
  n.volume_pct,
  n.near_misses,
  n.overall_num,
  avg(n.volume_pct)  OVER w4 AS volume_pct_ma4,
  avg(n.near_misses) OVER w4 AS near_misses_ma4,
  avg(n.overall_num) OVER w4 AS overall_ma4,
  regr_slope(n.overall_num, n.wk) OVER w8 AS overall_slope8,
  CASE
    -- A single point is not a trend; regr_slope returns NULL there, and so does this.
    WHEN regr_slope(n.overall_num, n.wk) OVER w8 IS NULL THEN NULL
    WHEN regr_slope(n.overall_num, n.wk) OVER w8 >  e.eps THEN 'melhorando'
    WHEN regr_slope(n.overall_num, n.wk) OVER w8 < -e.eps THEN 'piorando'
    ELSE 'estavel'
  END AS direction
FROM numbered n
LEFT JOIN public.line_leaders ll ON ll.id = n.leader_id
CROSS JOIN LATERAL (
  SELECT max(th.value) FILTER (WHERE th.name = 'THR_TrendEpsilon') AS eps
  FROM public.leader_scorecard_threshold th
  WHERE n.week_ending >= th.valid_from AND (th.valid_to IS NULL OR n.week_ending <= th.valid_to)
) e
WINDOW
  w4 AS (PARTITION BY n.leader_id ORDER BY n.week_ending ROWS BETWEEN 3 PRECEDING AND CURRENT ROW),
  w8 AS (PARTITION BY n.leader_id ORDER BY n.week_ending ROWS BETWEEN 7 PRECEDING AND CURRENT ROW);

CREATE OR REPLACE VIEW public.v_scorecard_trend_line
WITH (security_invoker = true) AS
WITH weekly AS (
  SELECT
    line_id,
    week_ending,
    avg(volume_pct)           AS volume_pct,
    sum(near_misses_reported) AS near_misses,
    avg(CASE overall_rag WHEN 'Green' THEN 2 WHEN 'Amber' THEN 1 WHEN 'Red' THEN 0 END) AS overall_num
  FROM public.v_leader_weekly_scorecard
  WHERE line_id IS NOT NULL
  GROUP BY line_id, week_ending
),
numbered AS (
  SELECT w.*, row_number() OVER (PARTITION BY line_id ORDER BY week_ending) AS wk FROM weekly w
)
SELECT
  n.line_id,
  ln.name AS line_name,
  n.week_ending,
  n.volume_pct,
  n.near_misses,
  n.overall_num,
  avg(n.volume_pct)  OVER w4 AS volume_pct_ma4,
  avg(n.near_misses) OVER w4 AS near_misses_ma4,
  avg(n.overall_num) OVER w4 AS overall_ma4,
  regr_slope(n.overall_num, n.wk) OVER w8 AS overall_slope8,
  CASE
    WHEN regr_slope(n.overall_num, n.wk) OVER w8 IS NULL THEN NULL
    WHEN regr_slope(n.overall_num, n.wk) OVER w8 >  e.eps THEN 'melhorando'
    WHEN regr_slope(n.overall_num, n.wk) OVER w8 < -e.eps THEN 'piorando'
    ELSE 'estavel'
  END AS direction
FROM numbered n
LEFT JOIN public.lines ln ON ln.id = n.line_id
CROSS JOIN LATERAL (
  SELECT max(th.value) FILTER (WHERE th.name = 'THR_TrendEpsilon') AS eps
  FROM public.leader_scorecard_threshold th
  WHERE n.week_ending >= th.valid_from AND (th.valid_to IS NULL OR n.week_ending <= th.valid_to)
) e
WINDOW
  w4 AS (PARTITION BY n.line_id ORDER BY n.week_ending ROWS BETWEEN 3 PRECEDING AND CURRENT ROW),
  w8 AS (PARTITION BY n.line_id ORDER BY n.week_ending ROWS BETWEEN 7 PRECEDING AND CURRENT ROW);

-- =====================================================================
-- 12. Ranking
--
-- Ordered by the share of Red weeks, tied on failures and then on injuries. Groups
-- under THR_MinWeeks weeks are excluded rather than ranked low: three good weeks is
-- not evidence of anything, and a ranking that says otherwise will be believed.
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

-- =====================================================================
-- 13. Executive summary
--
-- One function, optionally narrowed to a leader or a line, so "by dimension" is a
-- filter rather than three more copies of the same arithmetic. Aggregates with no
-- GROUP BY, so an empty period returns exactly one row reading zero weeks instead of
-- no row at all — which the caller would have to guess the meaning of. Every rate is
-- NULL rather than 0 when there is nothing to divide.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.leader_scorecard_summary(
  _from date, _to date, _leader_id uuid DEFAULT NULL, _line_id uuid DEFAULT NULL)
RETURNS TABLE (
  weeks_recorded bigint, weeks_green bigint, weeks_amber bigint, weeks_red bigint,
  pct_weeks_red numeric,
  avg_volume_vs_plan numeric, weeks_volume_below_min bigint, weeks_overproduction bigint,
  total_unplanned_downtime bigint,
  weeks_quality_red bigint, weeks_with_fail bigint, weeks_with_not_done bigint,
  weeks_hs_red bigint, weeks_hs_amber bigint,
  total_lti bigint, total_reportable bigint, total_near_misses bigint,
  near_misses_per_week numeric, total_overdue_hs_actions bigint,
  rows_missing_line bigint, rows_missing_hs_data bigint, open_capas bigint,
  weeks_with_fail_without_capa bigint, rows_pending_approval bigint
) LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT
    count(*),
    count(*) FILTER (WHERE w.overall_rag = 'Green'),
    count(*) FILTER (WHERE w.overall_rag = 'Amber'),
    count(*) FILTER (WHERE w.overall_rag = 'Red'),
    count(*) FILTER (WHERE w.overall_rag = 'Red')::numeric / nullif(count(*), 0),
    avg(w.volume_pct),
    -- Named off the configured band, so re-banding moves this count with it.
    count(*) FILTER (WHERE w.volume_pct < (
      SELECT max(th.value) FROM public.leader_scorecard_threshold th
       WHERE th.name = 'THR_VolAmberMin'
         AND w.week_ending >= th.valid_from
         AND (th.valid_to IS NULL OR w.week_ending <= th.valid_to))),
    count(*) FILTER (WHERE w.volume_pct > (
      SELECT max(th.value) FROM public.leader_scorecard_threshold th
       WHERE th.name = 'THR_VolGreenMax'
         AND w.week_ending >= th.valid_from
         AND (th.valid_to IS NULL OR w.week_ending <= th.valid_to))),
    coalesce(sum(w.unplanned_downtime_minutes), 0),
    count(*) FILTER (WHERE w.quality_rag = 'Red'),
    count(*) FILTER (WHERE w.quality_fail_type = 'Fail'),
    count(*) FILTER (WHERE w.quality_fail_type = 'Not Done'),
    count(*) FILTER (WHERE w.hs_rag = 'Red'),
    count(*) FILTER (WHERE w.hs_rag = 'Amber'),
    coalesce(sum(w.lost_time_injuries), 0),
    coalesce(sum(w.reportable_accidents), 0),
    coalesce(sum(w.near_misses_reported), 0),
    sum(w.near_misses_reported)::numeric / nullif(count(*), 0),
    coalesce(sum(w.overdue_hs_actions), 0),
    count(*) FILTER (WHERE w.line_id IS NULL),
    count(*) FILTER (WHERE w.missing_hs_data),
    count(*) FILTER (WHERE w.capa_status IN ('Aberta', 'Em Andamento')),
    -- The row an auditor opens first: a product deviation with no corrective action
    -- attached to it.
    count(*) FILTER (WHERE w.quality_fail_type = 'Fail'
                       AND (w.root_cause IS NULL OR w.corrective_action IS NULL
                            OR w.capa_owner IS NULL OR w.capa_due_date IS NULL)),
    count(*) FILTER (WHERE w.pending_approval)
  FROM public.v_leader_weekly_scorecard w
  WHERE w.week_ending BETWEEN _from AND _to
    AND (_leader_id IS NULL OR w.leader_id = _leader_id)
    AND (_line_id   IS NULL OR w.line_id   = _line_id);
$$;

COMMENT ON FUNCTION public.leader_scorecard_summary(date, date, uuid, uuid) IS
  'Resumo executivo sobre um periodo, opcionalmente filtrado por lider ou por linha. Devolve sempre exatamente uma linha; pct_weeks_red e near_misses_per_week vem NULL, e nao 0, quando nao ha semanas.';

REVOKE ALL ON FUNCTION public.leader_scorecard_summary(date, date, uuid, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leader_scorecard_summary(date, date, uuid, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.leader_scorecard_summary(date, date, uuid, uuid) TO authenticated;

-- =====================================================================
-- 14. The CAPA gate, in the database
--
-- A UI validation is a suggestion: the next screen, the next import script and the
-- SQL editor all bypass it. A week carrying a product deviation cannot be signed off
-- without a cause, an action, an owner and a date, so the rule lives where nothing
-- can go around it.
--
-- It fires on approval, not on typing. Somebody has to be able to record the failure
-- on the day it happens and fill the investigation in afterwards; what they cannot do
-- is call it approved before that.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.scorecard_require_capa_before_approval()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE _fail_type text;
BEGIN
  IF NEW.approved_at IS NULL THEN
    RETURN NEW;
  END IF;

  _fail_type := public.scorecard_quality_fail_type(
    ARRAY[NEW.ccp_check_status, NEW.starter_check_status, NEW.volume_weight_check_status]);

  IF _fail_type = 'Fail'
     AND (nullif(btrim(coalesce(NEW.root_cause, '')), '')        IS NULL
       OR nullif(btrim(coalesce(NEW.corrective_action, '')), '') IS NULL
       OR nullif(btrim(coalesce(NEW.capa_owner, '')), '')        IS NULL
       OR NEW.capa_due_date IS NULL) THEN
    RAISE EXCEPTION
      'Semana com check reprovado (Fail) nao pode ser aprovada sem CAPA: root_cause, corrective_action, capa_owner e capa_due_date sao obrigatorios.'
      USING ERRCODE = 'check_violation';
  END IF;

  -- An approval names somebody. An unsigned approval is not a trail.
  IF NEW.approved_by IS NULL THEN
    RAISE EXCEPTION 'Aprovacao exige approved_by.' USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_scorecard_require_capa ON public.leader_weekly_scorecard;
CREATE TRIGGER trg_scorecard_require_capa
  BEFORE INSERT OR UPDATE ON public.leader_weekly_scorecard
  FOR EACH ROW EXECUTE FUNCTION public.scorecard_require_capa_before_approval();

-- =====================================================================
-- 15. RLS
--
-- Same shape as v1: everyone signed in reads, because the card is discussed with the
-- leader it is about; management writes. The threshold table gains no DELETE policy —
-- deleting a row would not reset a band, it would leave the weeks in that period with
-- no band at all.
-- =====================================================================

ALTER TABLE public.leader_line_assignment      ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.leader_scorecard_threshold  ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Signed in reads leader line assignment" ON public.leader_line_assignment;
CREATE POLICY "Signed in reads leader line assignment"
  ON public.leader_line_assignment FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Management writes leader line assignment" ON public.leader_line_assignment;
CREATE POLICY "Management writes leader line assignment"
  ON public.leader_line_assignment FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role))
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role));

DROP POLICY IF EXISTS "Signed in reads scorecard threshold" ON public.leader_scorecard_threshold;
CREATE POLICY "Signed in reads scorecard threshold"
  ON public.leader_scorecard_threshold FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Management sets scorecard threshold" ON public.leader_scorecard_threshold;
CREATE POLICY "Management sets scorecard threshold"
  ON public.leader_scorecard_threshold FOR INSERT TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'quality_supervisor'::app_role));

DROP POLICY IF EXISTS "Management closes scorecard threshold" ON public.leader_scorecard_threshold;
CREATE POLICY "Management closes scorecard threshold"
  ON public.leader_scorecard_threshold FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'quality_supervisor'::app_role))
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'quality_supervisor'::app_role));

-- v1's single-row threshold table has been read into the versioned one above and is
-- no longer referenced by anything.
DROP TABLE IF EXISTS public.leader_scorecard_thresholds;

-- ================================================================
-- 20260816090000_the_screen_asks_the_database
-- ================================================================
-- The screen asks the database.
--
-- Two functions and one column, so that the write screen can show what it must without
-- deciding anything. scorecard_week_board answers "who is expected this week, and where
-- did each of them get to" — the question a GROUP BY over the weeks cannot answer,
-- because a leader who recorded nothing has no row to group. scorecard_derived_volume
-- answers "what does production already say about this line this week", so the same
-- number is not typed twice into two modules that will then disagree.
--
-- COLUMN-NAME CORRECTION from the brief: the brief assumed rag_weekly_entries carries
-- line_id (uuid) and that a separate `downtime` table (line_id, occurred_on, minutes)
-- holds the unplanned-downtime figure. Neither is true of the live schema:
--   * rag_weekly_entries has no line_id at all — it keys production by `line` (free
--     text), matched to public.lines.name elsewhere in this codebase with a
--     case/spacing-insensitive compare (see rag_actual_from_floor, migration
--     20260730100000). scorecard_derived_volume follows that same precedent rather
--     than an exact-text join, because the two spellings are known to still drift for
--     at least one line (see the note at the end of migration
--     20260801080000_one_name_for_the_tablet_line.sql).
--   * public.downtime is a real, unrelated table (line TEXT, started_at/ended_at,
--     no line_id, no minutes, no occurred_on) — a leftover of an earlier module, not
--     the source for this figure.
--   * The unplanned-downtime minutes for a line/week are not in a separate table at
--     all: rag_weekly_entries already carries them, per entry, as `downtime_min`
--     (added in migration 20260627071614). So scorecard_derived_volume needs only one
--     table, not a join to a second one — and every output column below has a real
--     source, so nothing here returns a NULL for a column that could have been
--     computed.

DO $$ BEGIN
  CREATE TYPE public.scorecard_volume_source AS ENUM ('derivado', 'manual');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.leader_weekly_scorecard
  ADD COLUMN IF NOT EXISTS volume_source public.scorecard_volume_source;

COMMENT ON COLUMN public.leader_weekly_scorecard.volume_source IS
  'De onde veio o volume: derivado da producao ou escrito a mao. NULL enquanto nao houver volume. Existe para que uma correccao manual seja visivel na auditoria em vez de silenciosa.';

-- O estado de uma semana, com a ordem que importa: aprovada vence submetida, submetida
-- vence rascunho, e a ausencia de registo e um estado seu, nao um nulo.
CREATE OR REPLACE FUNCTION public.scorecard_week_board(_week_ending date)
RETURNS TABLE (
  leader_id uuid, leader_name text, line_id uuid, line_name text,
  entry_id uuid, state text,
  volume_rag text, quality_rag text, hs_rag text, overall_rag text,
  rag_driver text, capa_required boolean
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
    w.rag_driver, w.capa_required
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

-- O volume que a producao ja registou para aquela linha naquela semana. Duas equipas na
-- mesma linha recebem o MESMO valor: repartir exigiria saber que fraccao da semana coube
-- a cada uma, coisa que ninguem regista, e inventa-la seria pior do que mostrar o total
-- com a origem a vista.
--
-- rag_weekly_entries nao tem line_id: a linha e associada por nome (public.lines.name),
-- com a mesma comparacao tolerante a maiusculas/espacos que rag_actual_from_floor ja usa
-- em producao (migracao 20260730100000). As grafias conhecidas ja foram unificadas
-- (20260801080000 e 20260801100000), mas nada impede outra grafia nova de aparecer entre
-- as duas tabelas amanha; a comparacao tolerante custa nada e evita que essa proxima
-- divergencia volte a partir esta soma silenciosamente. downtime_min ja vive em
-- rag_weekly_entries por registo — nao existe (nem e preciso) juntar a tabela
-- public.downtime, que e outra coisa.
CREATE OR REPLACE FUNCTION public.scorecard_derived_volume(_line_id uuid, _week_ending date)
RETURNS TABLE (
  planned_volume integer, actual_volume integer,
  unplanned_downtime_minutes integer, source_label text
) LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  -- No NULLIF here. sum() already gives us the one true absence: no rows joined at
  -- all, because a line with nothing recorded that week has nothing to sum. A real
  -- recorded zero — a line that genuinely produced nothing, or genuinely lost no
  -- unplanned minutes — is a FACT and must read as 0, not be folded back into
  -- "unrecorded". Turning it into NULL would be this function inventing the very
  -- blank-vs-zero confusion the rest of this module exists to refuse.
  SELECT
    sum(e.plan_qty)::integer,
    sum(e.actual_qty)::integer,
    sum(e.downtime_min)::integer,
    'RAG Weekly'
  FROM public.rag_weekly_entries e
  JOIN public.lines ln ON ln.id = _line_id
   AND LOWER(REPLACE(BTRIM(ln.name), ' ', '')) = LOWER(REPLACE(BTRIM(e.line), ' ', ''))
  WHERE e.entry_date BETWEEN _week_ending - 6 AND _week_ending;
$$;

REVOKE ALL ON FUNCTION public.scorecard_week_board(date) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.scorecard_derived_volume(uuid, date) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.scorecard_week_board(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scorecard_derived_volume(uuid, date) TO authenticated;

-- ================================================================
-- 20260817090000_safety_shares_the_log_but_not_the_score
-- ================================================================
-- Safety shares the log, but not the score.
--
-- A safety occurrence has the same life as a quality one — recorded, owned, validated,
-- closed, with attachments — so it gets the same table rather than a parallel one that
-- would duplicate the validation and closure machinery and then rot beside it.
--
-- What must NOT be shared is the arithmetic. The quality module charges points to a
-- leader: more actions recorded, worse. Safety runs the other way — reporting a near
-- miss is the behaviour we want, and zero reported means under-reporting rather than a
-- safe line. Wire the two into one score and logging a near miss would penalise the
-- leader who logged it, which teaches the whole team not to log them. So the score is
-- switched off for this domain, in exactly one place: `actionPoints()` in
-- src/lib/qualityConstants.ts.

DO $$ BEGIN
  CREATE TYPE public.action_domain AS ENUM ('quality', 'safety');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  CREATE TYPE public.safety_kind AS ENUM (
    'lost_time_injury', 'reportable_accident', 'first_aid', 'near_miss',
    'safety_observation', 'toolbox_talk', 'ppe_breach');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS domain public.action_domain NOT NULL DEFAULT 'quality',
  ADD COLUMN IF NOT EXISTS safety_kind public.safety_kind;

-- Both contradictions are refused: a safety row nobody classified, and a quality row
-- carrying a safety type. Either one would reach the weekly counts as a silent wrong
-- answer rather than an error.
DO $$ BEGIN
  ALTER TABLE public.quality_actions
    ADD CONSTRAINT quality_actions_safety_kind_matches_domain
    CHECK ((domain = 'safety') = (safety_kind IS NOT NULL));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS quality_actions_domain_idx
  ON public.quality_actions (domain, recorded_at DESC);
-- The weekly counts group by leader, line and week within one domain.
CREATE INDEX IF NOT EXISTS quality_actions_safety_counts_idx
  ON public.quality_actions (domain, leader_id, line, recorded_at)
  WHERE domain = 'safety';

COMMENT ON COLUMN public.quality_actions.domain IS
  'Quality or safety. Every row that existed before this column is quality, which is what the default says. Safety rows are counted, never scored: see actionPoints() in src/lib/qualityConstants.ts.';
COMMENT ON COLUMN public.quality_actions.safety_kind IS
  'What kind of safety occurrence. first_aid and near_miss are DIFFERENT THINGS and must never be summed: the first is a consequence, the second is a leading signal, and a near miss reported is a good outcome.';

-- ================================================================
-- 20260818090000_a_gate_is_a_ceiling_not_a_weight
-- ================================================================
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
  ('THR_OverProdBand',    0.05, 'Score', 'Largura da banda de superproducao, acima do teto verde. A penalidade por banda e THR_OverProdPenalty.'),
  -- The sibling of THR_QualFailPenalty, and a parameter for the same reason: how many
  -- points over-production costs is a management judgement, not arithmetic. Written as
  -- a literal it would also have been a number recorded twice — once in the formula and
  -- once in the note beside THR_OverProdBand — with nothing keeping the two equal.
  ('THR_OverProdPenalty',50.00, 'Score', 'Pontos perdidos por cada banda de superproducao acima do teto verde.'),
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
--
-- The numbers are READ from the W_* rows seeded above rather than written out again.
-- Restating 40/35/25 here would be the same three numbers in two places inside one
-- file, free to drift the first time somebody edits one list and not the other — which
-- is precisely the drift this whole section exists to prevent between the two tables.
--
-- leader_score_weights holds integers, so a fractional weight cannot be represented
-- there at all: rather than round it and quietly break that table's own sum-100 CHECK,
-- the re-base simply does not happen and the editing surface keeps what it had.
UPDATE public.leader_score_weights w
   SET production_pct    = s.p,
       quality_pct       = s.q,
       documentation_pct = s.d,
       updated_at        = now()
  FROM (
    SELECT max(value) FILTER (WHERE name = 'W_Production')    AS p,
           max(value) FILTER (WHERE name = 'W_Quality')       AS q,
           max(value) FILTER (WHERE name = 'W_Documentation') AS d
      FROM public.leader_scorecard_threshold
     WHERE name IN ('W_Production', 'W_Quality', 'W_Documentation')
       AND valid_to IS NULL
  ) s
 WHERE w.id = true
   AND s.p IS NOT NULL AND s.q IS NOT NULL AND s.d IS NOT NULL
   AND s.p = round(s.p) AND s.q = round(s.q) AND s.d = round(s.d)
   AND (w.production_pct, w.quality_pct, w.documentation_pct)
       IS DISTINCT FROM (s.p, s.q, s.d);

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
--
-- "Every date where the weights change" is three sets of dates, not one, and the first
-- version of this trigger only had the first of them:
--   * every valid_from — where a version OPENS;
--   * every valid_to + 1 — where a version CLOSES. Without this, closing the three open
--     rows and opening no successors leaves the only probed date back at the start of
--     validity, where the now-closed rows still cover and still sum to 100, while every
--     week after the closing date resolves no weights at all and scores NULL;
--   * current_date — so that a table with no W_* rows in it is caught. A DELETE of all
--     three leaves the probe set empty, and a query that returns no rows answers "no
--     violation found", which is the opposite of the truth.
-- The last case is also raised on its own, because "the weights do not exist" is a
-- different sentence to read at 3am than "the weights do not add up on a date".
-- =====================================================================

CREATE OR REPLACE FUNCTION public.scorecard_weights_total_100()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
DECLARE _bad record;
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM public.leader_scorecard_threshold
     WHERE name IN ('W_Production', 'W_Quality', 'W_Documentation')) THEN
    RAISE EXCEPTION
      'Os pesos Production, Quality e Documentation nao existem em leader_scorecard_threshold. Sem eles o score de todas as semanas fica nulo.'
      USING ERRCODE = 'check_violation';
  END IF;

  SELECT d.on_date, w.total INTO _bad
  FROM (
    SELECT DISTINCT u.on_date FROM (
      SELECT valid_from AS on_date
        FROM public.leader_scorecard_threshold
       WHERE name IN ('W_Production', 'W_Quality', 'W_Documentation')
      UNION ALL
      SELECT valid_to + 1
        FROM public.leader_scorecard_threshold
       WHERE name IN ('W_Production', 'W_Quality', 'W_Documentation')
         AND valid_to IS NOT NULL
      UNION ALL
      SELECT current_date
    ) u
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
--
-- _over_penalty is the points lost per band of over-production, and it is an argument
-- for the same reason _fail_penalty is: it is a management judgement about what
-- over-production costs, and this module keeps no such number inside a formula. The
-- other two 50s below are NOT thresholds — they are the midpoint of a 0-100 scale and
-- the shape of a linear interpolation between two bands — and they stay written out.
CREATE OR REPLACE FUNCTION public.scorecard_prod_score(
  _pct numeric, _amber_min numeric, _green_min numeric, _green_max numeric,
  _over_band numeric, _over_penalty numeric, _vol_zero numeric)
RETURNS numeric LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE
    WHEN _pct IS NULL THEN NULL                        -- no data is not a zero
    WHEN _pct > _green_max THEN
      GREATEST(0, 100 - ((_pct - _green_max) / NULLIF(_over_band, 0)) * _over_penalty)
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

-- 49.00 -> "49", 79.50 -> "79,5". The ceilings are read out of a numeric column, so
-- they arrive carrying whatever scale they were stored with, and "Teto 49,00" reads
-- like a price.
--
-- No to_char here. Its D pattern is the decimal separator of lc_numeric, which would
-- render this label differently per session inside a function declared IMMUTABLE — the
-- same trap 20260815140000 documents for to_char(..., 'Mon') and lc_time. numeric::text
-- always writes a '.' whatever the locale, so the separator is chosen here, once, the
-- way scorecard_pct_label chooses it.
CREATE OR REPLACE FUNCTION public.scorecard_score_label(_n numeric)
RETURNS text LANGUAGE sql IMMUTABLE AS $$
  SELECT CASE WHEN _n IS NULL THEN NULL
              ELSE replace(trim_scale(_n)::text, '.', ',') END;
$$;

CREATE OR REPLACE FUNCTION public.scorecard_score_evaluate(
  _volume_pct numeric,
  _checks public.scorecard_check_status[],
  _lti integer, _reportable integer, _hs_rag text,
  _w_prod numeric, _w_qual numeric, _w_doc numeric,
  _amber_min numeric, _green_min numeric, _green_max numeric,
  _over_band numeric, _over_penalty numeric, _vol_zero numeric, _fail_penalty numeric,
  _cap_gate numeric, _cap_not_done numeric, _cap_hs_amber numeric)
RETURNS public.scorecard_score_eval LANGUAGE plpgsql IMMUTABLE AS $$
DECLARE
  _missing text[] := ARRAY[]::text[];
  _prod  numeric;
  _qual  numeric;
  _doc   numeric;
  _fail_type text;
  _bruto numeric;
  _final numeric;
  _why   text;
BEGIN
  -- The parameters are checked BEFORE anything is computed, and a missing one raises
  -- instead of scoring.
  --
  -- LEAST ignores NULL arguments, so a ceiling that failed to resolve does not cap: a
  -- week with a failed CCP would print its full weighted sum, with cap_reason NULL and
  -- no badge beside it, and nothing on the screen would say the gate had gone missing.
  -- Silently failing OPEN is the worst outcome this module has, worse than a screen
  -- that errors, because a screen that errors gets fixed. The mirror case is as bad in
  -- the other direction: a NULL weight makes _bruto NULL while LEAST(NULL, 49) still
  -- returns 49, so the row would carry a final score beside no gross score at all.
  -- Everywhere else this module cannot answer, it says so; here it says so too.
  IF _w_prod       IS NULL THEN _missing := _missing || 'W_Production'; END IF;
  IF _w_qual       IS NULL THEN _missing := _missing || 'W_Quality'; END IF;
  IF _w_doc        IS NULL THEN _missing := _missing || 'W_Documentation'; END IF;
  IF _cap_gate     IS NULL THEN _missing := _missing || 'CAP_Gate'; END IF;
  IF _cap_not_done IS NULL THEN _missing := _missing || 'CAP_NotDone'; END IF;
  IF _cap_hs_amber IS NULL THEN _missing := _missing || 'CAP_HSAmber'; END IF;
  IF _amber_min    IS NULL THEN _missing := _missing || 'THR_VolAmberMin'; END IF;
  IF _green_min    IS NULL THEN _missing := _missing || 'THR_VolGreenMin'; END IF;
  IF _green_max    IS NULL THEN _missing := _missing || 'THR_VolGreenMax'; END IF;
  IF _over_band    IS NULL THEN _missing := _missing || 'THR_OverProdBand'; END IF;
  IF _over_penalty IS NULL THEN _missing := _missing || 'THR_OverProdPenalty'; END IF;
  IF _vol_zero     IS NULL THEN _missing := _missing || 'THR_VolZero'; END IF;
  IF _fail_penalty IS NULL THEN _missing := _missing || 'THR_QualFailPenalty'; END IF;

  IF cardinality(_missing) > 0 THEN
    RAISE EXCEPTION
      'Parametro(s) do score sem versao vigente para esta semana: %. O score nao pode ser calculado sem eles, e um teto que nao resolve nao limita nada.',
      array_to_string(_missing, ', ')
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  _prod := public.scorecard_prod_score(
    _volume_pct, _amber_min, _green_min, _green_max, _over_band, _over_penalty, _vol_zero);
  _qual := public.scorecard_qual_score(_checks, _fail_penalty);
  _doc  := public.scorecard_doc_score(_checks);
  _fail_type := public.scorecard_quality_fail_type(_checks);

  IF _prod IS NULL OR _qual IS NULL OR _doc IS NULL THEN
    -- Not zero, and not capped either: there is nothing here to put a ceiling on.
    RETURN ROW(_prod, _qual, _doc, NULL, NULL, NULL)::public.scorecard_score_eval;
  END IF;

  _bruto := (_prod * _w_prod + _qual * _w_qual + _doc * _w_doc) / 100;

  -- DEVIATION from the written specification, deliberate. The spec lists only a 'Fail'
  -- check, an LTI and a reportable accident under the hardest ceiling. But
  -- scorecard_hs_evaluate returns 'Red' on a third condition too — H&S training below
  -- THR_HSTrainRed — and that condition reached none of the branches below: it fell
  -- through to the uncapped ELSE. The arithmetic of that was the rule standing on its
  -- head. A week with H&S Amber was capped at CAP_HSAmber, while the SAME week with
  -- training bad enough to be Red kept its full weighted sum, so the worse safety band
  -- scored higher and the board printed 100 beside a red H&S chip. Any H&S Red now
  -- takes CAP_Gate: a gate that a Red condition walks through untouched is not a gate,
  -- and that is the one sentence this whole module exists to keep true.
  IF _fail_type = 'Fail' OR coalesce(_lti, 0) > 0 OR coalesce(_reportable, 0) > 0
     OR _hs_rag = 'Red' THEN
    _final := LEAST(_bruto, _cap_gate);
    _why := 'Teto ' || public.scorecard_score_label(_cap_gate) || ': ' || concat_ws('; ',
      CASE WHEN _fail_type = 'Fail'            THEN 'check reprovado (Fail)' END,
      CASE WHEN coalesce(_lti, 0) > 0          THEN 'acidente com afastamento' END,
      CASE WHEN coalesce(_reportable, 0) > 0   THEN 'acidente reportavel' END,
      CASE WHEN _hs_rag = 'Red'                THEN 'Health & Safety em Red' END) || '.';
  ELSIF _fail_type = 'Not Done' THEN
    _final := LEAST(_bruto, _cap_not_done);
    _why := 'Teto ' || public.scorecard_score_label(_cap_not_done) || ': check nao realizado.';
  ELSIF _hs_rag = 'Amber' THEN
    _final := LEAST(_bruto, _cap_hs_amber);
    _why := 'Teto ' || public.scorecard_score_label(_cap_hs_amber) || ': Health & Safety em Amber.';
  ELSE
    _final := _bruto;
    _why := NULL;
  END IF;

  RETURN ROW(_prod, _qual, _doc, _bruto, _final, _why)::public.scorecard_score_eval;
END $$;

-- Fully qualified by argument list on purpose: while this migration is being re-run on
-- a database that already holds the previous signature, the bare name is ambiguous.
COMMENT ON FUNCTION public.scorecard_score_evaluate(
  numeric, public.scorecard_check_status[], integer, integer, text,
  numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric, numeric) IS
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
  -- score. It is here to rank and to trend, and the leader reads rag_driver to find out
  -- what to do. A single number cannot do both jobs: 82 does not name a missed check.
  --
  -- As shipped, nothing reads score_final yet except the rollups' avg_score_final: the
  -- two ranking views still order by pct_weeks_red and the trend views still read the
  -- RAG. Ranking on the score is the intended next step, not the current state, and it
  -- is a decision of its own — ranking by score would rank on a number the ceilings
  -- flatten, so several capped weeks would tie where the RAG still tells them apart.
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
    max(th.value) FILTER (WHERE th.name = 'THR_OverProdPenalty') AS over_prod_penalty,
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
    t.over_prod_band, t.over_prod_penalty, t.vol_zero, t.qual_fail_penalty,
    t.cap_gate, t.cap_not_done, t.cap_hs_amber) AS sc;

COMMENT ON VIEW public.v_leader_weekly_scorecard IS
  'O scorecard semanal calculado, ao nivel lider x linha x semana. Definicao unica de volume_pct, volume_pct_adjusted, volume_rag, quality_rag, quality_fail_type, hs_rag, hs_driver, overall_rag e rag_driver: os rollups, o resumo, a tendencia e o ranking leem esta view e nao repetem nenhuma regra.';

-- Adding an argument to a function does not replace it, it creates a second one beside
-- it. On a database that ran an earlier version of THIS migration, the previous
-- signatures would survive as callable dead code with the over-production penalty
-- hard-coded inside them — two versions of one rule, and no way to tell from a call
-- site which was reached. They are dropped only here, after the view above has been
-- rebuilt onto the new signature and no longer depends on the old one.
DROP FUNCTION IF EXISTS public.scorecard_score_evaluate(
  numeric, public.scorecard_check_status[], integer, integer, text,
  numeric, numeric, numeric, numeric, numeric, numeric,
  numeric, numeric, numeric, numeric, numeric, numeric);
DROP FUNCTION IF EXISTS public.scorecard_prod_score(
  numeric, numeric, numeric, numeric, numeric, numeric);


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
