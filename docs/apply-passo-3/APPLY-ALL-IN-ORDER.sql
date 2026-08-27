-- PASSO 3 — as onze migracoes que o docs/apply/ nao carrega
--
-- O docs/apply/ termina no bloco 08, 20260820090000. Onze migracoes aterraram desde
-- entao e nenhuma delas tinha um ficheiro para colar. A segunda cria
-- public.scoring_version, que e a tabela que o ecra passa a vida a dizer que nao
-- encontra:
--
--     Something did not load
--     Could not find the table 'public.scoring_version' in the schema cache
--
-- Isso nao e cache velha do PostgREST nem um erro de nome. A tabela nao existe.
-- Medido a 19/08/2026 com docs/apply/probe-schema.sh, que so le, contra
-- ybtrzqzliepknpzqdajx:
--
--     quality_actions                       200        <- controlo, existe
--     zzz_tabela_que_nao_existe             404        <- controlo, nao existe
--     scoring_version                       404 PGRST205
--     scoring_version_severity              404 PGRST205
--     scoring_version_label                 404 PGRST205
--     scoring_version_excluded_label        404 PGRST205
--     scoring_version_excluded_department   404 PGRST205
--     quality_actions.points_at_creation    400 42703
--     quality_actions.scoring_version_id    400 42703
--     quality_options.is_gate               400 42703
--
-- O 42703 vem do Postgres depois de analisar a query, por isso exclui de vez a
-- hipotese de ser cache.
--
-- A ORDEM E CRONOLOGICA E IMPORTA. 20260822090000 cria as tabelas que 20260822093000
-- le, e 20260827093000 acrescenta uma coluna a uma tabela que 20260822090000 cria.
-- Fora de ordem, a colagem falha a meio.
--
-- PODE SER COLADO MAIS DO QUE UMA VEZ, ao contrario do APPLY-ALL-IN-ORDER.sql do
-- docs/apply/. Nao e sorte, foi verificado ficheiro a ficheiro: as unicas escritas de
-- topo sao o seed de scoring_version, guardado por WHERE NOT EXISTS, o backfill, que
-- so escreve colunas a NULL, e o insert em quality_options, com ON CONFLICT DO
-- NOTHING. Tudo o resto e CREATE ... IF NOT EXISTS, CREATE OR REPLACE, ou um bloco DO
-- que verifica antes de mexer. Os DELETE que aparecem no grep estao dentro do corpo de
-- scoring_version_snapshot e correm quando essa funcao e chamada, nao ao colar.
--
-- COMO CORRER — este projecto e Lovable Cloud. More -> Cloud -> SQL editor, ou colar
-- no chat do editor com a instrucao explicita de aplicar verbatim e nao aplicar mais
-- nada. Nao ha CLI que chegue a esta base: ela vive na organizacao do Lovable.
--
-- DEPOIS DE CORRER, verificar em vez de acreditar:
--
--     bash docs/apply/probe-schema.sh
--
-- Tudo o que esta 404/400 acima tem de passar a 200. Se ficar a meio, parar e olhar.
-- Ver docs/migrations-in-repo-are-not-proof-of-production: um ficheiro neste
-- repositorio e um recibo do que se pretendeu, nunca uma prova do que a base tem.
--
-- Este ficheiro e reconstruido byte a byte a partir de supabase/migrations/ e o
-- src/__tests__/theApplyPackageStopsWhereTheErrorStarts.test.ts falha se uma migracao
-- nova ficar de fora. Foi assim que este pacote ficou dez atras sem ninguem reparar.


-- ================================================================
-- BLOCO 09
-- 20260821090000_action_guard_work_orders.sql
-- ================================================================

-- A matriz de permissões do Admin escreve em role_permission_overrides. Do lado da
-- base, essa tabela só era consultada num sítio — public.has_action, usada pela
-- política dt_insert_adjusters em downtime_events. work_orders não tinha guarda
-- nenhuma, e nenhum ecrã chama can() para as cinco ações wo.* (só wo.view), pelo
-- que estes triggers são a primeira e única coisa a fazê-las valer: uma ação
-- revogada aparece como erro cru num fluxo que não avisou de nada.
-- Semântica: só negar. A base de quem pode o quê continua no MATRIX (TypeScript).

CREATE OR REPLACE FUNCTION public.action_revoked(_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Sem utilizador (edge functions, pg_cron) nada é negado: um switch do Admin
  -- não pode parar o sync do iTouching nem os fechos noturnos.
  -- Mesmo invariante de permissions.ts:307 (if (role === "admin") return true;):
  -- o admin nunca se tranca a si próprio, nem através da base de dados.
  SELECT auth.uid() IS NOT NULL
    AND public.current_user_role() <> 'admin'
    AND EXISTS (
    SELECT 1
    FROM public.role_permission_overrides o
    WHERE o.action = _action
      AND o.allowed = false
      AND o.role = public.current_user_role()
  )
$$;

REVOKE ALL ON FUNCTION public.action_revoked(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.action_revoked(text) TO authenticated;

CREATE OR REPLACE FUNCTION public.enforce_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.action_revoked(TG_ARGV[0]) THEN
    RAISE EXCEPTION 'Permission "%" is turned off for your role.', TG_ARGV[0]
      USING ERRCODE = '42501';
  END IF;
  IF TG_OP = 'DELETE' THEN
    RETURN OLD;
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_action() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.enforce_action() TO authenticated;

DROP TRIGGER IF EXISTS wo_guard_insert ON public.work_orders;
CREATE TRIGGER wo_guard_insert
  BEFORE INSERT ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_action('wo.create');

DROP TRIGGER IF EXISTS wo_guard_update ON public.work_orders;
CREATE TRIGGER wo_guard_update
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_action('wo.update');

DROP TRIGGER IF EXISTS wo_guard_delete ON public.work_orders;
CREATE TRIGGER wo_guard_delete
  BEFORE DELETE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_action('wo.delete');

DROP TRIGGER IF EXISTS wo_guard_close ON public.work_orders;
CREATE TRIGGER wo_guard_close
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW
  WHEN (NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed')
  EXECUTE FUNCTION public.enforce_action('wo.close');

DROP TRIGGER IF EXISTS wo_guard_force ON public.work_orders;
CREATE TRIGGER wo_guard_force
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW
  WHEN (NEW.status = 'force_closed' AND OLD.status IS DISTINCT FROM 'force_closed')
  EXECUTE FUNCTION public.enforce_action('wo.force');

-- Rollback:
--   DROP TRIGGER IF EXISTS wo_guard_force  ON public.work_orders;
--   DROP TRIGGER IF EXISTS wo_guard_close  ON public.work_orders;
--   DROP TRIGGER IF EXISTS wo_guard_delete ON public.work_orders;
--   DROP TRIGGER IF EXISTS wo_guard_update ON public.work_orders;
--   DROP TRIGGER IF EXISTS wo_guard_insert ON public.work_orders;
--   REVOKE ALL ON FUNCTION public.enforce_action() FROM PUBLIC;
--   DROP FUNCTION IF EXISTS public.enforce_action();
--   REVOKE ALL ON FUNCTION public.action_revoked(text) FROM PUBLIC;
--   DROP FUNCTION IF EXISTS public.action_revoked(text);


-- ================================================================
-- BLOCO 10
-- 20260822090000_a_score_is_frozen_at_the_scale_of_its_day.sql
-- ================================================================

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


-- ================================================================
-- BLOCO 11
-- 20260822093000_the_leaders_own_card_reads_the_frozen_figure.sql
-- ================================================================

-- The leader's own card has to read the frozen figure too.
--
-- src/lib/leaderScorecard.ts opens with the rule this migration exists to keep: "Two
-- fetch paths, one arithmetic. If the score were computed twice the leader and the
-- manager could be looking at different numbers for the same person and period, which
-- is the one thing a scorecard may never do."
--
-- The manager's path is a PostgREST select and its column list was widened in the same
-- change as this one. The leader's path is this SECURITY DEFINER function, because RLS
-- scopes a line tablet to a single line — and its projection is a fixed list written in
-- 20260811090000. A column the list does not name simply is not in the JSON, so
-- `actionPoints` would fall back to today's scale on the tablet while the manager reads
-- the scale of the action's day. Same leader, same week, two numbers.
--
-- WHY THIS PATCHES INSTEAD OF REPLACING. The function is 209 lines. Re-issuing it from
-- the copy in this repository would overwrite whatever is actually deployed with
-- whatever this repository happens to hold, and those are not known to be the same
-- thing — nothing here applies migrations, so the repo is a record of intent and the
-- database is the record of fact. So this reads the live definition, checks it has the
-- shape it expects, and rewrites only the projection. If the live function has drifted,
-- it RAISES rather than guessing: a scorecard that silently keeps computing the wrong
-- number is the failure being fixed, and repeating it in the fix would be worse.

DO $patch$
DECLARE
  _src text;
  -- The last four columns of the projection, on one line, exactly as 20260811090000
  -- wrote them. Anchoring on the tail rather than on the whole list keeps this working
  -- if an earlier column was added in between.
  _old constant text := 'qa.validated_at, qa.validated_by, qa.attachments, qa.closed_at';
  _new constant text := 'qa.validated_at, qa.validated_by, qa.attachments, qa.closed_at,
             qa.points_at_creation';
  _hits integer;
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'leader_self_scorecard';

  IF _src IS NULL THEN
    RAISE NOTICE 'leader_self_scorecard nao existe nesta base. Nada a corrigir.';
    RETURN;
  END IF;

  -- Idempotent: re-running a migration must not be a way to break something.
  IF position('points_at_creation' IN _src) > 0 THEN
    RAISE NOTICE 'leader_self_scorecard ja projecta points_at_creation. Sem alteracao.';
    RETURN;
  END IF;

  _hits := (length(_src) - length(replace(_src, _old, ''))) / length(_old);

  IF _hits <> 1 THEN
    RAISE EXCEPTION
      'A projeccao de leader_self_scorecard nao tem a forma esperada (% ocorrencias de "%"). '
      'A funcao viva divergiu do que esta migracao conhece: comparar antes de aplicar, e '
      'acrescentar qa.points_at_creation a mao. Um cartao que continua a calcular pela '
      'escala de hoje enquanto o gestor le a escala do dia e o defeito que isto corrige.',
      _hits, _old
      USING ERRCODE = 'raise_exception';
  END IF;

  EXECUTE replace(_src, _old, _new);
  RAISE NOTICE 'leader_self_scorecard passa a projectar points_at_creation.';
END $patch$;

-- NOT fixed here, and named so it is not mistaken for an oversight: the same projection
-- omits `domain` and `safety_kind`. On the tablet a safety occurrence therefore arrives
-- looking like a quality one, so `standsAgainstLeader` counts it as quality activity and
-- the H&S ceiling in computeLeaderScore has nothing to fire on. That is a defect older
-- than this change and wider than it — it moves a leader's Quality figure and their RAG,
-- not just where a number is read from — so it belongs to a decision of its own rather
-- than riding along inside a scoring migration.


-- ================================================================
-- BLOCO 12
-- 20260823090000_a_label_may_aggravate_never_soften.sql
-- ================================================================

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


-- ================================================================
-- BLOCO 13
-- 20260824090000_a_failed_ccp_is_a_ceiling_too.sql
-- ================================================================

-- A failed CCP is a ceiling, not a number of points.
--
-- Fail CCP and Foreign Body were priced like Pallet and Office — points, in the same
-- plane, feeding the same averages. Points average out. A leader could close a quarter
-- in green having had a critical control point fail in it, because eleven good weeks
-- diluted one bad day. In a BRC/HACCP plant that is not a scoring preference, it is an
-- audit finding: the system cannot show that a food safety deviation was treated as
-- one.
--
-- THE MECHANISM ALREADY EXISTS AND IS NOT REBUILT HERE. 20260818090000 established the
-- sentence this module is organised around — "Production, Quality and Documentation are
-- WEIGHTS; food safety and Health & Safety are CEILINGS" — and built the ceiling:
-- CAP_Gate at 49, applied with LEAST() AFTER the weighted sum, with a cap_reason beside
-- it. What that migration wired up were the check-sheet and H&S triggers. This adds the
-- third trigger the sentence always named and nothing yet fired on: an ACTION carrying
-- a food safety label.
--
-- Nothing here creates a fourth weight, and nothing may. A weight would price a failed
-- CCP at some number of points and let a good volume week buy it back. A ceiling can
-- only ever lower, so no arithmetic anywhere can turn a failed CCP into a good period.
--
-- THE GATE IS NOT ATTRIBUTION. An action whose labels are "not the leader's" still
-- gates, and this is deliberate rather than overlooked: the gate records that the event
-- OCCURRED in the period, not who is to blame for it. It is the same rule the H&S gate
-- already runs on — computeLeaderScore's `gating` filter applies no attribution either —
-- and the same reason a completed CAPA does not erase it. Only a REJECTED action is
-- void, because Quality looked and said it did not happen.

-- =====================================================================
-- 1. The flag
--
-- Mirrors quality_options_only_labels_are_priced from 20260815120000: a department is
-- not a label and cannot gate anything, and that belongs where it cannot be bypassed by
-- whoever writes the next screen.
-- =====================================================================

ALTER TABLE public.quality_options
  ADD COLUMN IF NOT EXISTS is_gate boolean NOT NULL DEFAULT false;

DO $$ BEGIN
  ALTER TABLE public.quality_options
    ADD CONSTRAINT quality_options_only_labels_gate
    CHECK (kind = 'label' OR is_gate = false);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.quality_options.is_gate IS
  'Uma accao com esta etiqueta forca RED e limita o score a CAP_Gate no periodo em que ocorreu. NAO e um peso e nao e compensavel. Nao e apagada por CAPA concluida — a CAPA fecha-se noutro sitio.';

-- =====================================================================
-- 2. Marking the four
--
-- Matched by NAME, lowercased and trimmed, because these labels were created through
-- the UI and exist in no migration — there is no id to target and no seed to amend.
--
-- Which means the match can silently hit nothing. A label spelled 'CCP' where this
-- expects 'Fail CCP' would leave the gate switched off on the exact deviation it was
-- built for, and the migration would report success. So it counts what it marked and
-- RAISES when the count is short: zero rows updated is a wrong work order, not a
-- completed one.
--
-- It does NOT create the missing labels. Inventing a food safety category because a
-- string did not match would put a label on the picker that nobody in the plant chose.
-- =====================================================================

DO $gates$
DECLARE
  _wanted constant text[] := ARRAY[
    'fail ccp', 'foreign body', 'wrong weight volume check', 'bag inside blender'];
  _found  text[];
  _absent text[];
BEGIN
  UPDATE public.quality_options
     SET is_gate = true
   WHERE kind = 'label'
     AND lower(btrim(value)) = ANY(_wanted)
     AND is_gate = false;

  SELECT coalesce(array_agg(DISTINCT lower(btrim(value))), ARRAY[]::text[]) INTO _found
    FROM public.quality_options
   WHERE kind = 'label' AND is_gate = true;

  SELECT coalesce(array_agg(w), ARRAY[]::text[]) INTO _absent
    FROM unnest(_wanted) AS w WHERE NOT (w = ANY(_found));

  RAISE NOTICE 'Etiquetas com gate activo: %', array_to_string(_found, ', ');

  IF cardinality(_absent) > 0 THEN
    RAISE EXCEPTION
      'Estas etiquetas de gate nao existem em quality_options: %. '
      'Nao foram criadas de proposito — inventar uma categoria de seguranca alimentar '
      'porque uma string nao bateu poria no picker uma etiqueta que ninguem na fabrica '
      'escolheu. Confirmar a grafia exacta com: SELECT value FROM quality_options WHERE '
      'kind = ''label'' ORDER BY value; e corrigir a lista desta migracao ou o nome da '
      'etiqueta. Um gate que nao dispara e pior do que gate nenhum.',
      array_to_string(_absent, ', ')
      USING ERRCODE = 'no_data_found';
  END IF;
END $gates$;

-- =====================================================================
-- 3. The ceiling itself is already seeded
--
-- CAP_Gate = 49 exists since 20260818090000 and is shared with the check-sheet and H&S
-- triggers on purpose: one number for "a gate fired", so a failed CCP and a lost-time
-- injury cannot come to disagree about what a gate costs. There is deliberately no
-- CAP_FoodSafety.
-- =====================================================================

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM public.leader_scorecard_threshold
                  WHERE name = 'CAP_Gate' AND valid_to IS NULL) THEN
    RAISE EXCEPTION
      'CAP_Gate nao tem versao vigente. 20260818090000 nao foi aplicada, e sem o tecto '
      'esta migracao marca etiquetas que nada limita.'
      USING ERRCODE = 'invalid_parameter_value';
  END IF;
END $$;


-- ================================================================
-- BLOCO 14
-- 20260826090000_the_weekly_row_learns_about_the_actions.sql
-- ================================================================

-- The weekly row learns about the actions, too.
--
-- 20260824090000 marked four labels as gates and made computeLeaderScore cap on them, so
-- a leader opening their own card sees a failed CCP limit the period to 49. The weekly
-- SQL row did not learn: v_leader_weekly_scorecard is fed by leader_weekly_scorecard, a
-- hand-filled table of check statuses and counts, and it has never read quality_actions.
--
-- So the same failed CCP produced two different answers depending on which screen you
-- opened. That is the one thing this module may not do, and it is stated as such at the
-- top of src/lib/leaderScorecard.ts: two fetch paths, one arithmetic.
--
-- WHY THIS IS NOT DOUBLE-COUNTING, since the week already gates on a 'Fail' check. The
-- check sheet answers "was the CCP check done this week, and did it pass". An action
-- answers "an incident occurred". They are two records of two different facts that can
-- and do diverge — an action can be raised in a week whose sheet was never marked Fail.
-- Both gate. Gating twice is arithmetically harmless (LEAST is idempotent, and Red twice
-- is Red) and the alternative is a food safety event that reaches no weekly row at all
-- because nobody ticked a box.
--
-- HOW THIS IS BUILT. The view is re-issued whole, because a view's definition is stored
-- as a parse tree and pg_get_viewdef reconstructs it — the targeted-patch trick used on
-- leader_self_scorecard in 20260822093000 cannot work here. To keep the re-issue honest
-- the body below was GENERATED from the 20260818090000 source by applying four edits,
-- not retyped: every line this migration does not deliberately change is byte-identical
-- to the definition in force. The four changes are marked in place.
--
-- CREATE OR REPLACE VIEW keeps column names, types and order, so the eight dependent
-- views — the periods view, three rollups, two rankings and the trends — are untouched
-- and are not re-issued here.

-- =====================================================================
-- 0. Preconditions
--
-- Both are the same class of failure: the migration would apply cleanly and the gate
-- would never fire, which is worse than not applying at all.
-- =====================================================================

DO $pre$ BEGIN
  IF to_regclass('public.v_leader_weekly_scorecard') IS NULL THEN
    RAISE EXCEPTION '20260818090000 tem de estar aplicada: esta migracao re-emite a view que ela cria.'
      USING ERRCODE = 'invalid_table_definition';
  END IF;

  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                  WHERE table_schema = 'public' AND table_name = 'quality_options'
                    AND column_name = 'is_gate') THEN
    RAISE EXCEPTION
      '20260824090000 tem de estar aplicada primeiro. Sem quality_options.is_gate esta '
      'view nao compila, e se compilasse nao teria nenhuma etiqueta por onde gatear.'
      USING ERRCODE = 'undefined_column';
  END IF;

  /**
   * quality_actions.leader_id tem de apontar para line_leaders, nao para auth.users.
   *
   * Ate 20260825090000 apontava para auth.users, e lideres de linha nao tem conta — o
   * PIN e um segundo factor sobre a sessao de outra pessoa, nao um login. Uma accao com
   * leader_id preenchido guardava portanto um id que NAO existe em line_leaders.
   *
   * O que isso faria a este gate, se corresse antes: a juncao abaixo compara
   * a.leader_id com s.leader_id (line_leaders) e so cai para o nome quando a.leader_id
   * E NULL. Uma accao com o id antigo preenchido nao bate na primeira condicao nem
   * entra na segunda — escapa ao gate inteiro, em silencio, e a semana fecha verde com
   * um CCP reprovado dentro. Falhar aberto num gate e a unica falha que este modulo
   * trata como inaceitavel.
   */
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint c
     WHERE c.conrelid = 'public.quality_actions'::regclass
       AND c.contype = 'f'
       AND c.confrelid = 'public.line_leaders'::regclass
       AND c.conkey = ARRAY[(SELECT attnum FROM pg_attribute
                              WHERE attrelid = 'public.quality_actions'::regclass
                                AND attname = 'leader_id')]
  ) THEN
    RAISE EXCEPTION
      '20260825090000_a_line_leader_is_not_an_account tem de estar aplicada primeiro. '
      'Enquanto quality_actions.leader_id apontar para auth.users, uma accao com o id '
      'preenchido escapa ao gate desta view sem erro nenhum.'
      USING ERRCODE = 'invalid_foreign_key';
  END IF;
