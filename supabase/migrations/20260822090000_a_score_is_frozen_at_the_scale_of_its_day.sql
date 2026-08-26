-- A score is frozen at the scale of its day.
--
-- The UI said it out loud: "Changing a weight re-scores past actions too". That was
-- written as a feature and it is an audit finding. Re-pricing a label in November
-- rewrote July: the leader ranking compared periods measured with different rulers,
-- a report printed in August stopped reproducing, and in a BRC audit there was no way
-- to show which criterion was in force on the date of the event.
--
-- HALF OF THIS ALREADY EXISTS, and it is not rebuilt here. 20260818090000 versioned
-- the three WEIGHTS into leader_scorecard_threshold by validity date, gave them a
-- trigger that closes the current version and opens a new one on every save, and
-- src/lib/leaderScoreWeights.ts resolves them at the period being reported on.
-- Editing the weights today already cannot re-score July.
--
-- Two rulers were left unversioned, and they are the ones that move a leader's number
-- most often: quality_severity_points (what a severity is worth) and
-- quality_options.points (what a label is worth). A third was not even on the list —
-- quality_label_attribution, which decides whether an action counts against the leader
-- at all. Marking a label "not the leader's" re-scores the whole history exactly the
-- same way a price does, so freezing points without freezing attribution would have
-- left the back door open and called the room secure.
--
-- WHAT IS DELIBERATELY *NOT* HERE. The specification asked for a scoring_version table
-- holding severity_points, label_prices, weights AND caps. The weights and caps are not
-- copied into it. They already live versioned in leader_scorecard_threshold, and
-- 20260818090000 states the reason in its own words: "Two tables of weights with the
-- same three names would drift, and the day they disagreed nobody would be able to say
-- which was the real one." So scoring_version is a TIME STAMP, not a second copy: it
-- carries the two rulers that had no home, and for weights and caps its valid_from
-- resolves against the table that already holds them. One foreign key on the action,
-- one answer to "which ruler was in force that day".
--
-- WHAT A RE-GRADE DOES, decided explicitly rather than left to fall out of the code.
-- If Quality corrects a misclassification in August on a July action — it was logged
-- Low and it was Critical — the frozen points DO move, and they are recomputed with
-- JULY's scale, not with today's. points_recalculated_at is stamped so the change is
-- visible. The scale stays frozen; what gets corrected is the fact, not the ruler. The
-- alternative was refusing to recompute at all, which would leave a card reading
-- "Critical" beside a score of 1 — the silent-mismatch failure this module keeps
-- having to close.
--
-- NOTHING BELOW MOVES A NUMBER ON A SCREEN. It writes the frozen figures and starts
-- keeping them current. No rollup, ranking or report reads points_at_creation yet;
-- that switch is a separate deploy, on purpose, so this one can sit in production and
-- be verified against the live figures before anything depends on it.


-- =====================================================================
-- 1. The version stamp
--
-- valid_to IS NULL means "in force". The partial unique index is what makes that
-- readable as a fact rather than a hope: two open versions at once and every lookup
-- below becomes a coin toss that nobody would notice until a report disagreed with
-- itself.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.scoring_version (
  id         bigserial PRIMARY KEY,
  valid_from date NOT NULL,
  valid_to   date,
  opened_by  uuid,
  note       text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT scoring_version_range CHECK (valid_to IS NULL OR valid_to >= valid_from)
);

CREATE UNIQUE INDEX IF NOT EXISTS scoring_version_one_in_force
  ON public.scoring_version ((valid_to IS NULL)) WHERE valid_to IS NULL;

COMMENT ON TABLE public.scoring_version IS
  'Uma regua de pontuacao com vigencia. Cada gravacao em Lists & scoring FECHA a versao vigente e ABRE uma nova; nenhuma linha e sobrescrita. Pesos e tetos NAO estao aqui — vivem versionados em leader_scorecard_threshold e resolvem-se pelo valid_from desta versao.';