END $pre$;

-- =====================================================================
-- 1. A view, com o gate das accoes
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
  -- Rule G, plus the action gate. GREATEST is not available for text, so the gate is
  -- an explicit override rather than a max: a gated week is Red, full stop, and the
  -- band the three pillars would have produced is not consulted. That is what a gate
  -- IS — if the pillars could still argue it down, it would be a weight.
  CASE WHEN g.gated THEN 'Red'
       ELSE public.scorecard_overall_rag(v.volume_rag, q.quality_rag, (h.eval).rag)
  END AS overall_rag,

  -- Rule H. Quality, H&S, Volume, missing data — in that order, only the applicable
  -- parts, and every part sourced from a value computed above rather than re-derived.
  NULLIF(concat_ws(' ',
    -- The gate leads. A leader reading a Red week asks what to fix, and a food safety
    -- event outranks every other line here — including on a line-row that did not have
    -- the incident, which is why naming it is not optional. See the `g` lateral.
    CASE WHEN g.gated THEN 'Seguranca alimentar: ' || g.reason END,
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
  -- The gate ceiling, applied OUTSIDE scorecard_score_evaluate rather than as a new
  -- argument to it. Adding a parameter to that function would not replace it, it would
  -- create a second one beside it — the trap this migration's own closing comment warns
  -- about — and every caller would then have to be found and moved. LEAST here is the
  -- same arithmetic in a place that cannot fork the function.
  --
  -- Still AFTER the weighted sum and still only ever downward, which is the whole rule.
  CASE WHEN g.gated THEN LEAST(sc.score_final, t.cap_gate) ELSE sc.score_final END
    AS score_final,
  CASE WHEN g.gated
       THEN concat_ws(' ',
              'Teto ' || public.scorecard_score_label(t.cap_gate) || ': ' || g.reason || '.',
              sc.cap_reason)
       ELSE sc.cap_reason
  END AS cap_reason,
  (g.gated OR sc.cap_reason IS NOT NULL) AS cap_applied,
  -- Printed next to the score, because a score whose weights nobody can see is a score
  -- nobody can check.
  t.w_prod AS weight_production,
  t.w_qual AS weight_quality,
  t.w_doc  AS weight_documentation,

  -- volume_source, appended LAST rather than filed under Volume where it belongs
  -- thematically: inserting a column mid-list renumbers everything after it, and this
  -- view is read positionally by nothing we can prove. Appending cannot break a reader.
  --
  -- It is a base-table column (20260816090000) and a field the screen WRITES, but it was
  -- missing from every version of this view, and that made it a column the screen could
  -- only ever write once. src/lib/scorecardEntry.ts pickWritable() projects a fetched view
  -- row down to the draft's own keys; a key the view does not carry is not restored, so
  -- the draft held NULL and the next save wrote NULL over the stamp. Reopening a week and
  -- touching any field erased the record of whether the volume was derived or typed by
  -- hand — the audit column, silently, on the save that looked like it had worked.
  s.volume_source

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
-- The action gate: a quality action carrying a label marked is_gate.
--
-- LEADER AND WEEK, NOT LINE. The specification says the gate applies to "aquele periodo
-- e aquele lider", and this follows it literally — so a CCP failure on Line 3 also turns
-- the same leader's Line 5 row Red that week. That is a real consequence and it is the
-- reason rag_driver names the event first: somebody reading Red on a clean line has to
-- be able to see, on the row itself, that the cause was a food safety event elsewhere in
-- that leader's week. Matching the line instead would need quality_actions.line to agree
-- with lines.name as free text, which is the class of match that has already cost this
-- project a leader's entire quality section.
--
-- The leader join takes the id when the action has one and falls back to the name
-- otherwise: quality_actions.leader_id is nullable, and a gate that skipped the rows
-- without it would fail OPEN on exactly the oldest data.
--
-- A rejected action is void — Quality looked and said it did not happen. Nothing else
-- voids it: not a closed CAPA, not attribution. The gate records that the event occurred.
CROSS JOIN LATERAL (
  SELECT
    count(*) > 0 AS gated,
    string_agg(DISTINCT o.value || ' em ' || to_char(a.recorded_at, 'DD/MM'), '; ')
      AS reason
  FROM public.quality_actions a
  JOIN public.quality_options o
    ON o.kind = 'label' AND o.is_gate = true AND o.value = ANY(a.labels)
  WHERE a.validation_status IS DISTINCT FROM 'rejected'
    AND a.recorded_at::date BETWEEN s.week_ending - 6 AND s.week_ending
    AND (a.leader_id = s.leader_id
         OR (a.leader_id IS NULL
             AND ll.name IS NOT NULL
             AND lower(btrim(a.leader_name)) = lower(btrim(ll.name))))
) g

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
  'O scorecard semanal calculado, ao nivel lider x linha x semana. Definicao unica de volume_pct, volume_pct_adjusted, volume_rag, quality_rag, quality_fail_type, hs_rag, hs_driver, overall_rag e rag_driver: os rollups, o resumo, a tendencia e o ranking leem esta view e nao repetem nenhuma regra. Desde 20260826090000 o RAG e o tecto tambem respondem a accoes com etiqueta is_gate, ao nivel lider x semana.';


-- ================================================================
-- BLOCO 14B
-- 20260826090509_e75bd9d9-5977-4f29-bc0e-e7a68b52cd9d.sql
-- ================================================================
--
-- Stamped between BLOCO 14 and BLOCO 15, so it is numbered between them rather
-- than renumbering ten blocks somebody may already have pasted. The same "b" the
-- docs/apply package uses for 00b-20260801060000.
--
-- The bucket itself is not here. `part-photos` was created through the storage
-- API, not by SQL, and CREATE POLICY is all that a paste can carry. If these
-- policies land on a database with no such bucket they are inert, not wrong: they
-- name a bucket_id nothing matches.

-- Photos for maintenance spare parts live in the private "part-photos" bucket.
-- Access mirrors public.products exactly: view = anyone who can read products,
-- upload/replace = anyone who can write products, delete = anyone who can delete products.

CREATE POLICY "part_photos_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'part-photos' AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'engineer'::app_role)
    OR public.has_role(auth.uid(), 'planner'::app_role)
    OR public.has_role(auth.uid(), 'warehouse'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
);

CREATE POLICY "part_photos_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'part-photos' AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
);

CREATE POLICY "part_photos_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'part-photos' AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
)
WITH CHECK (
  bucket_id = 'part-photos' AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
);

CREATE POLICY "part_photos_delete"
ON storage.objects FOR DELETE TO authenticated
USING (
  bucket_id = 'part-photos' AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
);


-- ================================================================
-- BLOCO 15
-- 20260827090000_the_evidence_gate_outlived_the_place_to_attach_it.sql
-- ================================================================

-- "Attach the evidence before validating this action." — there is nowhere left to
-- attach it.
--
-- The rule was right when it was written (20260730230000, ALCOA+: a validated
-- deviation carries its evidence) because the detail dialog had a Photos block with an
-- upload beside it. Both are gone from the screen: attachments for a deviation are
-- captured in SafetyCulture now, and the verdict picker went with them. A trigger that
-- demands a file no screen can produce does not enforce a standard, it just refuses
-- every write and teaches whoever hits it that the app is broken.
--
-- Nothing else in the function changes. Only Quality still rules on a deviation, a
-- closed action still has to be reopened before its verdict moves, closure is still a
-- manager's and still needs a verdict first. The `attachments` column is untouched and
-- every path already in it stays exactly where it is — this drops the gate, not the
-- evidence.
CREATE OR REPLACE FUNCTION public.enforce_quality_validation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_admin boolean;
  _is_quality boolean;
  _is_manager boolean;
  _verdict_changed boolean := new.validation_status IS DISTINCT FROM old.validation_status;
  _closure_changed boolean := (new.closed_at IS NULL) IS DISTINCT FROM (old.closed_at IS NULL);
BEGIN
  IF NOT _verdict_changed AND NOT _closure_changed THEN RETURN new; END IF;

  -- Backend paths (cron, service key) have no auth.uid(); RLS keeps anon out.
  IF _uid IS NULL THEN RETURN new; END IF;

  _is_admin   := has_role(_uid,'admin');
  _is_quality := _is_admin OR has_role(_uid,'quality_supervisor');
  _is_manager := _is_admin OR has_role(_uid,'manager') OR has_role(_uid,'maintenance_manager');

  IF _verdict_changed THEN
    -- A closed action is a filed record. Changing its verdict changes a leader's
    -- score after the fact, so it takes a manager reopening it first — and that
    -- reopening is in the history.
    IF old.closed_at IS NOT NULL AND new.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'This action is closed. A manager must reopen it before the verdict can change.';
    END IF;

    IF new.validation_status IN ('validated','rejected') AND NOT _is_quality THEN
      RAISE EXCEPTION 'Only Quality or an admin can validate or reject a quality action.';
    END IF;

    IF new.validation_status = 'validated' THEN
      -- The evidence check stood here. See the header: the upload it required was
      -- removed from the screen, so it could only ever refuse.
      new.validated_by := COALESCE(new.validated_by, _uid);
      new.validated_at := COALESCE(new.validated_at, now());
    ELSE
      -- Withdrawing the verdict withdraws the signature with it.
      new.validated_by := NULL;
      new.validated_at := NULL;
    END IF;
  END IF;

  IF _closure_changed THEN
    IF NOT _is_manager THEN
      RAISE EXCEPTION 'Only a manager or an admin can approve the closure of a quality action.';
    END IF;
    IF new.closed_at IS NOT NULL THEN
      IF new.validation_status NOT IN ('validated','rejected') THEN
        RAISE EXCEPTION 'Quality must validate or reject this action before it can be closed.';
      END IF;
      new.closed_by := COALESCE(new.closed_by, _uid);
      new.closed_at := COALESCE(new.closed_at, now());
    ELSE
      new.closed_by := NULL;
    END IF;
  END IF;

  RETURN new;
END
$function$;


-- ================================================================
-- BLOCO 16
-- 20260827093000_a_department_can_be_someone_elses.sql
-- ================================================================