-- =====================================================================
-- 2. The three rulers this version carries
--
-- Snapshots, not references. A reference would point at a row that the next save
-- overwrites, which is the whole defect: the point of a version is that it still says
-- in November what it said in July.
--
-- Labels are keyed lower(trim(value)) because that is exactly how the TypeScript keys
-- them (setLabelPoints / labelPoints in src/lib/qualityConstants.ts). Keying them any
-- other way would make the two implementations disagree on "GMP" versus "gmp", which
-- is the kind of difference that surfaces as one leader, once, and is never explained.
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.scoring_version_severity (
  version_id bigint  NOT NULL REFERENCES public.scoring_version(id) ON DELETE CASCADE,
  severity   text    NOT NULL,
  points     integer NOT NULL CHECK (points >= 0 AND points <= 1000),
  PRIMARY KEY (version_id, severity)
);

CREATE TABLE IF NOT EXISTS public.scoring_version_label (
  version_id bigint  NOT NULL REFERENCES public.scoring_version(id) ON DELETE CASCADE,
  label      text    NOT NULL,
  points     integer NOT NULL CHECK (points >= 0 AND points <= 1000),
  PRIMARY KEY (version_id, label)
);

-- Only the EXCLUDED labels are stored: `counts_against_leader = false`. Anything absent
-- counts, which is the rule quality_label_attribution itself runs on — "a new label has
-- to be excluded on purpose, so nothing silently stops counting". Storing the positives
-- too would invent a second way to express the same fact.
CREATE TABLE IF NOT EXISTS public.scoring_version_excluded_label (
  version_id bigint NOT NULL REFERENCES public.scoring_version(id) ON DELETE CASCADE,
  label      text   NOT NULL,
  PRIMARY KEY (version_id, label)
);

COMMENT ON TABLE public.scoring_version_excluded_label IS
  'As labels que NAO sao do lider nesta versao. A ausencia significa que conta — a mesma regra de quality_label_attribution. Congelada junto com os precos porque marcar uma label como "nao e do lider" re-pontuava a historia exactamente como um preco.';


-- =====================================================================
-- 3. The frozen figure on the action
--
-- NOT reusing quality_actions.points. That column exists, from 20260624175840, created
-- with DEFAULT 1 and read by nothing — src/lib/qualityActionPayload.ts calls it a dead
-- column and refuses to write it. Every old row therefore already holds a 1, and a
-- backfill into it could not tell "1 because I computed it" from "1 because that was
-- the default in June". A new column has no such ambiguity.
-- =====================================================================

ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS points_at_creation     integer,
  ADD COLUMN IF NOT EXISTS scoring_version_id     bigint REFERENCES public.scoring_version(id),
  ADD COLUMN IF NOT EXISTS points_recalculated_at timestamptz;

COMMENT ON COLUMN public.quality_actions.points_at_creation IS
  'Os pontos calculados com a regua vigente na data da accao. E ESTE o numero que os rollups, o ranking e os relatorios historicos devem ler. Recalcular com a escala nova e uma accao explicita, nunca o comportamento por omissao.';
COMMENT ON COLUMN public.quality_actions.points_recalculated_at IS
  'Carimbado quando a accao foi re-classificada (severidade, labels ou veredicto) e os pontos foram recalculados — sempre com a regua da PROPRIA versao da accao, nunca com a de hoje.';


-- =====================================================================
-- 4. The SQL twin of actionPoints()
--
-- src/lib/qualityConstants.ts:355 is the original and stays the original. This is the
-- same four rules against a dated snapshot instead of against the live tables, and the
-- order of the guards is part of the rule: safety before rejected before attribution
-- before price. A rejected safety row must return 0 for the FIRST reason, not the
-- second, or the explanation printed beside it would name the wrong one.
--
-- The risk this function carries is the honest one to state: it is a second
-- implementation of a rule that already had one, and if the two drift the backfill
-- freezes wrong numbers with nothing to compare them against. See
-- src/__tests__/scoringVersionParity.test.ts for what is and is not checked.
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

  IF _charge > 0 THEN RETURN _charge; END IF;

  RETURN coalesce(
    (SELECT points FROM public.scoring_version_severity
      WHERE version_id = _version_id AND severity = _severity), 0);
END $$;

COMMENT ON FUNCTION public.action_points_at(text, text, text[], text, bigint) IS
  'O gemeo SQL de actionPoints() em src/lib/qualityConstants.ts, contra uma versao datada. Mudar um, mudar o outro.';


-- =====================================================================
-- 5. Which version was in force on a date
-- =====================================================================

/**
 * Vigencia e DIARIA, e uma accao tem hora. As duas coisas nao encaixam sempre.
 *
 * Uma regua mudada as 14h fecha a versao anterior com valid_to = ontem e abre a nova
 * hoje. Uma accao registada as 09h da mesma manha ja tinha sido congelada contra a
 * versao antiga — cujo intervalo passa a terminar ontem. O ponteiro dessa accao aponta
 * portanto para uma versao que, lida pelas datas, ja nao cobre o dia dela.
 *
 * NAO e corrupcao, e vale a pena saber antes de alguem o encontrar e o tratar como tal:
 *   - os pontos congelados estao certos — foram calculados com a regua que estava
 *     mesmo em vigor no momento em que a accao foi registada;
 *   - scoring_version_id e a resposta AUTORIZADA a "sob que regua e que isto foi
 *     pontuado"; esta funcao e uma conveniencia para quem so tem uma data;
 *   - as duas so discordam para accoes registadas antes de uma mudanca de regua no
 *     MESMO dia, e discordam apenas sobre o ponteiro, nunca sobre o numero.
 *
 * Nao se resolve subindo a granularidade sem levar leader_scorecard_threshold junto,
 * que e diaria pela mesma razao desde 20260818090000 e cujo scorecard_version_weights()
 * faz exactamente este valid_to = _today - 1. Duas granularidades diferentes para a
 * mesma decisao de gestao seria pior do que esta aresta.
 */
CREATE OR REPLACE FUNCTION public.scoring_version_at(_on date)
RETURNS bigint
LANGUAGE sql STABLE SET search_path TO 'public' AS $$
  SELECT id FROM public.scoring_version
   WHERE valid_from <= _on AND (valid_to IS NULL OR valid_to >= _on)
   ORDER BY valid_from DESC LIMIT 1;
$$;