-- A department can be somebody else's, the same way a label can.
--
-- Until now attribution ran on labels alone. `quality_actions.department` existed, was
-- required on the log form, printed in its own column and drove a bar chart — and never
-- touched a single point. So the factory's own reading of the field ("this one is
-- Maintenance's") had no effect on the score the field looks like it should govern, and
-- clearing a machine failure off a leader meant remembering to also put the Maintenance
-- LABEL on it. Two ways to say one thing, one of which did nothing.
--
-- This makes the department an attribution axis beside the labels:
--
--   * `quality_options.counts_against_leader` — the switch, on the department rows.
--   * `scoring_version_excluded_department`   — the switch, frozen per scoring version.
--   * `action_points_at(..., _department, ...)` — the rule, applied.
--
-- The rule is a VETO, which is deliberately not what the label rule does. Read the
-- reasoning in `countsAgainstLeaderDepartment` in src/lib/qualityConstants.ts before
-- changing either: a label lives in a set, so a veto there was a lever anybody could
-- pull by adding "Maintenance" to a paperwork error, invisibly. A department is one
-- value, chosen on the way in, printed on the list, the detail panel and the export.
-- It cannot hide, so it can veto.
--
-- WHAT THIS DOES NOT DO: it does not re-price history. `points_at_creation` stays
-- exactly as frozen — 20260822090000 exists to make that true and this migration is not
-- the exception. The new rule opens a new scoring version and applies from it onward.
-- Nobody's July total moves because of a decision taken in August.

BEGIN;

-- =====================================================================
-- 1. The switch
-- =====================================================================

ALTER TABLE public.quality_options
  ADD COLUMN IF NOT EXISTS counts_against_leader boolean NOT NULL DEFAULT true;

COMMENT ON COLUMN public.quality_options.counts_against_leader IS
  'Se uma accao registada neste departamento cobra pontos ao lider. Lido nas linhas kind = department. O default true e a direccao estrita: nada deixa de contar sem alguem o dizer.';

-- Production is what the lines actually book against and it charges, which is the
-- default — named here anyway so the row exists on a database seeded before it.
-- Maintenance is the whole point of the change and does not charge.
INSERT INTO public.quality_options (kind, value, active, sort, counts_against_leader)
VALUES
  ('department', 'Production',  true, 40, true),
  ('department', 'Maintenance', true, 50, false)
ON CONFLICT DO NOTHING;

-- ON CONFLICT DO NOTHING covers a fresh insert, not a Maintenance row somebody already
-- added by hand through Lists & scoring — which is exactly how this database got its
-- Production row. Without this the switch would silently stay at the default and the
-- migration would report success having changed nothing.
UPDATE public.quality_options
   SET counts_against_leader = false
 WHERE kind = 'department'
   AND lower(btrim(value)) = 'maintenance';

-- =====================================================================
-- 2. The switch, frozen per version
-- =====================================================================

CREATE TABLE IF NOT EXISTS public.scoring_version_excluded_department (
  version_id bigint NOT NULL REFERENCES public.scoring_version(id) ON DELETE CASCADE,
  department text   NOT NULL,
  PRIMARY KEY (version_id, department)
);

COMMENT ON TABLE public.scoring_version_excluded_department IS
  'Os departamentos que NAO sao do lider nesta versao. A ausencia significa que conta. Congelado junto com os precos e com as labels excluidas, pela mesma razao: mudar quem responde por uma accao re-pontuava a historia tal como mudar um preco.';

ALTER TABLE public.scoring_version_excluded_department ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Anyone signed in can read versioned department exclusions"
  ON public.scoring_version_excluded_department;
CREATE POLICY "Anyone signed in can read versioned department exclusions"
  ON public.scoring_version_excluded_department FOR SELECT TO authenticated USING (true);

-- =====================================================================
-- 3. The snapshot learns about departments
-- =====================================================================

CREATE OR REPLACE FUNCTION public.scoring_version_snapshot(_version_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM public.scoring_version_severity            WHERE version_id = _version_id;
  DELETE FROM public.scoring_version_label               WHERE version_id = _version_id;
  DELETE FROM public.scoring_version_excluded_label      WHERE version_id = _version_id;
  DELETE FROM public.scoring_version_excluded_department WHERE version_id = _version_id;

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

  -- Unguarded, unlike the label exclusions above: the column is created by this same
  -- migration a few statements up, so it is there by the time this body ever runs.
  -- ACTIVE rows only — a hidden department cannot be picked on the form, so whether it
  -- would have charged is not a question this version needs an answer to.
  INSERT INTO public.scoring_version_excluded_department (version_id, department)
  SELECT _version_id, lower(btrim(value))
    FROM public.quality_options
   WHERE kind = 'department'
     AND active = true
     AND counts_against_leader = false
     AND btrim(coalesce(value, '')) <> ''
   GROUP BY lower(btrim(value));
END $$;

-- =====================================================================
-- 4. The rule
-- =====================================================================

/**
 * The SQL twin of livePoints() in src/lib/qualityConstants.ts, against a dated version.
 *
 * New signature: `_department` joins the action's own fields, `_version_id` stays last.
 * The 5-argument version is dropped at the end of this file rather than left beside it —
 * two live definitions of one rule is the drift this whole module was rebuilt to stop,
 * and a caller that missed the change would silently keep scoring without the veto.
 *
 * Guard ORDER is part of the rule and is asserted by scoringVersionParity.test.ts:
 * safety, then rejected, then department, then labels. A rejected safety row must
 * return 0 for the SAFETY reason, because that is the sentence printed beside it.
 * The department sits above the labels because it is the broader claim — it says the
 * action belongs to somebody else entirely, and no label argues that back.
 */
CREATE OR REPLACE FUNCTION public.action_points_at(
  _domain text,
  _severity text,
  _labels text[],
  _validation_status text,
  _department text,
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

  -- countsAgainstLeaderDepartment: one department per action, so this is a veto. A
  -- blank department still counts — leaving the field empty must not quietly remove a
  -- deviation from somebody's score, the same rule the blank label list follows below.
  IF btrim(coalesce(_department, '')) <> ''
     AND EXISTS (SELECT 1 FROM public.scoring_version_excluded_department d
                  WHERE d.version_id = _version_id
                    AND d.department = lower(btrim(_department)))
  THEN
    RETURN 0;
  END IF;

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

COMMENT ON FUNCTION public.action_points_at(text, text, text[], text, text, bigint) IS
  'O gemeo SQL de actionPoints() em src/lib/qualityConstants.ts, contra uma versao datada. Desde 20260827093000 o departamento tambem atribui, como veto. Mudar um, mudar o outro.';

-- =====================================================================
-- 5. The freeze trigger calls the new rule
-- =====================================================================

/**
 * Unchanged in intent, rewritten only to pass the department through.
 *
 * On INSERT: the version in force on the action's own recorded_at, not today's.
 * On re-grade: the action's OWN scoring_version_id. The fact gets corrected, the ruler
 * does not — using current_date here would re-open every door 20260822090000 closed.
 *
 * `department` is read through to_jsonb for the same reason `domain` is: the column is
 * optional on older databases, and a plpgsql field reference to a column that does not
 * exist fails at run time rather than degrading.
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
      to_jsonb(NEW)->>'domain', NEW.severity, NEW.labels, NEW.validation_status,
      to_jsonb(NEW)->>'department', _v);
    RETURN NEW;
  END IF;

  _v := coalesce(NEW.scoring_version_id,
                 public.scoring_version_at(coalesce(NEW.recorded_at, now())::date));
  NEW.scoring_version_id     := _v;
  NEW.points_at_creation     := public.action_points_at(
    to_jsonb(NEW)->>'domain', NEW.severity, NEW.labels, NEW.validation_status,
    to_jsonb(NEW)->>'department', _v);
  NEW.points_recalculated_at := now();
  RETURN NEW;
END $$;

-- Dropped only now that nothing calls it. Two live definitions of one rule is the
-- drift this module was rebuilt to stop.
DROP FUNCTION IF EXISTS public.action_points_at(text, text, text[], text, bigint);

-- =====================================================================
-- 6. Changing the switch opens a version
-- =====================================================================

-- Mirrors the label triggers from 20260822090000, including their rule: only a change
-- that can MOVE a score opens a version. Adding a department that charges moves
-- nothing — it is the default — so only an exclusion, or a change to one, counts.
DROP TRIGGER IF EXISTS trg_scoring_version_department_upd ON public.quality_options;
CREATE TRIGGER trg_scoring_version_department_upd
  AFTER UPDATE ON public.quality_options
  FOR EACH ROW WHEN (NEW.kind = 'department'
                     AND (OLD.counts_against_leader IS DISTINCT FROM NEW.counts_against_leader
                          OR (NEW.counts_against_leader = false AND OLD.active IS DISTINCT FROM NEW.active)))
  EXECUTE FUNCTION public.scoring_version_on_ruler_change();

DROP TRIGGER IF EXISTS trg_scoring_version_department_ins ON public.quality_options;
CREATE TRIGGER trg_scoring_version_department_ins
  AFTER INSERT ON public.quality_options
  FOR EACH ROW WHEN (NEW.kind = 'department' AND NEW.counts_against_leader = false)
  EXECUTE FUNCTION public.scoring_version_on_ruler_change();

DROP TRIGGER IF EXISTS trg_scoring_version_department_del ON public.quality_options;
CREATE TRIGGER trg_scoring_version_department_del
  AFTER DELETE ON public.quality_options
  FOR EACH ROW WHEN (OLD.kind = 'department' AND OLD.counts_against_leader = false)
  EXECUTE FUNCTION public.scoring_version_on_ruler_change();

-- =====================================================================
-- 7. Open the version that carries the new rule
-- =====================================================================

-- The seed above ran as plain DML before the triggers existed, so nothing has opened a
-- version for it yet. Done explicitly, once, at the end: from today Maintenance stops
-- charging, and every action already frozen keeps the figure it was frozen with.
SELECT public.scoring_version_open('Departamento passa a atribuir: Maintenance deixa de cobrar ao lider.');

COMMIT;


-- ================================================================
-- BLOCO 17
-- 20260827113000_the_ceiling_cannot_see_the_injury.sql
-- ================================================================

-- The ceiling could not see the injury.
--
-- computeLeaderScore gates a period on `domain = 'safety' AND safety_kind IN
-- (lost_time_injury, reportable_accident)`, and neither fetch path ever asked for
-- safety_kind. The manager's PostgREST select named `domain` and stopped there; this
-- function, the leader's own path, named neither. So the field arrived undefined on
-- every real row, the condition was never true, and a period holding a lost-time injury
-- scored its plain weighted sum with no ceiling and nothing on the card to say so.
--
-- Every unit test of the gate passed throughout. They hand the function an object with
-- safety_kind on it, which is the one place it was ever present. The TypeScript side of
-- this is guarded by src/__tests__/theCeilingCannotSeeTheInjury.test.ts, which also
-- requires this file to exist and to name both columns.
--
-- 20260822093000 saw this and deliberately left it: "NOT fixed here, and named so it is
-- not mistaken for an oversight ... it moves a leader's Quality figure and their RAG,
-- not just where a number is read from — so it belongs to a decision of its own rather
-- than riding along inside a scoring migration." This is that decision.
--
-- WHAT IT CHANGES ON THE TABLET, stated plainly because it is not only the ceiling:
--   1. The H&S ceiling can fire on the leader's own card, as it now can on the
--      manager's. Same person, same period, same number — the rule src/lib/
--      leaderScorecard.ts opens with.
--   2. `standsAgainstLeader` and `actionPoints` finally see `domain`, so a safety
--      occurrence stops being priced as a quality one. A leader's Quality figure will
--      MOVE on the tablet the day this is applied, upward, because rows that were being
--      charged severity points are worth zero and always were. That is a correction,
--      not a gift, and it makes the tablet agree with the manager's card rather than
--      with its own history.
--   3. The Health & Safety band on the scorecard has rows to count.
--
-- WHY THIS PATCHES INSTEAD OF REPLACING — the same reasoning as 20260822093000, which
-- is not repeated at length here: the function is over two hundred lines, nothing in
-- this repository applies migrations, and re-issuing the repo's copy would overwrite
-- what is actually deployed with what this repository happens to hold. So it reads the
-- live definition, checks the shape it expects, and rewrites only the projection. If
-- the live function has drifted, it RAISES rather than guessing.

DO $patch$
DECLARE
  _src text;
  -- Anchored on the tail of the projection as 20260811090000 wrote it, and on a pair
  -- rather than on `qa.closed_at` alone so it cannot match a `closed_at` elsewhere in
  -- two hundred lines. Deliberately NOT anchored past it: 20260822093000 may or may not
  -- have appended `qa.points_at_creation` after this point, and this has to apply to a
  -- base in either state.
  _old constant text := 'qa.attachments, qa.closed_at';
  _new constant text := 'qa.attachments, qa.closed_at, qa.domain, qa.safety_kind';
  _hits integer;
  _has_columns boolean;
BEGIN
  -- 20260817090000 creates the enum, the column and the CHECK in one statement, so a
  -- base has both columns or neither. Projecting a column that does not exist would
  -- make the function fail to create and take the leader's whole card down with it —
  -- and a base without them has no safety rows to gate on in the first place.
  SELECT count(*) = 2 INTO _has_columns
    FROM information_schema.columns
   WHERE table_schema = 'public'
     AND table_name = 'quality_actions'
     AND column_name IN ('domain', 'safety_kind');

  IF NOT _has_columns THEN
    RAISE NOTICE
      'quality_actions ainda nao tem domain/safety_kind (20260817090000 por aplicar). '
      'Nada a projectar. Aplicar 20260817090000 primeiro e voltar a correr esta.';
    RETURN;
  END IF;

  SELECT pg_get_functiondef(p.oid) INTO _src
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.proname = 'leader_self_scorecard';

  IF _src IS NULL THEN
    RAISE NOTICE 'leader_self_scorecard nao existe nesta base. Nada a corrigir.';
    RETURN;
  END IF;

  -- Idempotent: re-running a migration must not be a way to break something.
  IF position('safety_kind' IN _src) > 0 THEN
    RAISE NOTICE 'leader_self_scorecard ja projecta safety_kind. Sem alteracao.';
    RETURN;
  END IF;

  _hits := (length(_src) - length(replace(_src, _old, ''))) / length(_old);

  IF _hits <> 1 THEN
    RAISE EXCEPTION
      'A projeccao de leader_self_scorecard nao tem a forma esperada (% ocorrencias de "%"). '
      'A funcao viva divergiu do que esta migracao conhece: comparar antes de aplicar, e '
      'acrescentar qa.domain e qa.safety_kind a mao. Um tecto de H&S que nunca dispara '
      'e o defeito que isto corrige — repeti-lo dentro da correccao seria pior.',
      _hits, _old
      USING ERRCODE = 'raise_exception';
  END IF;

  EXECUTE replace(_src, _old, _new);
  RAISE NOTICE 'leader_self_scorecard passa a projectar domain e safety_kind.';
END $patch$;

-- The enum reaches the JSON as its text label, which is what the TypeScript compares
-- against: GATING_KINDS is keyed 'lost_time_injury' / 'reportable_accident', the same
-- labels 20260817090000 declared. to_jsonb on an enum emits the label, so no cast is
-- needed here — recorded because the absence of a cast is the kind of thing a later
-- reader adds "to be safe", and ::text would work while ::integer would not.


-- ================================================================
-- BLOCO 18
-- 20260828090000_maintenance_keeps_its_own_list_and_a_hazard_can_cost.sql
-- ================================================================

-- Maintenance gets a list of its own, and a hazard may be priced.
--
-- Two changes that arrive together because they are the same change to one screen —
-- Lists & scoring now shows four lists, and three of them carry a points box.
--
-- What each list's price DOES is the part worth reading slowly:
--
--   label             priced, charges, may gate    (unchanged)
--   safety_label      priced, charges, never gates (NEW — see below)
--   maintenance_label priced, NEVER charges        (NEW)
--   department        never priced                 (unchanged)
--
-- Health & Safety pricing reverses a rule this schema has enforced since 20260817090000
-- and the reasoning against it still stands and is still enforced: a score that
-- punishes the report teaches the team to stop reporting. So the SEVERITY grade still
-- cannot charge a safety occurrence at all — an unpriced hazard is 0 however badly it
-- is graded, and a near miss is free by default. What is now possible is pricing one
-- named hazard deliberately, on a screen that says so, one row at a time.
--
-- The two price lists are kept APART rather than merged, which is the subtle half.
-- Occurrences logged before the lists split carry QUALITY labels — Foreign Body, GMP —
-- because that was the only list there was. One flat price table would have made
-- pricing Foreign Path for the quality log start charging those old occurrences too,
-- silently, for a decision nobody made about safety. So `scoring_version_label` gains
-- a `kind` and the domain picks which rows apply.
--
-- The TypeScript twin is `livePoints` / `standsAgainstLeader` / `chargingLabelPoints`
-- in src/lib/qualityConstants.ts. Change one, change the other — the parity test
-- src/__tests__/scoringVersionParity.test.ts exists to catch it when they drift.

-- =====================================================================
-- 1. A fourth kind, and three lists that may carry a price
-- =====================================================================

ALTER TABLE public.quality_options DROP CONSTRAINT IF EXISTS quality_options_kind_check;
ALTER TABLE public.quality_options
  ADD CONSTRAINT quality_options_kind_check
  CHECK (kind IN ('label', 'department', 'safety_label', 'maintenance_label'));

-- Departments are not labels and never price anything. That half of
-- 20260815120000's rule is unchanged; what widens is which LABEL kinds may.
ALTER TABLE public.quality_options DROP CONSTRAINT IF EXISTS quality_options_only_labels_are_priced;
ALTER TABLE public.quality_options
  ADD CONSTRAINT quality_options_only_labels_are_priced
  CHECK (kind <> 'department' OR points = 0);

-- Gates do NOT widen with the points box. A gate caps a whole period at CAP_Gate and
-- forces it Red; that is a food-safety ceiling and only the quality list may set one.
-- 20260824090000's constraint already says so and is deliberately left alone.

COMMENT ON COLUMN public.quality_options.points IS
  'What this label charges an action, 0 = unpriced. Charged for kind label (quality) and safety_label (hazards); shown but never charged for maintenance_label; always 0 for department.';

INSERT INTO public.quality_options (kind, value, sort) VALUES
  ('maintenance_label', 'Breakdown', 1),
  ('maintenance_label', 'Bearing failure', 2),
  ('maintenance_label', 'Belt / conveyor', 3),
  ('maintenance_label', 'Sensor / photocell', 4),
  ('maintenance_label', 'Air leak', 5),
  ('maintenance_label', 'Electrical fault', 6),
  ('maintenance_label', 'Lubrication', 7),
  ('maintenance_label', 'Spare part missing', 8),
  ('maintenance_label', 'Calibration', 9)
ON CONFLICT (kind, value) DO NOTHING;

-- =====================================================================
-- 2. The frozen price list learns which list a price came from
-- =====================================================================

-- Default 'label' so every row already frozen keeps meaning exactly what it meant:
-- a quality label's price. Nothing is re-scored by this migration.
ALTER TABLE public.scoring_version_label
  ADD COLUMN IF NOT EXISTS kind text NOT NULL DEFAULT 'label';

DO $$ BEGIN
  ALTER TABLE public.scoring_version_label
    ADD CONSTRAINT scoring_version_label_kind_check
    CHECK (kind IN ('label', 'safety_label'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- The primary key has to widen with it: the same word may appear on both lists in
-- principle, and a key that could not tell them apart would drop one at snapshot time.
DO $$ BEGIN
  ALTER TABLE public.scoring_version_label DROP CONSTRAINT scoring_version_label_pkey;
  ALTER TABLE public.scoring_version_label
    ADD CONSTRAINT scoring_version_label_pkey PRIMARY KEY (version_id, kind, label);
EXCEPTION WHEN undefined_object THEN NULL; END $$;

COMMENT ON COLUMN public.scoring_version_label.kind IS
  'De que lista veio o preco: label (accoes de qualidade) ou safety_label (perigos). O dominio da accao escolhe qual se aplica — um preco de qualidade nao cobra uma ocorrencia de seguranca, nem o contrario.';

-- =====================================================================
-- 3. The snapshot freezes both priced lists
-- =====================================================================

CREATE OR REPLACE FUNCTION public.scoring_version_snapshot(_version_id bigint)
RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  DELETE FROM public.scoring_version_severity            WHERE version_id = _version_id;
  DELETE FROM public.scoring_version_label               WHERE version_id = _version_id;
  DELETE FROM public.scoring_version_excluded_label      WHERE version_id = _version_id;
  DELETE FROM public.scoring_version_excluded_department WHERE version_id = _version_id;

  INSERT INTO public.scoring_version_severity (version_id, severity, points)
  SELECT _version_id, severity, points FROM public.quality_severity_points;

  -- Both priced lists, kept apart by kind. `maintenance_label` is deliberately absent:
  -- it is priced for whoever reads the log and never charges a leader, so freezing its
  -- numbers would put a figure in the scoring tables that no rule may read.
  INSERT INTO public.scoring_version_label (version_id, kind, label, points)
  SELECT _version_id, kind, lower(trim(value)), max(points)
    FROM public.quality_options
   WHERE kind IN ('label', 'safety_label') AND trim(coalesce(value, '')) <> ''
   GROUP BY kind, lower(trim(value));

  IF to_regclass('public.quality_label_attribution') IS NOT NULL THEN
    EXECUTE '
      INSERT INTO public.scoring_version_excluded_label (version_id, label)
      SELECT $1, lower(trim(label)) FROM public.quality_label_attribution
       WHERE counts_against_leader = false AND btrim(coalesce(label, '''')) <> ''''
       GROUP BY lower(trim(label))'
      USING _version_id;
  END IF;

  -- Unchanged from 20260827093000, active filter included: a hidden department cannot
  -- be picked on the form, so whether it would have charged is not a question this
  -- version needs an answer to.
  INSERT INTO public.scoring_version_excluded_department (version_id, department)
  SELECT _version_id, lower(btrim(value))
    FROM public.quality_options
   WHERE kind = 'department'
     AND active = true
     AND counts_against_leader = false
     AND btrim(coalesce(value, '')) <> ''
   GROUP BY lower(btrim(value));
END $$;

-- =====================================================================
-- 4. The rule itself: a hazard charges what it is priced at, and nothing else
-- =====================================================================

CREATE OR REPLACE FUNCTION public.action_points_at(
  _domain text,
  _severity text,
  _labels text[],
  _validation_status text,
  _department text,
  _version_id bigint)
RETURNS integer
LANGUAGE plpgsql STABLE SET search_path TO 'public' AS $$
DECLARE
  _norm     text[];
  _excluded text[];
  _kind     text;
  _charge   integer;
  _grade    integer;
  _cap      numeric;
  _from     date;
BEGIN
  IF _validation_status = 'rejected' THEN RETURN 0; END IF;

  -- Which price list applies. The domain decides, and it decides for the whole action:
  -- a safety occurrence is priced by the hazard list and by nothing else.
  _kind := CASE WHEN _domain = 'safety' THEN 'safety_label' ELSE 'label' END;

  -- countsAgainstLeaderDepartment: one department per action, so this is a veto. A
  -- blank department still counts — leaving the field empty must not quietly remove a
  -- deviation from somebody's score, the same rule the blank label list follows below.
  IF btrim(coalesce(_department, '')) <> ''
     AND EXISTS (SELECT 1 FROM public.scoring_version_excluded_department d
                  WHERE d.version_id = _version_id
                    AND d.department = lower(btrim(_department)))
  THEN
    RETURN 0;
  END IF;

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
      ON v.version_id = _version_id AND v.kind = _kind AND v.label = l
   WHERE NOT (l = ANY(_excluded));

  -- The ceiling in force on the date this action's own version opened, not today's.
  SELECT valid_from INTO _from FROM public.scoring_version WHERE id = _version_id;
  IF _from IS NOT NULL THEN
    SELECT max(value) INTO _cap
      FROM public.leader_scorecard_threshold
     WHERE name = 'CAP_LabelPoints'
       AND valid_from <= _from
       AND (valid_to IS NULL OR valid_to >= _from);
  END IF;
  IF _cap IS NOT NULL THEN
    _charge := LEAST(_charge, _cap::integer);
  END IF;

  -- Safety stops here. The priced hazard is the whole charge and the grade never adds
  -- to it: otherwise every occurrence would start charging the moment somebody graded
  -- it, and reporting a near miss would stop being free. Mirrors the same early return
  -- in `livePoints`.
  IF _domain = 'safety' THEN RETURN _charge; END IF;

  SELECT coalesce(points, 0) INTO _grade
    FROM public.scoring_version_severity
   WHERE version_id = _version_id AND severity = _severity;

  RETURN GREATEST(_charge, coalesce(_grade, 0));
END $$;

COMMENT ON FUNCTION public.action_points_at(text, text, text[], text, text, bigint) IS
  'O gemeo SQL de actionPoints() em src/lib/qualityConstants.ts, contra uma versao datada. Desde 20260828090000 uma ocorrencia de seguranca e cobrada pelo preco do seu perigo — e so por ele, nunca pela gravidade. Mudar um, mudar o outro.';

-- =====================================================================
-- 5. Re-freeze the OPEN version so it holds the hazard prices too
-- =====================================================================
--
-- Only the open one. Closed versions are the record of what past actions were charged
-- and re-snapshotting them would re-score history, which is the one thing 20260822090000
-- exists to prevent. The open version has no hazard rows until this runs, which would
-- read as "every hazard is unpriced" — true today, since nothing has been priced yet,
-- and it stops being true the moment somebody types a number.

DO $$
DECLARE _open bigint;
BEGIN
  SELECT id INTO _open FROM public.scoring_version WHERE valid_to IS NULL ORDER BY valid_from DESC LIMIT 1;
  IF _open IS NOT NULL THEN
    PERFORM public.scoring_version_snapshot(_open);
  END IF;
END $$;


-- ================================================================
-- BLOCO 19
-- 20260829090000_seed_leader_line_assignments.sql
-- ================================================================

-- The weekly board had nothing to draw, so nobody could fill it in.
--
-- leader_weekly_scorecard holds zero rows. The screen was read as unused — a training
-- problem, or people not seeing the point. It is neither. scorecard_week_board(), from
-- 20260819090000, opens with FROM public.leader_line_assignment and joins line_leaders
-- and lines onto it. That table has never had a row, so the RPC returns nothing for
-- EVERY week, LeaderScorecardWeekPage renders an empty board, and there is no control
-- anywhere in the app that adds a line to it: nothing in src/ writes
-- leader_line_assignment. Twelve people hold the role that may fill a scorecard and not
-- one of them was ever shown a row to fill.
--
-- WHERE THESE SEVEN COME FROM, and what they are worth. They are not a declaration by
-- anyone. They were inferred from daily_allocations (is_leader) over the last weeks:
-- for each line_leaders row, the area that person led on most days. Only the seven who
-- appeared on exactly ONE area are here. Eleven more had a dominant area but rotated
-- across two to five — Juliano appeared on five — and a dominant area out of five is a
-- guess wearing a number. One, "Pedro", matches two different employees (Pedro Correia
-- and Pedro De Assis) and cannot be resolved from data at all. Eleven of the 29 never
-- appear on the board. All of those are deliberately absent: this seeds what is safe to
-- assert and leaves the rest to a person.
--
-- Matching had to be done on the FIRST NAME. line_leaders stores first names only —
-- "Alice", "Kaz" — because the one place that creates a leader is a free-text field in
-- IntouchImportDialog. employees stores full names. Comparing the whole string matches
-- two of 29, and only because those two happen to carry a surname. This is the same
-- missing-surname trap the TimeMoto import already hit.
--
-- Ids are written out rather than resolved by name at apply time. A name lookup inside
-- an INSERT is a silent no-op when the spelling drifts, and "thiago souza" is already
-- stored lowercase where the rest are not. Each id carries its name in a comment so a
-- reviewer can check the pair without a query. All seven were verified to resolve to
-- exactly one active line_leaders row and one lines row.
--
-- Line 5 gets TWO leaders (Everton and Vagner) and that is not a mistake: the table is
-- keyed on neither column alone and the board is one row per assignment, so a line with
-- two leaders appears twice. valid_from/valid_to exist so this can be corrected without
-- deleting history.
--
-- THIS IS DATA, NOT SCHEMA, and it is in a migration because ad-hoc DDL and DML against
-- this database is how two wrong views got created outside the ledger this week. A pair
-- that turns out wrong is corrected by closing it with valid_to, not by editing this
-- file. The durable fix is a screen for managing assignments, which does not exist yet.

INSERT INTO public.leader_line_assignment (leader_id, line_id, valid_from)
SELECT v.leader_id, v.line_id, DATE '2026-08-17'
FROM (VALUES
  ('e7792f1a-f375-4e16-94b7-3c4cf4da4789'::uuid,  -- Lucas
   '57756a3e-fe14-4b71-a18d-61054af9ee9a'::uuid), -- Line 1
  ('7e7f1558-d904-4280-ad9c-84a62e7a43f0'::uuid,  -- thiago souza
   'e4a17e5e-3923-460a-acfd-93e3b8a67e06'::uuid), -- Line 2
  ('857877f4-f4de-45f2-9052-e450ea25a553'::uuid,  -- Rafael Tosta
   '54c45628-40b9-40a8-84f8-ec9649e112b2'::uuid), -- Line 4
  ('de958b79-443a-4f8e-8184-b9af13449c00'::uuid,  -- Everton
   '113151ed-5fd9-4fc7-9fdd-a7c5a6fae5ba'::uuid), -- Line 5
  ('a6ce2f23-012e-46cd-ae17-35dd065df13c'::uuid,  -- Vagner
   '113151ed-5fd9-4fc7-9fdd-a7c5a6fae5ba'::uuid), -- Line 5
  ('466ca641-0c04-4226-9ddc-2d7404d27a3a'::uuid,  -- Ailton
   '85d20033-25ef-4b69-90fe-993f2e52ffd2'::uuid), -- Line 6
  ('f6c3d1d7-193c-46c9-a244-09d63ebbab24'::uuid,  -- Muriel
   'f5f8703e-a220-49d7-8c58-f0cb24d2be45'::uuid)  -- Tablet Line
) AS v(leader_id, line_id)
WHERE NOT EXISTS (
  SELECT 1 FROM public.leader_line_assignment a
   WHERE a.leader_id = v.leader_id AND a.line_id = v.line_id);

DO $$
DECLARE _n integer;
BEGIN
  SELECT count(*) INTO _n FROM public.leader_line_assignment;
  RAISE NOTICE 'leader_line_assignment tem % atribuicoes. O quadro semanal passa a ter linhas.', _n;
END $$;


-- ================================================================
-- BLOCO 20
-- 20260830090000_the_first_plan_for_a_cell_never_reached_the_planner.sql
-- ================================================================

-- O primeiro plano de uma celula nunca chegava ao Planner.
--
-- `trg_sync_items_target_from_rag` nasceu a 27/06 como AFTER UPDATE OF plan_qty. Um
-- plano escrito numa celula que ainda nao tem linha em rag_weekly_entries e um INSERT
-- - `RAGWeeklyPage.commitValue` chama `onSave` quando `entryMap` nao tem a chave - por
-- isso o gatilho nao disparava e `production_items.target_qty` ficava com o que la
-- estivesse. Nao e um caso de canto: e exactamente a primeira vez que se planeia cada
-- linha/turno, que e quando o numero e escrito.
--
-- O outro lado do mesmo defeito estava no frontend: o "Sync from Planner & Downtime"
-- somava os target_qty e escrevia o total por cima do plan_qty. Com o gatilho a nao
-- disparar no INSERT, o que a Sync trazia de volta era o alvo velho dos SKUs - e o
-- quadro perdia o plano acordado. Ver src/lib/ragPlanOwnership.ts.
--
-- Aqui trata-se so da metade que vive na base de dados: o gatilho passa a cobrir o
-- INSERT. A funcao nao muda de logica, ganha uma guarda - num INSERT nao ha OLD, e
-- `NEW.plan_qty IS NOT DISTINCT FROM OLD.plan_qty` e falso mesmo quando o plano e zero
-- ou nulo, o que poria a zero os alvos de uma sessao so por alguem ter criado a linha
-- para escrever um comentario ou um tempo de paragem.

CREATE OR REPLACE FUNCTION public.sync_items_target_from_rag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _session_id uuid;
  _sum_target numeric;
  _n int;
  _new_plan numeric := COALESCE(NEW.plan_qty, 0);
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Uma linha criada sem plano nao e uma instrucao para zerar o Planner.
    IF _new_plan <= 0 THEN
      RETURN NULL;
    END IF;
  ELSIF NEW.plan_qty IS NOT DISTINCT FROM OLD.plan_qty THEN
    RETURN NULL;
  END IF;

  SELECT id INTO _session_id
    FROM public.production_sessions
   WHERE session_date = NEW.entry_date AND line = NEW.line AND shift = NEW.shift
   LIMIT 1;
  IF _session_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(COALESCE(target_qty, planned_qty, 0)), 0), COUNT(*)
    INTO _sum_target, _n
    FROM public.production_items
   WHERE session_id = _session_id;

  IF _n = 0 THEN RETURN NULL; END IF;

  IF _sum_target > 0 THEN
    -- Scale proportionally to existing targets.
    UPDATE public.production_items
       SET target_qty  = ROUND(COALESCE(target_qty, planned_qty, 0) * _new_plan / _sum_target),
           planned_qty = ROUND(COALESCE(target_qty, planned_qty, 0) * _new_plan / _sum_target),
           updated_at  = now()
     WHERE session_id = _session_id;
  ELSE
    -- Even split when no prior target exists.
    UPDATE public.production_items
       SET target_qty  = ROUND(_new_plan / _n),
           planned_qty = ROUND(_new_plan / _n),
           updated_at  = now()
     WHERE session_id = _session_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_items_target_from_rag ON public.rag_weekly_entries;
CREATE TRIGGER trg_sync_items_target_from_rag
AFTER INSERT OR UPDATE OF plan_qty ON public.rag_weekly_entries
FOR EACH ROW EXECUTE FUNCTION public.sync_items_target_from_rag();

COMMENT ON FUNCTION public.sync_items_target_from_rag() IS
  'Reescala production_items.target_qty quando um plano da RAG e criado ou alterado. rag_weekly_entries.plan_qty e a fonte de verdade do plano; production_items segue-a. Um INSERT sem plano nao mexe em nada.';


-- ================================================================
-- BLOCO 21
-- 20260831090000_a_price_is_not_the_same_right_as_a_quantity.sql
-- ================================================================

-- `stock.pricing` is admin-only in the matrix and governs nothing anywhere.
--
-- The matrix says `"stock.pricing": ["admin"]` and describes it as "See and edit part
-- unit prices and financial values." No screen asks for it and no policy mentions it.
-- What actually decides who edits a price today is `stock.manage` in the UI — which
-- StockPage reads to draw the whole edit dialog, price field included — and, in the
-- database, the plain UPDATE policies on `products`: admin, manager, supervisor and
-- maintenance_manager. Four roles where the matrix names one, and an admin turning
-- `stock.pricing` off changes nothing for any of them.
--
-- A price is not the same right as a quantity. Adjusting stock after a part is used is
-- the job most of those roles are there to do; changing what the part is worth is a
-- financial figure, and the matrix has said so all along.
--
-- Row-level security cannot express this: the right depends on WHICH column moved, and
-- a policy only ever sees the whole row. So it is a trigger, and it fires only when
-- `price` actually changes — `IS DISTINCT FROM`, not "price was in the statement".
-- That distinction is the whole design. `useUpdateProduct` sends every column on every
-- save, price included, so a trigger keyed on the statement rather than on the value
-- would refuse every ordinary product edit by a manager and teach them the app is
-- broken. This refuses exactly one thing: a price that moved, by somebody without the
-- right to move it.
--
-- The permission is read with `has_action` (20260813094905), so the switch on the
-- Permissions page is the switch, not a second list written here that nobody can edit.
-- That is the point: `stock.pricing` becomes true rather than being deleted.

CREATE OR REPLACE FUNCTION public.enforce_product_pricing_permission()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $$
BEGIN
  -- A price that did not move needs no right. An INSERT with no price, or a zero
  -- price, is a part being catalogued rather than valued — the add form leaves the
  -- field empty and sends nothing.
  IF TG_OP = 'INSERT' THEN
    IF NEW.price IS NULL OR NEW.price = 0 THEN
      RETURN NEW;
    END IF;
  ELSE
    IF NEW.price IS NOT DISTINCT FROM OLD.price THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NOT public.has_action(auth.uid(), 'stock.pricing', ARRAY['admin']::app_role[]) THEN
    RAISE EXCEPTION
      'Changing a part price needs the stock.pricing permission.'
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN NEW;
END;
$$;

COMMENT ON FUNCTION public.enforce_product_pricing_permission() IS
  'Refuses a products.price that moved when the caller lacks stock.pricing. Fires on '
  'the value, never on the statement: useUpdateProduct sends price on every save, so '
  'gating the statement would refuse every ordinary product edit.';

DROP TRIGGER IF EXISTS trg_products_pricing_permission ON public.products;
CREATE TRIGGER trg_products_pricing_permission
  BEFORE INSERT OR UPDATE ON public.products
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_product_pricing_permission();


-- ================================================================
-- BLOCO 22
-- 20260901090000_the_verdict_asks_the_matrix_who_may_give_it.sql
-- ================================================================

-- The two switches that already worked, and could not be turned off.
--
-- `enforce_quality_validation` is the audit gate: who may rule on a quality action,
-- and who may approve its closure. It has always enforced them properly — and it has
-- always enforced them against two role lists written into the function body:
--
--   _is_quality := _is_admin OR has_role(_uid,'quality_supervisor');
--   _is_manager := _is_admin OR has_role(_uid,'manager') OR has_role(_uid,'maintenance_manager');
--
-- Those agree with the matrix exactly — `quality.validate` is admin + quality_supervisor,
-- `quality.close` is admin + manager + maintenance_manager. Nothing is wrong today.
--
-- What is wrong is that the agreement is a coincidence maintained by hand. The
-- Permissions page shows both switches; an admin turning `quality.validate` off for
-- the quality_supervisor changes the menu, changes what the screen offers, and changes
-- nothing here. The verdict still goes through. A switch that lies about the audit
-- gate is worse than no switch, because the person who flicked it believes it.
--
-- So the lists are replaced by `has_action` (20260813094905), which reads
-- `role_permission_overrides` — the switches themselves — and falls back to the
-- baseline when nobody has overridden anything. The baselines passed below are the
-- two lists above, unchanged, so on a database where nothing is overridden this
-- migration changes no behaviour at all. That is the point: it makes the switches
-- true without moving anybody's access.
--
-- Nothing else in the function changes. `_uid IS NULL` still lets backend paths
-- through, a closed action still has to be reopened before its verdict moves, closure
-- still needs a verdict first, and withdrawing a verdict still withdraws the
-- signature. `_is_admin` is gone because `has_action` already resolves admin to true
-- on its own — see its CASE — so keeping it would have been a third statement of the
-- same rule.

CREATE OR REPLACE FUNCTION public.enforce_quality_validation()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _is_quality boolean;
  _is_manager boolean;
  _verdict_changed boolean := new.validation_status IS DISTINCT FROM old.validation_status;
  _closure_changed boolean := (new.closed_at IS NULL) IS DISTINCT FROM (old.closed_at IS NULL);
BEGIN
  IF NOT _verdict_changed AND NOT _closure_changed THEN RETURN new; END IF;

  -- Backend paths (cron, service key) have no auth.uid(); RLS keeps anon out.
  IF _uid IS NULL THEN RETURN new; END IF;

  -- The Permissions page decides, not a list written here. Baselines are the roles
  -- this function named until 20260901090000, so an un-overridden database is
  -- unchanged.
  _is_quality := has_action(_uid, 'quality.validate', ARRAY['admin','quality_supervisor']::app_role[]);
  _is_manager := has_action(_uid, 'quality.close', ARRAY['admin','manager','maintenance_manager']::app_role[]);

  IF _verdict_changed THEN
    -- A closed action is a filed record. Changing its verdict changes a leader's
    -- score after the fact, so it takes a manager reopening it first — and that
    -- reopening is in the history.
    IF old.closed_at IS NOT NULL AND new.closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'This action is closed. A manager must reopen it before the verdict can change.';
    END IF;

    IF new.validation_status IN ('validated','rejected') AND NOT _is_quality THEN
      RAISE EXCEPTION 'Only Quality or an admin can validate or reject a quality action.';
    END IF;

    IF new.validation_status = 'validated' THEN
      -- The evidence check stood here. See 20260827090000: the upload it required was
      -- removed from the screen, so it could only ever refuse.
      new.validated_by := COALESCE(new.validated_by, _uid);
      new.validated_at := COALESCE(new.validated_at, now());
    ELSE
      -- Withdrawing the verdict withdraws the signature with it.
      new.validated_by := NULL;
      new.validated_at := NULL;
    END IF;
  END IF;

  IF _closure_changed THEN
    IF NOT _is_manager THEN
      RAISE EXCEPTION 'Only a manager or an admin can approve the closure of a quality action.';
    END IF;
    IF new.closed_at IS NOT NULL THEN
      IF new.validation_status NOT IN ('validated','rejected') THEN
        RAISE EXCEPTION 'Quality must validate or reject this action before it can be closed.';
      END IF;
      new.closed_by := COALESCE(new.closed_by, _uid);
      new.closed_at := COALESCE(new.closed_at, now());
    ELSE
      new.closed_by := NULL;
    END IF;
  END IF;

  RETURN new;
END
$function$;

COMMENT ON FUNCTION public.enforce_quality_validation() IS
  'The quality audit gate. Who may rule and who may close is read from the Permissions '
  'page via has_action (quality.validate, quality.close), not from a role list held '
  'here. Since 20260901090000; the baselines are the roles it named before, so an '
  'un-overridden database behaves identically.';


-- ================================================================
-- BLOCO 23
-- 20260902090000_the_office_admin_migration_stopped_halfway.sql
-- ================================================================

-- 20260728020000 is called `office_admin_broad_access`. It was not broad enough.
--
-- `production_office_admin` arrived on 28/07 with a matrix entry, a menu, and a
-- migration granting it access. That migration covered `work_orders` and
-- `production_targets` and stopped. Five tables it was given rights to in the matrix
-- never heard of it: machines, line_leaders, mobile_assets, problem_descriptions and
-- products.
--
-- These are not five independent oversights. They are one migration that stopped
-- halfway, and the symptom has been the same on all five for a month: the switch on
-- the Permissions page is on, the menu draws the screen, the person clicks Save and
-- gets an RLS refusal. A button that fails with a Postgres error is not a finished
-- system.
--
-- The write policies are replaced rather than added to. Each table had one policy per
-- role — "Admins can manage machines", "Managers can manage machines", "Supervisors
-- can manage machines" — which is the same hand-written second list of roles that
-- `has_action` exists to remove, and adding a sixth policy would have grown it. One
-- policy per table now, reading the Permissions page.
--
-- TWO ROLES BEYOND production_office_admin MOVE, and they are named here rather than
-- worked around:
--
--   * mobile_assets gains maintenance_manager
--   * problem_descriptions gains supervisor
--
-- Both hold those actions in the matrix and have been refused by the database since
-- the tables were made. The alternative was a baseline of "whatever the old policies
-- happened to allow, plus one role", which is a third list agreeing with neither the
-- matrix nor the policies — exactly the defect being removed. The matrix is the
-- baseline, or there is no point.
--
-- SELECT policies are untouched: who may READ these tables is a separate question and
-- this migration does not answer it. `products` keeps its admin-only DELETE, because
-- deleting a part is not `stock.manage` and StockPage already says so.

-- machines — machines.manage
DROP POLICY IF EXISTS "Admins can manage machines" ON public.machines;
DROP POLICY IF EXISTS "Managers can manage machines" ON public.machines;
DROP POLICY IF EXISTS "Supervisors can manage machines" ON public.machines;
CREATE POLICY "machines write by matrix" ON public.machines
  FOR ALL TO authenticated
  USING (public.has_action(auth.uid(), 'machines.manage',
         ARRAY['admin','manager','supervisor','production_office_admin']::app_role[]))
  WITH CHECK (public.has_action(auth.uid(), 'machines.manage',
         ARRAY['admin','manager','supervisor','production_office_admin']::app_role[]));

-- line_leaders — leaders.manage
DROP POLICY IF EXISTS "line_leaders_write_mgr" ON public.line_leaders;
CREATE POLICY "line_leaders write by matrix" ON public.line_leaders
  FOR ALL TO authenticated
  USING (public.has_action(auth.uid(), 'leaders.manage',
         ARRAY['admin','manager','production_office_admin']::app_role[]))
  WITH CHECK (public.has_action(auth.uid(), 'leaders.manage',
         ARRAY['admin','manager','production_office_admin']::app_role[]));

-- mobile_assets — assets.manage (also restores maintenance_manager)
DROP POLICY IF EXISTS "Admins manage mobile_assets" ON public.mobile_assets;
DROP POLICY IF EXISTS "Managers manage mobile_assets" ON public.mobile_assets;
CREATE POLICY "mobile_assets write by matrix" ON public.mobile_assets
  FOR ALL TO authenticated
  USING (public.has_action(auth.uid(), 'assets.manage',
         ARRAY['admin','manager','maintenance_manager','production_office_admin']::app_role[]))
  WITH CHECK (public.has_action(auth.uid(), 'assets.manage',
         ARRAY['admin','manager','maintenance_manager','production_office_admin']::app_role[]));

-- problem_descriptions — problems.manage (also restores supervisor)
DROP POLICY IF EXISTS "Admins can manage problem_descriptions" ON public.problem_descriptions;
DROP POLICY IF EXISTS "Managers can manage problem_descriptions" ON public.problem_descriptions;
CREATE POLICY "problem_descriptions write by matrix" ON public.problem_descriptions
  FOR ALL TO authenticated
  USING (public.has_action(auth.uid(), 'problems.manage',
         ARRAY['admin','manager','supervisor','production_office_admin']::app_role[]))
  WITH CHECK (public.has_action(auth.uid(), 'problems.manage',
         ARRAY['admin','manager','supervisor','production_office_admin']::app_role[]));

-- products — stock.manage. INSERT and UPDATE only: DELETE stays admin-only, and the
-- price column stays behind stock.pricing (20260831090000).
DROP POLICY IF EXISTS "Admins can insert products" ON public.products;
DROP POLICY IF EXISTS "Admins can update products" ON public.products;
DROP POLICY IF EXISTS "Managers can insert products" ON public.products;
DROP POLICY IF EXISTS "Managers can update products" ON public.products;
DROP POLICY IF EXISTS "Maint mgr and supervisor insert products" ON public.products;
DROP POLICY IF EXISTS "Maint mgr and supervisor update products" ON public.products;
CREATE POLICY "products insert by matrix" ON public.products
  FOR INSERT TO authenticated
  WITH CHECK (public.has_action(auth.uid(), 'stock.manage',
         ARRAY['admin','manager','supervisor','maintenance_manager','production_office_admin']::app_role[]));
CREATE POLICY "products update by matrix" ON public.products
  FOR UPDATE TO authenticated
  USING (public.has_action(auth.uid(), 'stock.manage',
         ARRAY['admin','manager','supervisor','maintenance_manager','production_office_admin']::app_role[]))
  WITH CHECK (public.has_action(auth.uid(), 'stock.manage',
         ARRAY['admin','manager','supervisor','maintenance_manager','production_office_admin']::app_role[]));

-- ================================================================
-- BLOCO 24
-- 20260903090000_a_part_the_screen_cannot_say_where_to_find.sql
-- ================================================================

-- A part the screen cannot say where to find.
--
-- `/dashboard/stock` knows a part's name, code, line, category, price, quantity and
-- minimum. The warehouse's own list — the `anstockcontrol` app the Stock module is
-- absorbing — knows four more things about the same part, and they are the four an
-- engineer standing in front of the shelves actually needs: what it IS (description),
-- what it goes ON (machine), where it LIVES (location), and what it LOOKS like
-- (photo). Without them the 137 spare parts are a list of codes.
--
-- All four are nullable and none is back-filled here: the parts already in `products`
-- were entered without them, and inventing a location is worse than leaving it blank.
-- The Stock screen prints "—" for what it does not know.
--
-- `photo_url` holds a path in the existing storage bucket, not an image. Nothing
-- uploads to it yet — the photos live in the app being absorbed and have to be
-- carried over by hand — so it is here to be filled, not because it is full.

alter table public.products
  add column if not exists description text,
  add column if not exists machine text,
  add column if not exists location text,
  add column if not exists photo_url text;

-- The category filter reads this on every keystroke of the search box.
create index if not exists products_category_idx on public.products (category);


-- ================================================================
-- BLOCO 25
-- 20260904090000_a_shift_that_ends_at_six_is_written_up_after_six.sql
-- ================================================================

-- The gap at the handover: a shift stays writable for thirty minutes after it ends.
--
-- Production is entered at the end of a run, not while the machine is filling, so an
-- operator who finishes at 17:55 is still typing at 18:05. The window has been 15
-- minutes since 30/07 (20260730100000), which was enough for the database — the write
-- at 18:05 was never refused.
--
-- What was wrong was upstream of the database. The screen picked the shift from the
-- clock, and the clock flips to NIGHT at 18:00 on the dot, so a day operator writing
-- up at 18:05 had already been handed the night's session. The quantity was accepted
-- and filed under the wrong shift. Nothing errored, which is why it went unnoticed:
-- the day came up short and the night came up long, and both looked like real numbers.
--
-- The screen now asks which shift is being written whenever both are open, and the
-- window widens from 15 to 30 minutes to fit what the floor actually does. Widening it
-- is only safe BECAUSE the question is asked: the reason it was cut from an hour to 15
-- minutes on 30/07 was that a silent window that long lets the incoming crew log a full
-- run into the shift before theirs. With an explicit choice at the door, the length of
-- the window stops being the thing that protects the record.
--
-- Only operators are gated by this. admin, manager and maintenance_manager writes never
-- consult is_session_locked(), so a late correction is still possible and still audited.

CREATE OR REPLACE FUNCTION public.session_write_deadline(_session_date date, _shift text)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT CASE UPPER(COALESCE(_shift, 'DAY'))
    WHEN 'NIGHT' THEN ((_session_date + 1)::text || ' 06:30')::timestamp AT TIME ZONE 'Europe/London'
    ELSE (_session_date::text || ' 18:30')::timestamp AT TIME ZONE 'Europe/London'
  END;
$function$;

COMMENT ON FUNCTION public.session_write_deadline(date, text) IS
  'Last moment an operator may write to a shift: 18:30 for DAY, 06:30 next day for NIGHT (Europe/London) — 30 minutes after the shift ends. Mirrored by SHIFT_GRACE_MINUTES in src/lib/shifts.ts; the two must move together.';


-- ================================================================
-- BLOCO 26
-- 20260905090000_the_queue_that_swept_itself_slower_every_day.sql
-- ================================================================

-- The cleanup that got slower every day until it took the database with it.
--
-- On 26/08/2026, between 03:06 and 04:38 UTC (04:06–05:38 on the floor), every screen
-- in the app timed out at once: production_items, work_orders, profiles,
-- quality_options, rpc:get_user_role — tables with nothing in common. That pattern is
-- never one slow query. It is the instance itself with no I/O left.
--
-- WHAT IT WAS. `pg_net` keeps every HTTP response it has made in `net._http_response`
-- and sweeps the table on a timer, deleting anything past `pg_net.ttl` (6 hours,
-- default). Measured on 26/08:
--
--   net._http_response      372 live rows
--                        18585 pages, 52 MB heap        <- 1000x more than the rows need
--                          664 kB index, for 372 rows
--   sum(length(content))    0.1 MB                      <- the actual data
--   last_autovacuum        (null)                       <- has NEVER run
--   autovacuum_count            0
--   n_live_tup                  8                       <- the stats say 8. There are 372.
--
-- And in pg_stat_statements, the sweep itself:
--
--   WITH rows AS (SELECT ctid FROM net._http_response WHERE created < now() - $1
--                 ORDER BY created LIMIT $2) DELETE ...
--     calls 71322 · mean 323 ms · MAX 1227182 ms   <- 20.5 minutes, in one run
--
-- THE CYCLE, which is why it never recovered on its own. The sweep deletes rows every
-- minute; the dead tuples are never reported to the stats collector, so autovacuum
-- reads "8 live, 0 dead" and concludes there is nothing to do; the space is never
-- reclaimed; the heap grows; the next sweep has more pages to walk to find the same few
-- rows. Each day it is slower than the day before. At 20 minutes of random I/O it
-- starves everything else, which is when pg_cron starts reporting `job startup timeout`
-- (126 times that morning — it could not even open a connection) and a one-row
-- `insert into cron.job_run_details` takes 99 seconds.
--
-- WHAT THIS FIXES AND WHAT IT DOES NOT. This file stops the cycle from restarting: it
-- gives the table an autovacuum policy that does not depend on the broken statistics,
-- and an hourly VACUUM that keeps the pages reusable. It CANNOT reclaim the 52 MB
-- already lost — that needs `VACUUM FULL`, which takes an ACCESS EXCLUSIVE lock and
-- cannot run inside a transaction, so it cannot live in a migration. Run it once, by
-- hand, and see docs/apply-passo-3 for the note:
--
--   VACUUM (FULL, ANALYZE) net._http_response;
--
-- On 372 rows it takes well under a second. Without it, this file prevents the next
-- 52 MB but still walks today's.
--
-- WHY NOT JUST LOWER pg_net.ttl. It is a `configuration file` setting, so changing it
-- needs a restart of a managed instance, and it treats the symptom: at 6 hours the
-- table holds roughly a thousand rows, which is nothing. The table is not big. It is
-- BLOATED, and a shorter TTL deletes more often into the same unreclaimed heap.
--
-- The table is UNLOGGED (relpersistence = 'u'), holds HTTP responses nobody reads back,
-- and is emptied on any crash by design. Nothing here risks business data.

-- =====================================================================
-- 1. An autovacuum policy that does not trust the statistics
--
-- Absolute thresholds with a scale factor of zero: "after 100 changes", not "after 20%
-- of a row count we know to be wrong". The scale factor is exactly what made the
-- default policy unreachable on a table whose n_live_tup reads 8.
-- =====================================================================

DO $$
BEGIN
  EXECUTE $ddl$
    ALTER TABLE net._http_response SET (
      autovacuum_enabled                  = true,
      autovacuum_vacuum_threshold         = 100,
      autovacuum_vacuum_scale_factor      = 0.0,
      autovacuum_analyze_threshold        = 100,
      autovacuum_analyze_scale_factor     = 0.0,
      autovacuum_vacuum_cost_delay        = 0
    )
  $ddl$;
EXCEPTION
  -- A database without pg_net, or one where the extension's tables are not ours to
  -- alter, is not a reason to fail the whole package. Said out loud rather than
  -- swallowed: if this notice appears, the sweep is still unbounded.
  WHEN undefined_table OR insufficient_privilege THEN
    RAISE NOTICE 'net._http_response nao existe ou nao e alteravel aqui. A limpeza do pg_net continua sem politica.';
END $$;

-- =====================================================================
-- 2. An hourly VACUUM. THIS is the fix — section 1 cannot fire on its own.
--
-- Measured twice, twelve minutes apart, on 26/08/2026 (13:19 and 13:31 UTC):
--
--                        13:19    13:31
--   rows in the table      372      372   <- steady: it inserts and deletes every minute
--   newest response         --   13:31:00 <- 53 seconds old. pg_net is working right now
--   n_tup_ins                8        8   <- frozen
--   n_tup_del                0        0   <- frozen
--   n_dead_tup               0        0   <- frozen
--
-- The sweep is demonstrably running and the collector records none of it. So the earlier
-- reading of this — "the policy helps once the stats are right, and ANALYZE makes them
-- right" — is only half true. ANALYZE fixes n_live_tup, because it counts the rows it
-- finds. Nothing ever fixes n_dead_tup: autovacuum triggers on
-- `n_dead_tup > threshold + scale_factor * n_live_tup`, and the left-hand side is
-- permanently 0. A threshold of 100 never fires. Neither would a threshold of 1.
--
-- Section 1 is therefore a belt with no trousers: harmless, correct if the extension is
-- ever fixed upstream, and inert today. THE CRON BELOW IS THE ONLY THING KEEPING THIS
-- TABLE ALIVE. Do not remove it on the grounds that "the autovacuum policy covers it".
--
-- pg_cron runs its command OUTSIDE a transaction, which is the one place a plain VACUUM
-- can run from in this database — there is no shell here, and a VACUUM sent through the
-- SQL tooling is rejected with "VACUUM cannot run inside a transaction block".
--
-- Not VACUUM FULL: no exclusive lock on a table pg_net writes to every minute. A plain
-- VACUUM marks the pages reusable, which is all that is needed once the heap has been
-- rebuilt by hand the first time.
-- =====================================================================

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron nao esta instalado. Sem limpeza horaria.';
    RETURN;
  END IF;

  -- Idempotent: unschedule by name first, so re-applying the package does not leave two.
  PERFORM cron.unschedule('vacuum-pg-net-responses')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vacuum-pg-net-responses');

  PERFORM cron.schedule(
    'vacuum-pg-net-responses',
    '17 * * * *',   -- off the hour: every other job in this database fires on :00
    'VACUUM (ANALYZE) net._http_response'
  );
END $$;

COMMENT ON EXTENSION pg_net IS
  'HTTP a partir do Postgres. net._http_response e varrida por TTL a cada minuto e a sua '
  'autovacuum nunca correu por si — ver 20260905090000. Se as chamadas comecarem a '
  'expirar em todas as tabelas ao mesmo tempo, medir pg_relation_size(''net._http_response'') '
  'antes de procurar a query lenta: em 26/08/2026 eram 18585 paginas para 372 linhas.';


-- ================================================================
-- BLOCO 27
-- 20260906090000_the_line_alias_that_was_not_a_line.sql
-- ================================================================

-- Three leaders whose scorecard has always read zero, because their line is a name
-- nothing else uses.
--
-- `leader_pins.lines` is how the personal scorecard decides what belongs to a leader:
-- `leader_self_scorecard()` reads it and filters production, RAG and quality actions by
-- line NAME. There is no foreign key on it — it is a `text[]`, typed by hand — and four
-- rows carry the value 'Capsules & Tablets'.
--
-- That string is not in `public.lines`. It is not in `production_sessions.line`, or
-- `rag_weekly_entries.line`, or `production_downtimes.line`, or `quality_actions.line`.
-- It is not a line. It is somebody writing down the AREA a leader covers, in a field
-- that is matched literally against line names.
--
-- Measured on 26/08/2026:
--
--   leader    lines                                sessions  RAG  quality
--   Gill      Capsules & Tablets                          0    0        0
--   Liana     Capsules & Tablets                          0    0        0
--   Muriel    Capsules & Tablets                          0    0        0
--   JULIANO   Capsules & Tablets + Line 1..6            444  560       62   <- saved by the rest
--
-- The work is there. It is filed under the line names the floor actually uses:
--
--   production_sessions, by leader_name
--     Tablet Line ......... 56 sessions — Alice, Gill, Juliano, Liana, Muriel
--     Capsules Machine 1 .. 16 sessions — Fabricio, Gill, Webister
--     Capsules Machine 2 .. 15 sessions — Fabricio, Webister
--
-- So this is not an empty screen because a leader did nothing. It is an empty screen
-- because the key is a string nobody constrained, and three people have been appraised
-- against a card that could never have shown anything.
--
-- WHY THESE THREE LINES AND NOT THE HISTORY. The obvious alternative is to give each
-- leader exactly the lines they have already worked — Gill would get Tablet Line and
-- Capsules Machine 1, Liana and Muriel only Tablet Line. That reads the past as if it
-- were the assignment, and it would silently narrow a leader's card the first time they
-- cover a machine they have not covered before.
--
-- 'Capsules & Tablets' names a group, and the group has three members: the two capsule
-- machines and the tablet line. GEL Line is deliberately NOT one of them — it is neither
-- capsules nor tablets, and its sessions belong to Josiel. Expanding the alias to its
-- members keeps what the person meant and takes nothing away from anyone.
--
-- Corroborated independently by `leader_line_assignment`, the curated leader-to-line
-- table written on 17/08: it maps Muriel to Tablet Line, and every other row in it
-- matches where that leader's sessions actually are.
--
-- AFTER THIS, measured by simulation before it was written:
--
--   Gill / Liana / Muriel   0 -> 87 sessions, 0 -> 85 RAG rows, 0 -> 852 downtimes
--   JULIANO               444 -> 531 sessions
--   orphan values left in leader_pins.lines: 0

-- =====================================================================
-- 1. Expand the alias into the lines it stands for
--
-- Written against the VALUE, not against four leader ids: if the same string was typed
-- into a fifth row tomorrow, this still means the same thing. Idempotent — running it
-- twice is a no-op, because the alias is gone after the first pass.
-- =====================================================================

UPDATE public.leader_pins lp
   SET lines = sub.novo,
       updated_at = now()
  FROM (
    SELECT p.id,
           (SELECT array_agg(DISTINCT v ORDER BY v)
              FROM unnest(
                     array_remove(p.lines, 'Capsules & Tablets')
                     || ARRAY['Capsules Machine 1', 'Capsules Machine 2', 'Tablet Line']
                   ) AS v) AS novo
      FROM public.leader_pins p
     WHERE 'Capsules & Tablets' = ANY(p.lines)
  ) AS sub
 WHERE lp.id = sub.id;

-- The legacy singular column carries the same alias on the same four rows. Nothing
-- reads it — `leader_self_scorecard` uses `lines`, and a row that says "Line 1" while
-- the array says all six proves it has not been maintained — but leaving a known-bad
-- value behind is how the next reader concludes the alias is still in use somewhere.
UPDATE public.leader_pins
   SET line = NULL
 WHERE line = 'Capsules & Tablets';

-- =====================================================================
-- 2. Stop it happening again
--
-- The root cause is not the four rows. It is that `lines` is a free-text array matched
-- against a catalogue nothing checks it against. A CHECK constraint cannot reach another
-- table, so the guard is a trigger.
--
-- It fires on write only: existing rows are not revalidated, so this cannot fail on data
-- already in the table. Verified before writing that the alias was the ONLY orphan value
-- across every row of leader_pins, active or not — so after section 1 there is nothing
-- left for this to trip over.
--
-- P0001 is the code the app's error handler passes through untouched, so the message
-- below is what the person sees, rather than "Something did not load".
-- =====================================================================

CREATE OR REPLACE FUNCTION public.leader_pins_lines_must_exist()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _desconhecidas text[];
BEGIN
  IF NEW.lines IS NULL OR cardinality(NEW.lines) = 0 THEN
    RETURN NEW;
  END IF;

  SELECT array_agg(DISTINCT v ORDER BY v) INTO _desconhecidas
    FROM unnest(NEW.lines) AS v
   WHERE NOT EXISTS (SELECT 1 FROM public.lines l WHERE l.name = v);

  IF _desconhecidas IS NOT NULL THEN
    RAISE EXCEPTION
      'Estas linhas nao existem no catalogo: %. Um lider so pode ser atribuido a uma linha que exista em Lines — se e uma area com varias linhas, escolha-as uma a uma.',
      array_to_string(_desconhecidas, ', ')
      USING ERRCODE = 'P0001';
  END IF;

  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_leader_pins_lines_must_exist ON public.leader_pins;
CREATE TRIGGER trg_leader_pins_lines_must_exist
  BEFORE INSERT OR UPDATE OF lines ON public.leader_pins
  FOR EACH ROW EXECUTE FUNCTION public.leader_pins_lines_must_exist();

COMMENT ON FUNCTION public.leader_pins_lines_must_exist() IS
  'Recusa uma linha que nao exista em public.lines. leader_pins.lines e comparado por NOME '
  'contra production_sessions/rag_weekly_entries/quality_actions, por isso um nome errado nao '
  'da erro nenhum — da um scorecard a zero. Ver 20260906090000: Gill, Liana e Muriel estiveram '
  'assim desde sempre com o valor ''Capsules & Tablets''.';

COMMENT ON COLUMN public.leader_pins.line IS
  'LEGADA — nao usar. A fonte da verdade e leader_pins.lines (text[]), que e o que '
  'leader_self_scorecard() le. Esta coluna chegou a dizer "Line 1" para lideres cujo array '
  'cobre as seis linhas. Mantida so para nao partir leituras antigas; sem escritor.';


-- ================================================================
-- BLOCO 28
-- 20260907090000_the_cron_log_nobody_ever_swept.sql
-- ================================================================

-- The cron log that has been growing since June, and the secret sitting in every row.
--
-- Sibling of 20260905090000. That one is about `net._http_response`, which is BLOATED —
-- 53 MB of heap for 0.1 MB of data. This one is a different failure with the same cause
-- upstream of it: `cron.job_run_details` has never been swept either, but its 94 MB is
-- mostly real. Measured on 26/08/2026:
--
--   rows                          152708
--   approximate real data          58 MB
--   table                          94 MB
--   older than 7 days             131679   <- 86% of it
--   older than 30 days             86819
--   autovacuum_count                   0   last_autovacuum: (null)
--   n_live_tup                         0   <- the statistics are wrong here too
--
-- pg_cron writes one row per job run and NEVER deletes any. There are two jobs firing
-- every minute (`intouch-poll-60s`, `intouch-status-log-60s`) plus eight more, which is
-- roughly 1.8 MB a day, every day, since 24/06. Nothing was ever going to stop it.
--
-- This is not a theoretical cost. `cron.job_run_details` already holds 165 rows reading
-- `job startup timeout` — pg_cron unable to open a connection — and the incident note in
-- 20260905090000 records a single-row insert here taking 99 seconds while the instance
-- was starved.
--
-- THE SECOND REASON, which is why this is not just housekeeping. Each row stores the
-- command that ran, and two of the active jobs carry their `x-cron-secret` as a literal
-- in that command rather than reading it from the vault:
--
--   rows in cron.job_run_details containing the secret in clear text:  114925
--
-- So the shared secret for `intouch-poll` and `calculate-shift-targets` is not in one
-- place that can be tidied — it is in a hundred and fifteen thousand log rows going back
-- to June. Seven-day retention removes 86% of those immediately and the rest within the
-- week.
--
-- WHAT THIS DOES NOT DO, said plainly: it does not rotate the secret, and retention is
-- not a substitute for rotating it. The value has been readable for two months and has
-- to be considered compromised. Rotation needs the edge functions' `CRON_SECRET`
-- environment variable and the job definitions changed together — one without the other
-- returns 401 every minute — and the environment variable is not reachable from a
-- migration. See docs/apply-passo-3/00-LEIA-PRIMEIRO.md for the procedure.
--
-- Nor does it reclaim the 94 MB. A plain VACUUM makes the pages reusable, which is what
-- keeps the table from growing past today's size once 86% of the rows are gone. Handing
-- the space back needs `VACUUM (FULL, ANALYZE) cron.job_run_details;` by hand, alongside
-- the one 20260905090000 already asks for.

-- =====================================================================
-- 1. Delete the backlog
--
-- Seven days is what pg_cron's own documentation suggests and what makes the failure
-- history still useful: the 165 startup timeouts worth investigating are from this week,
-- not from June. Bounded by end_time so a run still in flight is never removed.
-- =====================================================================

DO $$
DECLARE
  _apagadas bigint;
BEGIN
  IF to_regclass('cron.job_run_details') IS NULL THEN
    RAISE NOTICE 'pg_cron nao esta instalado. Nada a limpar.';
    RETURN;
  END IF;

  DELETE FROM cron.job_run_details
   WHERE end_time IS NOT NULL
     AND end_time < now() - interval '7 days';

  GET DIAGNOSTICS _apagadas = ROW_COUNT;
  RAISE NOTICE 'cron.job_run_details: % execucoes com mais de 7 dias apagadas.', _apagadas;
END $$;

-- =====================================================================
-- 2. Keep it that way
--
-- Hourly, at :47 — off the hour, and off :17 where 20260905090000 puts the pg_net
-- vacuum, so the two sweeps never contend for the same minute.
-- =====================================================================

DO $$
BEGIN
  IF to_regclass('cron.job') IS NULL THEN
    RAISE NOTICE 'pg_cron nao esta instalado. Sem retencao.';
    RETURN;
  END IF;

  PERFORM cron.unschedule('purge-cron-history')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-cron-history');

  PERFORM cron.schedule(
    'purge-cron-history',
    '47 * * * *',
    $cmd$DELETE FROM cron.job_run_details WHERE end_time IS NOT NULL AND end_time < now() - interval '7 days'$cmd$
  );

  PERFORM cron.unschedule('vacuum-cron-history')
    WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vacuum-cron-history');

  PERFORM cron.schedule(
    'vacuum-cron-history',
    '52 * * * *',
    'VACUUM (ANALYZE) cron.job_run_details'
  );
END $$;

-- =====================================================================
-- 3. An autovacuum policy, for the same reason as the pg_net table
--
-- n_live_tup reads 0 on a table with 152708 rows, so a policy expressed as a percentage
-- of that number can never be reached. Absolute thresholds instead. As with the pg_net
-- table, treat this as the belt and the cron above as the trousers: the hourly VACUUM is
-- what is actually keeping the table down.
-- =====================================================================

DO $$
BEGIN
  EXECUTE $ddl$
    ALTER TABLE cron.job_run_details SET (
      autovacuum_enabled              = true,
      autovacuum_vacuum_threshold     = 1000,
      autovacuum_vacuum_scale_factor  = 0.0,
      autovacuum_analyze_threshold    = 1000,
      autovacuum_analyze_scale_factor = 0.0
    )
  $ddl$;
EXCEPTION
  WHEN undefined_table OR insufficient_privilege THEN
    RAISE NOTICE 'cron.job_run_details nao e alteravel aqui. A retencao horaria continua a ser a unica defesa.';
END $$;


-- ================================================================
-- BLOCO 29
-- 20260908090000_a_photo_in_the_chat_was_never_going_to_load.sql
-- ================================================================

-- The photo the chat uploaded and could never show.
--
-- `WOChat` uploads to the `wo-photos` bucket and then calls `getPublicUrl()` on it. That
-- bucket is PRIVATE. `getPublicUrl` does not ask the server anything — it builds a
-- `/object/public/...` string locally — so it returns a URL that always looks fine and
-- never serves a byte. Storing it is worse than failing: the dead link is persisted, and
-- the `<img>` renders broken forever.
--
-- Every other photo in this codebase already does the right thing. `useWOPhotos` keeps a
-- `storage_path` and signs it on read via `getWOPhotoUrl`; `usePartPhotos`,
-- `useQualityIssue` and the DM audio all use `createSignedUrl`. WOChat is the one place
-- that was left behind.
--
-- IT HAS ALREADY HAPPENED, once, and the evidence is still in the bucket:
--
--   storage.objects, bucket wo-photos
--     chat/5700b746-345a-43fd-a7b7-2ff10e7ef919/1774529886689_IMG_5607.jpg
--     161051 bytes · image/jpeg · uploaded 2026-03-26 12:58 by Daniel Quiló
--
--   public.wo_messages   0 rows
--
-- The file uploaded. The message never arrived. Between the two sits
--
--     } catch {
--       // silently fail
--     }
--
-- so whoever tried it watched the spinner stop and nothing appear, with no error to
-- report and nothing to act on. That orphan has been sitting there for five months.
--
-- WHY RENAME RATHER THAN ADD. `wo_messages` has zero rows, so there is no data to
-- migrate and no reader to keep working. The column is about to hold a storage path
-- rather than a URL, and a column called `image_url` holding a path is precisely the
-- shape of the next bug — someone will eventually feed it to an `<img src>` again. With
-- the table empty this costs nothing, so it is renamed to what it contains.

ALTER TABLE public.wo_messages RENAME COLUMN image_url TO image_path;

COMMENT ON COLUMN public.wo_messages.image_path IS
  'Caminho no bucket PRIVADO wo-photos (ex.: chat/<wo_id>/<ts>_<ficheiro>.jpg), NUNCA um URL. '
  'O bucket e privado, por isso getPublicUrl() devolve um link morto — assinar na leitura com '
  'getWOPhotoUrl(), como o wo_photos.storage_path faz. Ver 20260908090000.';

-- The same trap, one table over, left explicit so nobody wires it up the fast way.
--
-- `direct_messages.image_url` has no writer at all: the DM screen only records audio, and
-- that already signs. The column is unimplemented rather than broken, which is exactly
-- when somebody reaches for getPublicUrl because "the other one does it".
COMMENT ON COLUMN public.direct_messages.image_url IS
  'SEM ESCRITOR — nada carrega imagens no chat directo (so audio, em dm-audio, que e assinado). '
  'Se vier a ser usada: os buckets deste projecto sao TODOS privados, portanto guardar o caminho '
  'e assinar na leitura. Nunca getPublicUrl(). Ver 20260908090000.';


-- ================================================================
-- BLOCO 30
-- 20260909090000_a_stoppage_cannot_last_less_than_nothing.sql
-- ================================================================

-- A line stoppage that ended before it started, and the KPI that subtracted it.
--
-- Two rows in `downtime_events` have `resumed_at` BEFORE `stopped_at`. Both are stored
-- with a negative `duration_minutes`, and `v_wo_downtime_total` sums that column
-- straight, so each one does not merely fail to count — it takes time OFF the line's
-- recorded downtime.
--
--   WO   line     stopped_at            resumed_at            duration  is_recurrence
--   498  Line 4   13/07 11:56:09        13/07 11:46:50              -9   true
--   918  Line 4   19/08 14:42:14        19/08 05:59:00           -523    true
--
-- Line 4's downtime for 19/08 is understated by eight and a half hours by a single row.
--
-- THE SHAPE THEY SHARE. Two out of 544 events, and not at random — both are
-- `is_recurrence = true`, both `stopped_by_name = 'Line 4'` (the tablet account named
-- after the line, not a person), both resumed by the same person, both on orders that
-- ended `force_closed`. On WO 918 the inherited `resumed_at` (05:59:00) is 52 seconds
-- EARLIER than the order's own `created_at` (05:59:52): it cannot have been typed for
-- this stoppage, because the stoppage did not exist yet. It is the previous episode's
-- resume, still attached when the recurrence was written.
--
-- WHAT THIS DOES NOT CLAIM. I did not isolate the exact statement that leaves it there.
-- Several paths write these fields — `reopen_wo_as_recurrence`, `close_shift_downtime`,
-- `intouch_machine_state_moves_the_order`, `sync_wo_line_status` and the screen itself —
-- and the two I read most closely are correct: the iTouching trigger inserts a
-- recurrence with no `resumed_at` and nulls the order's, and the shift closer only
-- touches orders whose `line_resumed_at` IS NULL, which is exactly why WO 918 slipped
-- past it. Naming a culprit I have not proven would be worse than saying this.
--
-- It does not matter for the fix. With five writers and one impossible state, the guard
-- belongs where every writer has to pass: a constraint. That is the difference between
-- fixing this instance and closing the shape.
--
-- WHY THE TWO ROWS ARE LEFT ALONE. I do not know how long those lines were actually
-- down. WO 918 stopped at 14:42 and its order was auto-closed at 17:00, so 138 minutes
-- is arguable; WO 498 has no closed_at at all and nothing to anchor to. Writing a
-- plausible number into a production KPI is worse than the negative, because the
-- negative is visibly wrong and a fabricated 138 is not. They are left for whoever knows
-- what happened, through `correct_downtime_event()` and the Downtime corrections screen,
-- which records the before and after in `downtime_corrections`. Until then the view
-- floors them at zero: not counted, never subtracted.

-- =====================================================================
-- 1. Stop the next one being written
--
-- NOT VALID, deliberately. It applies to every INSERT and UPDATE from here on, and does
-- NOT re-check the two rows already there — so this cannot fail to apply, and the
-- historical rows stay visible for the correction screen instead of becoming
-- unupdatable. Run `VALIDATE CONSTRAINT` once they have been corrected.
-- =====================================================================

ALTER TABLE public.downtime_events
  DROP CONSTRAINT IF EXISTS downtime_events_resumed_after_stopped;
ALTER TABLE public.downtime_events
  ADD CONSTRAINT downtime_events_resumed_after_stopped
  CHECK (resumed_at IS NULL OR resumed_at >= stopped_at) NOT VALID;

ALTER TABLE public.downtime_events
  DROP CONSTRAINT IF EXISTS downtime_events_duration_not_negative;
ALTER TABLE public.downtime_events
  ADD CONSTRAINT downtime_events_duration_not_negative
  CHECK (duration_minutes IS NULL OR duration_minutes >= 0) NOT VALID;

-- The sibling table the Downtime screen writes. Measured before adding it: zero rows
-- violate either rule, so these are validated on the spot rather than NOT VALID.
ALTER TABLE public.production_downtimes
  DROP CONSTRAINT IF EXISTS production_downtimes_ended_after_started;
ALTER TABLE public.production_downtimes
  ADD CONSTRAINT production_downtimes_ended_after_started
  CHECK (ended_at IS NULL OR ended_at >= started_at);

ALTER TABLE public.production_downtimes
  DROP CONSTRAINT IF EXISTS production_downtimes_duration_not_negative;
ALTER TABLE public.production_downtimes
  ADD CONSTRAINT production_downtimes_duration_not_negative
  CHECK (duration_minutes IS NULL OR duration_minutes >= 0);

-- =====================================================================
-- 2. Keep an impossible row out of the arithmetic
--
-- The floor is per EVENT, not on the total: flooring the sum would let a bad row cancel
-- a good one inside the same order and still report a plausible figure. At zero, a row
-- that cannot be true contributes nothing and takes nothing away.
--
-- Everything else is carried over unchanged from the existing definition, including the
-- open-stoppage clock and the planned-work exemption.
-- =====================================================================

CREATE OR REPLACE VIEW public.v_wo_downtime_total AS
 SELECT de.work_order_id,
    count(*)::integer AS stop_count,
        CASE
            WHEN COALESCE(p.planned, false) THEN 0
            ELSE COALESCE(sum(
              GREATEST(
                COALESCE(de.duration_minutes,
                         (EXTRACT(epoch FROM now() - de.stopped_at) / 60::numeric)::integer),
                0)
            ), 0::bigint)::integer
        END AS total_minutes,
    bool_or(de.resumed_at IS NULL) AS has_open_stop
   FROM downtime_events de
     LEFT JOIN work_orders w ON w.id = de.work_order_id
     LEFT JOIN problem_descriptions p ON lower(p.name) = lower(w.description)
  GROUP BY de.work_order_id, p.planned;

COMMENT ON VIEW public.v_wo_downtime_total IS
  'Minutos de paragem por ordem. Cada evento entra com piso zero: um evento impossivel '
  '(resumed_at < stopped_at) conta 0 em vez de SUBTRAIR do total da linha — ver 20260909090000, '
  'onde a WO 918 tirava 523 minutos ao downtime da Line 4. O piso e por evento e nao sobre a soma, '
  'para que uma linha ma nao possa anular uma boa dentro da mesma ordem.';

COMMENT ON CONSTRAINT downtime_events_resumed_after_stopped ON public.downtime_events IS
  'NOT VALID: aplica-se a escritas novas, nao revalida as 2 linhas historicas (WO 498 e 918). '
  'Depois de essas serem corrigidas pelo ecra de correccoes, correr '
  'ALTER TABLE public.downtime_events VALIDATE CONSTRAINT downtime_events_resumed_after_stopped;';


-- ================================================================
-- BLOCO 31
-- 20260910090000_the_permissions_screen_only_bound_six_tables.sql
-- ================================================================

-- The Permissions screen edits a matrix that 128 of 134 tables never consult.
--
-- `has_action(uid, action, baseline)` is the mechanism this project already has for
-- exactly this: it reads the user's roles, applies whatever `role_permission_overrides`
-- says — the table the Permissions screen writes — and only falls back to the baseline
-- list when there is no override. Admin is always true.
--
-- Counted on 26/08/2026:
--
--   policies in public                                    436
--     consulting the matrix via has_action()                7   across   6 tables
--     carrying a hard-coded list of has_role() ORs        365   across 128 tables
--
--   rows in role_permission_overrides                      62
--
-- So sixty-two decisions were made on that screen, and the database honours the ones
-- that happen to land on six tables. Everywhere else the screen changes what the UI
-- draws and the database goes on deciding from a list frozen into a policy months ago.
--
-- IT FAILS IN BOTH DIRECTIONS, and neither says anything:
--
--   supervisor / stock.view = FALSE      the screen hides Stock from supervisors, and
--                                        `supervisor_read_access` on products keeps
--                                        letting them read all 137 parts through the API
--
--   co_engineer / stock.view (baseline)  the matrix grants it and the route admits them,
--                                        and NO select policy on products names
--                                        co_engineer — so the screen opens and shows
--                                        nothing
--
-- The second shape is the one that hides best. A restrictive SELECT policy does not
-- raise; it returns zero rows. `describeError` reacts to 401, 403 and 42501, so nothing
-- in the app can tell "you have no access" apart from "there is nothing here" — the
-- screen just looks like an empty table. planner on machines, downtime and problems, and
-- supervisor on suppliers, have all been sitting in that state.
--
-- WHY NOT JUST ADD THE MISSING ROLES. Adding `planner` to three policies and
-- `co_engineer` to one fixes today's four and leaves the mechanism that produced them
-- exactly as it was: two copies of one decision, one in TypeScript and one frozen in
-- SQL, with nothing keeping them in step. The next role added to the matrix drifts the
-- same way, silently, and is found the same way — by somebody staring at an empty
-- screen.
--
-- So the five tables behind those four symptoms are converted to read the matrix. The
-- baselines below are copied from `MATRIX` in src/lib/permissions.ts, so the fallback and
-- the UI now say the same thing, and an override moves both together.
--
-- SCOPE, said plainly: five tables of 128. This is the pattern for the rest, not the
-- rest. The remaining 123 are listed in the audit and are a bigger, separate job — one
-- that has to be done table by table, because each carries its own ownership clauses
-- that a blanket conversion would drop.

-- =====================================================================
-- 1. products — the Stock catalogue
--
-- Five overlapping select policies replaced by one. Writes already go through
-- has_action('stock.manage'), so this makes reads consistent with them.
-- =====================================================================

DROP POLICY IF EXISTS "Engineers and admins can view products" ON public.products;
DROP POLICY IF EXISTS "Managers can view products" ON public.products;
DROP POLICY IF EXISTS "Planner and warehouse view products" ON public.products;
DROP POLICY IF EXISTS "office_admin read" ON public.products;
DROP POLICY IF EXISTS "supervisor_read_access" ON public.products;

CREATE POLICY "products select by matrix" ON public.products
  FOR SELECT TO authenticated
  USING (has_action(auth.uid(), 'stock.view', ARRAY['admin'::app_role, 'manager'::app_role, 'supervisor'::app_role, 'maintenance_manager'::app_role, 'planner'::app_role, 'engineer'::app_role, 'co_engineer'::app_role, 'warehouse'::app_role, 'production_office_admin'::app_role]));

-- =====================================================================
-- 2. machines
-- =====================================================================

DROP POLICY IF EXISTS "Authenticated can view machines" ON public.machines;
DROP POLICY IF EXISTS "supervisor_read_access" ON public.machines;

CREATE POLICY "machines select by matrix" ON public.machines
  FOR SELECT TO authenticated
  USING (has_action(auth.uid(), 'machines.view', ARRAY['admin'::app_role, 'manager'::app_role, 'supervisor'::app_role, 'maintenance_manager'::app_role, 'planner'::app_role, 'engineer'::app_role, 'co_engineer'::app_role, 'operator'::app_role, 'viewer'::app_role, 'warehouse'::app_role, 'production_office_admin'::app_role]));

-- The warehouse policy was FOR ALL, so it granted UPDATE and DELETE on every machine to a
-- role whose only machine permission in the matrix is `machines.view`. The screen never
-- offered it; the API did. Reduced to what the name always implied.
DROP POLICY IF EXISTS "Warehouse can manage machines" ON public.machines;

-- =====================================================================
-- 3. problem_descriptions
-- =====================================================================

DROP POLICY IF EXISTS "Authenticated can view problem_descriptions" ON public.problem_descriptions;
DROP POLICY IF EXISTS "supervisor_read_access" ON public.problem_descriptions;

CREATE POLICY "problem_descriptions select by matrix" ON public.problem_descriptions
  FOR SELECT TO authenticated
  USING (has_action(auth.uid(), 'problems.view', ARRAY['admin'::app_role, 'manager'::app_role, 'supervisor'::app_role, 'maintenance_manager'::app_role, 'planner'::app_role, 'engineer'::app_role, 'co_engineer'::app_role, 'operator'::app_role, 'viewer'::app_role, 'production_office_admin'::app_role]));

-- =====================================================================
-- 4. suppliers
--
-- FOUR ROLES LOSE READ ACCESS HERE, and each was checked before it was allowed to:
--
--   maintenance_manager   1 user   override suppliers.view = FALSE  — the screen already
--   production_office_admin 0      override suppliers.view = FALSE     said no; only the
--   supervisor (products)   0      override stock.view = FALSE         API disagreed
--
--   warehouse             1 user   NO override. `suppliers_select_scoped` named it; the
--                                  matrix never granted `suppliers.view` and the route
--                                  never admitted it. Checked what would break: the only
--                                  reader of this table anywhere in src/ is
--                                  SuppliersPage, which that role cannot open. So this
--                                  removes an API-only privilege that no screen has ever
--                                  used, rather than taking a feature away.
--
-- The first three are the point of the change: an override that says no is supposed to
-- mean no, and until now it only meant "hide the menu item".
-- =====================================================================

DROP POLICY IF EXISTS "suppliers_select_scoped" ON public.suppliers;

CREATE POLICY "suppliers select by matrix" ON public.suppliers
  FOR SELECT TO authenticated
  USING (has_action(auth.uid(), 'suppliers.view', ARRAY['admin'::app_role, 'manager'::app_role, 'supervisor'::app_role, 'maintenance_manager'::app_role, 'planner'::app_role, 'production_office_admin'::app_role]));

-- =====================================================================
-- 5. downtime_events — the one with an ownership clause to keep
--
-- The old policy granted four roles by name, PLUS anyone who stopped or resumed the line
-- themselves, PLUS an operator on the order's own line. Those three are not role
-- permissions and cannot come from the matrix: an operator sees their own line's
-- stoppages because it is theirs, not because of a permission somebody could switch off.
--
-- Carried over verbatim, with only the role half replaced. A blanket conversion here
-- would have taken every operator's own downtime away from them.
--
-- AND THE BASELINE IS NOT THE MATRIX HERE, which is the one deliberate departure in this
-- file. `downtime.view` is granted to every role including operator and viewer, because
-- it gates the Downtime SCREEN — and the route already keeps operators out of that
-- screen. Copying it into the baseline would have handed all twelve operator accounts
-- read access to every stoppage on every line through the API, which no screen offers
-- and nothing asked for. Simulated before writing: operator and viewer both flipped from
-- no-access to full-access on this table alone.
--
-- So the baseline is the management set — the roles the Downtime route actually admits,
-- plus engineer and co_engineer who read stoppages from the order detail — and operators
-- keep reaching their own through the ownership clause below, exactly as before. This is
-- the one table in this migration where "who may open the screen" and "which rows may be
-- read" are genuinely different questions.
-- =====================================================================

DROP POLICY IF EXISTS "Scoped downtime_events select" ON public.downtime_events;
DROP POLICY IF EXISTS "supervisor_read_access" ON public.downtime_events;

CREATE POLICY "downtime_events select by matrix or ownership" ON public.downtime_events
  FOR SELECT TO authenticated
  USING (
    has_action(auth.uid(), 'downtime.view', ARRAY['admin'::app_role, 'manager'::app_role, 'supervisor'::app_role, 'maintenance_manager'::app_role, 'planner'::app_role, 'engineer'::app_role, 'co_engineer'::app_role, 'production_office_admin'::app_role])
    OR stopped_by = auth.uid()
    OR resumed_by = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.work_orders wo
       WHERE wo.id = downtime_events.work_order_id
         AND (
           wo.operator_id = auth.uid()
           OR (
             has_role(auth.uid(), 'operator'::app_role)
             AND EXISTS (
               SELECT 1 FROM public.operator_line_accounts ola
                WHERE ola.user_id = auth.uid()
                  AND wo.line_id = ANY (ola.line_ids)
             )
           )
         )
    )
  );

COMMENT ON FUNCTION public.has_action(uuid, text, app_role[]) IS
  'A pergunta que uma politica RLS deve fazer: le user_roles, aplica role_permission_overrides '
  '(a tabela que o ecra de Permissoes escreve) e so depois cai para a baseline. As baselines devem '
  'ser copia da MATRIX em src/lib/permissions.ts. Uma politica escrita com has_role() em vez desta '
  'e uma segunda copia da decisao, que o ecra de Permissoes nao consegue mover — ver 20260910090000, '
  'onde 365 de 436 politicas ainda estao assim.';


-- ================================================================
-- BLOCO 32
-- 20260911090000_the_hr_roster_four_people_could_read_without_a_screen.sql
-- ================================================================

-- 227 employee records, readable by four people no screen ever showed them to.
--
-- `employees_read_roster` and `esh_read_roster` both grant SELECT to eight roles:
--
--   admin, manager, supervisor, planner, production_office_admin,
--   maintenance_manager, warehouse, quality_supervisor
--
-- Every screen that reads those tables — PeoplePage, LeavePage, AttendancePage,
-- FinanceClosePage, ProductionHeadcountPage, and the panels inside them — is gated by
-- `workforce.view` or `headcount.view`, and BOTH are admin-only in the matrix. So the
-- last three roles on that list hold no HR permission of any kind: not workforce.view,
-- not headcount.view, not attendance.manage. There is no reading of the matrix under
-- which they should have the roster.
--
-- They have it anyway, through the API, and it is not an empty table:
--
--   employees                     227 rows
--     with an email address         34
--     with free-text notes          14
--   employee_shift_history        who moved shift, and when
--
--   real accounts holding those three roles today:
--     quality_supervisor             2
--     maintenance_manager            1
--     warehouse                      1
--
-- Four people, and the columns are name, email, department, position, manager,
-- employment type, start and leave dates, and a notes field somebody has been writing
-- in. This is the one place in the audit where the gap leaks personal data rather than
-- production figures.
--
-- WHY ONLY THESE TWO TABLES. The rest of the HR family looks equally wide and is not:
-- attendance_days, daily_allocations, headcount_matrix and leave_requests grant
-- admin + manager + supervisor + planner + production_office_admin, which is exactly
-- `attendance.manage` in the matrix plus the office-admin role. Those policies agree
-- with a permission that exists; narrowing them would be a decision about whether
-- attendance management should exist at all, and that is not a bug to fix quietly.
--
-- (It is worth someone's attention separately: `attendance.manage` is granted to four
-- roles, and none of them can open the screen that uses it, because headcount.view is
-- admin-only. A permission nobody can exercise. Left alone here on purpose.)
--
-- WHAT THIS CHANGES FOR ADMINS: nothing. has_action returns true for admin
-- unconditionally, and no override grants workforce.view to anyone else, so the roster
-- keeps working exactly as it does today for the ten admin accounts.

-- =====================================================================
-- employees
-- =====================================================================

DROP POLICY IF EXISTS "employees_read_roster" ON public.employees;

CREATE POLICY "employees select by matrix" ON public.employees
  FOR SELECT TO authenticated
  USING (has_action(auth.uid(), 'workforce.view', ARRAY['admin'::app_role]));

-- =====================================================================
-- employee_shift_history
--
-- Same eight roles, same reasoning. Who changed shift and on what date is the same
-- personnel record, one column narrower.
-- =====================================================================

DROP POLICY IF EXISTS "esh_read_roster" ON public.employee_shift_history;

CREATE POLICY "employee_shift_history select by matrix" ON public.employee_shift_history
  FOR SELECT TO authenticated
  USING (has_action(auth.uid(), 'workforce.view', ARRAY['admin'::app_role]));

COMMENT ON TABLE public.employees IS
  'Registo de pessoal — 227 linhas, com email, departamento, chefia e notas em texto livre. '
  'Leitura por has_action(''workforce.view''), que hoje e so admin. Ate 27/08/2026 a politica '
  'nomeava oito papeis, incluindo warehouse, quality_supervisor e maintenance_manager, que nao '
  'tem permissao de RH nenhuma na matriz e nenhum ecra que leia esta tabela — quatro contas reais '
  'liam o roster inteiro pela API. Ver 20260911090000.';