-- =====================================================================
-- 6. Opening a version, and what it captures
--
-- Modelled on scorecard_version_weights() from 20260818090000, including the rule that
-- earns its keep: a version that has not started being used yet is an EDIT of today's
-- decision, not a new one. Without it, three corrections to a typo on the same
-- afternoon would leave three versions, two of which nothing was ever scored under.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.scoring_version_snapshot(_version_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM public.scoring_version_severity       WHERE version_id = _version_id;
  DELETE FROM public.scoring_version_label          WHERE version_id = _version_id;
  DELETE FROM public.scoring_version_excluded_label WHERE version_id = _version_id;

  INSERT INTO public.scoring_version_severity (version_id, severity, points)
  SELECT _version_id, severity, points FROM public.quality_severity_points;

  INSERT INTO public.scoring_version_label (version_id, label, points)
  SELECT _version_id, lower(trim(value)), max(points)
    FROM public.quality_options WHERE kind = 'label' AND trim(coalesce(value, '')) <> ''
   GROUP BY lower(trim(value));

  -- Guarded: quality_label_attribution arrives in its own migration and the app already
  -- treats its absence as a state to report rather than an error (see attributionMissing
  -- in QualityActionsPage). An absent table means nothing is excluded, which is the same
  -- answer an empty table gives.
  IF to_regclass('public.quality_label_attribution') IS NOT NULL THEN
    EXECUTE '
      INSERT INTO public.scoring_version_excluded_label (version_id, label)
      SELECT $1, lower(trim(label)) FROM public.quality_label_attribution
       WHERE counts_against_leader = false AND btrim(coalesce(label, '''')) <> ''''
       GROUP BY lower(trim(label))'
    USING _version_id;
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.scoring_version_open(_note text DEFAULT 'Versao aberta pela edicao em Lists & scoring.')
RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _today date := current_date;
  _id    bigint;
BEGIN
  SELECT id INTO _id FROM public.scoring_version
   WHERE valid_to IS NULL AND valid_from >= _today;

  IF _id IS NULL THEN
    UPDATE public.scoring_version SET valid_to = _today - 1
     WHERE valid_to IS NULL AND valid_from < _today;

    INSERT INTO public.scoring_version (valid_from, opened_by, note)
    VALUES (_today, auth.uid(), _note)
    RETURNING id INTO _id;
  END IF;

  PERFORM public.scoring_version_snapshot(_id);
  RETURN _id;
END $$;


-- =====================================================================
-- 7. Backfill — version 1, and the frozen figure for every action already logged
--
-- v1 starts at the OLDEST action, not today. Starting it today would leave every action
-- ever logged outside all validity, so scoring_version_at() would return NULL for them
-- and the freeze would silently apply to nothing.
--
-- Non-destructive by construction: it only ever writes columns that are NULL, so
-- re-running this migration cannot overwrite a figure already frozen.
-- =====================================================================

INSERT INTO public.scoring_version (valid_from, note)
SELECT COALESCE(min(recorded_at)::date, current_date),
       'Versao 1: a escala em vigor no momento do congelamento, aplicada a todo o historico.'
  FROM public.quality_actions
 WHERE NOT EXISTS (SELECT 1 FROM public.scoring_version);

SELECT public.scoring_version_snapshot(id) FROM public.scoring_version WHERE valid_to IS NULL;

UPDATE public.quality_actions a
   SET scoring_version_id = public.scoring_version_at(a.recorded_at::date)
 WHERE a.scoring_version_id IS NULL;

-- `domain` arrives with 20260817090000, and this codebase does NOT assume it landed:
-- src/lib/writeOptionalDomain.ts exists precisely because the app has to survive a
-- database without it. A migration that names the column unconditionally would fail on
-- exactly the databases that file was written for, so the backfill asks first.
DO $backfill$
DECLARE
  _has_domain boolean := EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'quality_actions' AND column_name = 'domain');
BEGIN
  EXECUTE format($fmt$
    UPDATE public.quality_actions a
       SET points_at_creation = public.action_points_at(
             %s, a.severity, a.labels, a.validation_status, a.scoring_version_id)
     WHERE a.points_at_creation IS NULL AND a.scoring_version_id IS NOT NULL
  $fmt$, CASE WHEN _has_domain THEN 'a.domain::text' ELSE 'NULL::text' END);

  RAISE NOTICE 'points_at_creation preenchido em % accoes (domain presente: %).',
    (SELECT count(*) FROM public.quality_actions WHERE points_at_creation IS NOT NULL), _has_domain;
END $backfill$;


-- =====================================================================
-- 8. Keeping it current
--
-- Every save on a ruler opens a version. Every action carries the figure it was worth
-- under the version in force on its own date.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.scoring_version_on_ruler_change()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  PERFORM public.scoring_version_open();
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_scoring_version_severity ON public.quality_severity_points;
CREATE TRIGGER trg_scoring_version_severity
  AFTER UPDATE ON public.quality_severity_points
  FOR EACH ROW WHEN (OLD.points IS DISTINCT FROM NEW.points)
  EXECUTE FUNCTION public.scoring_version_on_ruler_change();

-- Only a change that can move a score opens a version. Adding a label at 0 points moves
-- nothing, and a version nobody was ever scored under is noise in the very history this
-- table exists to make readable.
DROP TRIGGER IF EXISTS trg_scoring_version_label_upd ON public.quality_options;
CREATE TRIGGER trg_scoring_version_label_upd
  AFTER UPDATE ON public.quality_options
  FOR EACH ROW WHEN (NEW.kind = 'label' AND OLD.points IS DISTINCT FROM NEW.points)
  EXECUTE FUNCTION public.scoring_version_on_ruler_change();

DROP TRIGGER IF EXISTS trg_scoring_version_label_ins ON public.quality_options;
CREATE TRIGGER trg_scoring_version_label_ins
  AFTER INSERT ON public.quality_options
  FOR EACH ROW WHEN (NEW.kind = 'label' AND NEW.points > 0)
  EXECUTE FUNCTION public.scoring_version_on_ruler_change();

DROP TRIGGER IF EXISTS trg_scoring_version_label_del ON public.quality_options;
CREATE TRIGGER trg_scoring_version_label_del
  AFTER DELETE ON public.quality_options
  FOR EACH ROW WHEN (OLD.kind = 'label' AND OLD.points > 0)
  EXECUTE FUNCTION public.scoring_version_on_ruler_change();

DO $$ BEGIN
  IF to_regclass('public.quality_label_attribution') IS NOT NULL THEN
    EXECUTE 'DROP TRIGGER IF EXISTS trg_scoring_version_attribution ON public.quality_label_attribution';
    EXECUTE 'CREATE TRIGGER trg_scoring_version_attribution
               AFTER INSERT OR UPDATE OR DELETE ON public.quality_label_attribution
               FOR EACH ROW EXECUTE FUNCTION public.scoring_version_on_ruler_change()';
  END IF;
END $$;

/**
 * The figure on the action itself.
 *
 * On INSERT: the version in force on the action's own recorded_at, not today's. An
 * action backdated to last month is worth what last month's ruler said.
 *
 * On re-grade: recomputed against the action's OWN scoring_version_id. This is the
 * decision written out at the top of this file — the fact gets corrected, the ruler
 * does not. Using current_date here instead would quietly re-open every door this
 * migration closes.
 */
CREATE OR REPLACE FUNCTION public.quality_action_freeze_points()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
DECLARE
  _v bigint;
BEGIN
  IF TG_OP = 'INSERT' THEN
    _v := public.scoring_version_at(coalesce(NEW.recorded_at, now())::date);
    NEW.scoring_version_id := _v;
    NEW.points_at_creation := public.action_points_at(
      to_jsonb(NEW)->>'domain', NEW.severity, NEW.labels, NEW.validation_status, _v);
    RETURN NEW;
  END IF;

  _v := coalesce(NEW.scoring_version_id,
                 public.scoring_version_at(coalesce(NEW.recorded_at, now())::date));
  NEW.scoring_version_id     := _v;
  NEW.points_at_creation     := public.action_points_at(
    to_jsonb(NEW)->>'domain', NEW.severity, NEW.labels, NEW.validation_status, _v);
  NEW.points_recalculated_at := now();
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS trg_quality_action_freeze_points_ins ON public.quality_actions;
CREATE TRIGGER trg_quality_action_freeze_points_ins
  BEFORE INSERT ON public.quality_actions
  FOR EACH ROW EXECUTE FUNCTION public.quality_action_freeze_points();

-- A trigger WHEN clause is parsed at CREATE time and cannot reach for to_jsonb, so the
-- domain condition is added only where the column exists.
DO $trg$
DECLARE
  _has_domain boolean := EXISTS (
    SELECT 1 FROM information_schema.columns
     WHERE table_schema = 'public' AND table_name = 'quality_actions' AND column_name = 'domain');
BEGIN
  EXECUTE 'DROP TRIGGER IF EXISTS trg_quality_action_freeze_points_upd ON public.quality_actions';
  EXECUTE format(
    'CREATE TRIGGER trg_quality_action_freeze_points_upd
       BEFORE UPDATE ON public.quality_actions
       FOR EACH ROW WHEN (OLD.severity          IS DISTINCT FROM NEW.severity
                       OR OLD.labels            IS DISTINCT FROM NEW.labels
                       OR OLD.validation_status IS DISTINCT FROM NEW.validation_status%s)
       EXECUTE FUNCTION public.quality_action_freeze_points()',
    CASE WHEN _has_domain THEN '
                       OR OLD.domain            IS DISTINCT FROM NEW.domain' ELSE '' END);
END $trg$;


-- =====================================================================
-- 9. RLS
--
-- Read for everyone signed in, the same reason quality_severity_points is readable by
-- everyone: the figures appear on the board, the log and the leader's own scorecard.
--
-- NO write policy on any of the three, deliberately. Nothing writes these tables except
-- the SECURITY DEFINER functions above. A version is opened by editing a ruler, never
-- by editing the version — which is what "never overwrites the previous one" means when
-- it is enforced instead of merely intended.
-- =====================================================================

ALTER TABLE public.scoring_version                ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scoring_version_severity       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scoring_version_label          ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scoring_version_excluded_label ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone signed in can read scoring versions" ON public.scoring_version;
CREATE POLICY "Anyone signed in can read scoring versions"
  ON public.scoring_version FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone signed in can read versioned severity points" ON public.scoring_version_severity;
CREATE POLICY "Anyone signed in can read versioned severity points"
  ON public.scoring_version_severity FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone signed in can read versioned label points" ON public.scoring_version_label;
CREATE POLICY "Anyone signed in can read versioned label points"
  ON public.scoring_version_label FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS "Anyone signed in can read versioned exclusions" ON public.scoring_version_excluded_label;
CREATE POLICY "Anyone signed in can read versioned exclusions"
  ON public.scoring_version_excluded_label FOR SELECT TO authenticated USING (true);
