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
-- BLOCO 1
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
-- BLOCO 2
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
-- BLOCO 3
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
-- BLOCO 4
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
-- BLOCO 5
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
-- BLOCO 6
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
-- BLOCO 7
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
-- BLOCO 8
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
-- BLOCO 9
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
-- BLOCO 9b
-- 20260827120000_blender_number_ceiling.sql
--
-- Numerado 9b e nao 10 para nao renumerar os sessenta e oito blocos que se seguem:
-- este chegou ao repositorio depois deles e pertence aqui pela data. A ordem do
-- ficheiro continua a ser a ordem de aplicacao.
-- ================================================================

-- The blend number is a running count, and 99 was a wall it reaches on its own.
--
-- `blender_number` is not the machine. It is the blend's number within its batch,
-- and it climbs for as long as the batch runs: CRE250 on batch A26213 went 30 → 35
-- across two days, and batch B26188 reached 69 in five. A batch running a fortnight
-- walks through 99 with nobody mistyping anything, and the operator on shift that
-- night would have met
--   new row for relation "production_blender_entries" violates check constraint
--   "production_blender_entries_blender_number_check"
-- for doing the job correctly. That message was already filed twice as an API_ERROR
-- against Line 4 on 26/08, from a batch code landing in the blender box.
--
-- 999 is three digits of headroom against a smallint that holds 32767, and it still
-- catches a five-digit batch code — the mistake that actually happens. The ceiling
-- is mirrored in src/lib/blenderLabel.ts, which now refuses out-of-range figures on
-- the screen so this constraint stops being a user-facing error message.
ALTER TABLE public.production_blender_entries
  DROP CONSTRAINT IF EXISTS production_blender_entries_blender_number_check;

ALTER TABLE public.production_blender_entries
  ADD CONSTRAINT production_blender_entries_blender_number_check
  CHECK (blender_number >= 1 AND blender_number <= 999);

-- ================================================================
-- BLOCO 10
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
-- BLOCO 11
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
-- BLOCO 12
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
-- BLOCO 13
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
-- BLOCO 14
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
-- BLOCO 15
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
-- BLOCO 16
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
-- BLOCO 17
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
-- BLOCO 18
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
-- BLOCO 19
-- 20260906090000_the_line_alias_that_was_not_a_line.sql
-- ================================================================
-- BLOCO 20
-- 20260906085832_a2c099fd-0327-4168-ba58-6b5206d823b7.sql
-- ================================================================

ALTER TABLE public.system_settings
  ADD COLUMN IF NOT EXISTS rag_api_base_url text;


-- ================================================================
-- BLOCO 21
-- 20260906090000_the_leader_the_tablet_wrote_but_never_linked.sql
-- ================================================================

-- The leader the tablet wrote down but never linked.
--
-- A shift leader lives in two columns on production_sessions: `leader_id`, a link to
-- line_leaders, and `leader_name`, free text. The floor tablet only ever wrote the
-- name — the operator types who they are and hits sync — while the Intouch import
-- writes both. Measured on 27/08/2026:
--
--   production_sessions                          563 rows
--     leader_id set                               81   (14%)
--     leader_name only, no link                  344   (61%)   <- this migration
--     neither                                    139   (25%)   <- genuinely nobody
--
-- WHAT IT COST. Production Control asked "does this session have a leader?" in three
-- places by looking at the link, and answered the same question in the row itself by
-- looking at the name. The same session read "Gill" in the leader column and
-- "NO LEADER" on the bay plate two centimetres above it, and the amber no-leader
-- andon was lit on 482 of 563 rows. A warning that is always on is not a warning.
-- The reading was fixed in code (src/lib/sessionLeader.ts) and the tablet now
-- resolves the name as it saves, so this backfill closes the set rather than opening
-- a habit.
--
-- It also cost the leader as an entity: the weekly scorecards and the per-line
-- assignment join on `leader_id`, so 61% of the shifts that had a leader were absent
-- from every one of those numbers.
--
-- WHAT THIS DOES. Links the 344 by name, case-insensitively and with runs of
-- whitespace collapsed — the same key `resolveLeader` uses in the app, so the two
-- cannot drift into disagreeing. All 28 distinct names resolve to exactly one row of
-- line_leaders; the count below is 344 of 344, with none ambiguous, and was measured
-- before this was written.
--
-- WHAT IT REFUSES TO DO. A name matching two leaders is left exactly as it is:
-- picking one at random would put half of one person's shifts on the other's account
-- and nobody would ever notice, which is the worst way for a number to be wrong.
-- There are none today; the guard is here so there are none tomorrow either. And
-- sessions with no name at all are not touched — those 139 really did run without a
-- leader recorded, and the andon should still light for them.
--
-- Idempotent: it only ever considers rows where leader_id is null.
--
-- UNDOING IT. The rows it is about to change are copied into a table first, so the
-- undo is exact rather than a guess. It has to be exact: once leader_id is filled,
-- "leader_id is null and leader_name is not null" no longer finds these rows, and
-- there would be nothing left to tell them apart from the 81 that were already
-- linked. To put them back:
--
--   update production_sessions s
--      set leader_id   = b.leader_id_before,
--          leader_name = b.leader_name_before
--     from backfill_20260906_leader_id b
--    where s.id = b.session_id;

begin;

create table if not exists backfill_20260906_leader_id (
  session_id         uuid primary key references production_sessions(id) on delete cascade,
  leader_id_before   uuid,
  leader_name_before text,
  backfilled_at      timestamptz not null default now()
);

-- Nobody reads this table from the app; it exists for a person with the SQL editor
-- on the day something looks wrong. Locked down so it cannot become a side door.
alter table backfill_20260906_leader_id enable row level security;

insert into backfill_20260906_leader_id (session_id, leader_id_before, leader_name_before)
select s.id, s.leader_id, s.leader_name
  from production_sessions s
 where s.leader_id is null
   and s.leader_name is not null
on conflict (session_id) do nothing;

with matched as (
  select
    s.id                as session_id,
    count(l.id)         as hits,
    -- array_agg and not min(): Postgres has no min(uuid). With hits = 1 enforced
    -- below there is exactly one row to take, so which one is not a question.
    (array_agg(l.id))[1]   as leader_id,
    (array_agg(l.name))[1] as leader_name
  from production_sessions s
  join line_leaders l
    on lower(regexp_replace(btrim(l.name),        '\s+', ' ', 'g'))
     = lower(regexp_replace(btrim(s.leader_name), '\s+', ' ', 'g'))
  where s.leader_id is null
    and s.leader_name is not null
  group by s.id
)
update production_sessions s
   set leader_id   = m.leader_id,
       -- The roster's spelling wins, so one person is one name everywhere.
       leader_name = m.leader_name
  from matched m
 where s.id = m.session_id
   and m.hits = 1;

commit;


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
-- BLOCO 22
-- 20260907090000_the_cron_log_nobody_ever_swept.sql
-- ================================================================
-- BLOCO 23
-- 20260906192425_5e111a04-958b-4a14-87e9-2915c5ef1300.sql
-- ================================================================

-- 1. Columns on the existing records table -------------------------------------
ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'pm',
  ADD COLUMN IF NOT EXISTS external_id text,
  ADD COLUMN IF NOT EXISTS external_url text,
  ADD COLUMN IF NOT EXISTS external_status text,
  ADD COLUMN IF NOT EXISTS external_priority text,
  ADD COLUMN IF NOT EXISTS external_updated_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS assignee_name text,
  ADD COLUMN IF NOT EXISTS due_date timestamptz,
  ADD COLUMN IF NOT EXISTS title text,
  ADD COLUMN IF NOT EXISTS error_type text,
  ADD COLUMN IF NOT EXISTS needs_classification boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS last_synced_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS quality_actions_external_unique
  ON public.quality_actions (source, external_id)
  WHERE external_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS quality_actions_needs_classification_idx
  ON public.quality_actions (needs_classification)
  WHERE needs_classification;

-- 2. Configurable classification rules -----------------------------------------
CREATE TABLE IF NOT EXISTS public.sc_classification_rules (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  -- which part of the SafetyCulture action this rule looks at
  match_field text NOT NULL DEFAULT 'label'
    CHECK (match_field IN ('label','template','site','asset','custom_field','title','description','priority')),
  -- optional custom-field key when match_field = 'custom_field'
  match_key text,
  match_value text NOT NULL,
  match_mode text NOT NULL DEFAULT 'contains'
    CHECK (match_mode IN ('equals','contains','regex')),
  -- what the rule sets on the imported record
  category text,            -- e.g. LABELS / PAPERWORK
  error_type text,          -- e.g. Missing spec
  department text,
  label text,               -- one of quality_options(kind='label')
  severity text,
  priority integer NOT NULL DEFAULT 100,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sc_classification_rules TO authenticated;
GRANT ALL ON public.sc_classification_rules TO service_role;
ALTER TABLE public.sc_classification_rules ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sc rules readable by staff"
  ON public.sc_classification_rules FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','manager','maintenance_manager','quality_supervisor','supervisor']::app_role[])
    OR public.is_owner(auth.uid())
  );

CREATE POLICY "sc rules editable by admin"
  ON public.sc_classification_rules FOR ALL TO authenticated
  USING (public.has_role(auth.uid(),'admin'::app_role) OR public.is_owner(auth.uid()))
  WITH CHECK (public.has_role(auth.uid(),'admin'::app_role) OR public.is_owner(auth.uid()));

CREATE TRIGGER trg_sc_rules_updated BEFORE UPDATE ON public.sc_classification_rules
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 3. Sync state -----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sc_sync_state (
  id boolean PRIMARY KEY DEFAULT true CHECK (id),
  cursor_modified_after timestamptz,
  last_attempt_at timestamptz,
  last_success_at timestamptz,
  last_error text,
  actions_imported integer NOT NULL DEFAULT 0,
  actions_updated integer NOT NULL DEFAULT 0,
  actions_skipped integer NOT NULL DEFAULT 0,
  error_count integer NOT NULL DEFAULT 0,
  enabled boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.sc_sync_state (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

GRANT SELECT ON public.sc_sync_state TO authenticated;
GRANT ALL ON public.sc_sync_state TO service_role;
ALTER TABLE public.sc_sync_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sc state readable by staff"
  ON public.sc_sync_state FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','manager','maintenance_manager','quality_supervisor','supervisor']::app_role[])
    OR public.is_owner(auth.uid())
  );

CREATE TRIGGER trg_sc_state_updated BEFORE UPDATE ON public.sc_sync_state
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- 4. Integration log --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.sc_sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL
    CHECK (event IN ('received','created','updated','skipped_duplicate','deleted',
                     'auth_error','api_error','classification_error','line_leader_error',
                     'rate_limited','timeout','sync_started','sync_finished')),
  action_id text,
  action_title text,
  message text,
  details jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS sc_sync_logs_created_idx ON public.sc_sync_logs (created_at DESC);

GRANT SELECT ON public.sc_sync_logs TO authenticated;
GRANT ALL ON public.sc_sync_logs TO service_role;
ALTER TABLE public.sc_sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "sc logs readable by staff"
  ON public.sc_sync_logs FOR SELECT TO authenticated
  USING (
    public.has_any_role(auth.uid(), ARRAY['admin','manager','maintenance_manager','quality_supervisor','supervisor']::app_role[])
    OR public.is_owner(auth.uid())
  );

-- 5. Seed the initial, editable classification vocabulary --------------------------
INSERT INTO public.sc_classification_rules (match_field, match_value, match_mode, category, error_type, label, priority)
VALUES
  ('label','Missing spec','contains','LABELS','Missing spec','Label',10),
  ('label','Wrong label','contains','LABELS','Wrong label','Label',10),
  ('label','Missing label','contains','LABELS','Missing label','Label',10),
  ('label','Incorrect information','contains','LABELS','Incorrect information','Label',10),
  ('label','Damaged label','contains','LABELS','Damaged label','Label',10),
  ('label','Missing paperwork','contains','PAPERWORK','Missing paperwork','Paperwork',10),
  ('label','Wrong paperwork','contains','PAPERWORK','Wrong paperwork','Paperwork',10),
  ('label','Incomplete paperwork','contains','PAPERWORK','Incomplete paperwork','Paperwork',10),
  ('title','missing spec','contains','LABELS','Missing spec','Label',50),
  ('title','wrong label','contains','LABELS','Wrong label','Label',50),
  ('title','missing label','contains','LABELS','Missing label','Label',50),
  ('title','incorrect information','contains','LABELS','Incorrect information','Label',50),
  ('title','damaged label','contains','LABELS','Damaged label','Label',50),
  ('title','missing paperwork','contains','PAPERWORK','Missing paperwork','Paperwork',50),
  ('title','wrong paperwork','contains','PAPERWORK','Wrong paperwork','Paperwork',50),
  ('title','incomplete paperwork','contains','PAPERWORK','Incomplete paperwork','Paperwork',50),
  ('title','paperwork','contains','PAPERWORK','Other','Paperwork',90),
  ('title','label','contains','LABELS','Other','Label',95)
ON CONFLICT DO NOTHING;


-- ================================================================
-- BLOCO 24
-- 20260906195247_31631f78-262f-4f97-9ea7-626bf324a398.sql
-- ================================================================

ALTER TABLE public.sc_sync_state
  ADD COLUMN IF NOT EXISTS page_token text,
  ADD COLUMN IF NOT EXISTS backfill_complete boolean NOT NULL DEFAULT false;


-- ================================================================
-- BLOCO 25
-- 20260906200607_29a80c21-8a99-412f-a18c-22e0052e91fe.sql
-- ================================================================

ALTER TABLE public.sc_classification_rules
  ADD COLUMN IF NOT EXISTS line_name text;

COMMENT ON COLUMN public.sc_classification_rules.line_name IS
  'When set, a matching rule also attributes the action to this production line (must match public.lines.name).';


-- ================================================================
-- BLOCO 26
-- 20260906203101_937d7927-00f5-4621-a8ad-38df9729b4e0.sql
-- ================================================================

ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS external_created_at timestamptz,
  ADD COLUMN IF NOT EXISTS external_site text,
  ADD COLUMN IF NOT EXISTS external_asset text,
  ADD COLUMN IF NOT EXISTS external_template text,
  ADD COLUMN IF NOT EXISTS external_assignees text[] NOT NULL DEFAULT '{}'::text[],
  ADD COLUMN IF NOT EXISTS classification_status text NOT NULL DEFAULT 'needs_review';

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'quality_actions_classification_status_check'
  ) THEN
    ALTER TABLE public.quality_actions
      ADD CONSTRAINT quality_actions_classification_status_check
      CHECK (classification_status IN ('classified','needs_review'));
  END IF;
END $$;

UPDATE public.quality_actions
   SET classification_status = CASE WHEN needs_classification THEN 'needs_review' ELSE 'classified' END
 WHERE source = 'safetyculture';

UPDATE public.quality_actions
   SET classification_status = 'classified'
 WHERE source IS DISTINCT FROM 'safetyculture';

ALTER TABLE public.sc_sync_state
  ADD COLUMN IF NOT EXISTS import_from timestamptz NOT NULL DEFAULT '2026-09-01T00:00:00Z',
  ADD COLUMN IF NOT EXISTS actions_found integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actions_ignored integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS actions_needs_review integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS window_start timestamptz,
  ADD COLUMN IF NOT EXISTS window_end timestamptz;


-- ================================================================
-- BLOCO 27
-- 20260906203957_3f671e37-e0d2-45b0-9e42-237f374b2961.sql
-- ================================================================

insert into public.sc_classification_rules
  (match_field, match_value, match_mode, line_name, priority, active)
values
  ('title', '(^|[^a-z0-9])6[ab]([^a-z0-9]|$)', 'regex', 'Line 6', 8, true),
  ('title', 'capsule ?2|caps ?2', 'regex', 'Capsules Machine 2', 8, true),
  ('title', '\(caps\)|\(capsule\)|capsule line', 'regex', 'Capsules Machine 1', 12, true);

insert into public.sc_classification_rules
  (match_field, match_value, match_mode, department, priority, active)
values
  ('title', 'k53', 'contains', 'Facilities', 15, true),
  ('title', 'warehouse', 'contains', 'Warehouse', 15, true),
  ('title', 'goods in|good in|supplier', 'regex', 'Goods In', 15, true),
  ('title', 'blender room|blue blender', 'regex', 'Blender Room', 15, true),
  ('template', 'forklift|ppt checklist', 'regex', 'Logistics', 18, true),
  ('template', 'emergency lighting', 'contains', 'Facilities', 18, true);

insert into public.sc_classification_rules
  (match_field, match_value, match_mode, category, error_type, priority, active)
values
  ('title', 'not recorded', 'contains', 'DOCUMENTATION', 'Check not recorded', 40, true),
  ('title', 'missing the last check|missing filling checks|missing fillers check|missing checks', 'regex', 'DOCUMENTATION', 'Missing check on spec', 40, true),
  ('title', 'missing informations on checklist|missing information on checklist', 'regex', 'DOCUMENTATION', 'Incomplete checklist', 40, true),
  ('title', 'missing finishing time|missing pallet out time|missing date on the signature|missing sign', 'regex', 'DOCUMENTATION', 'Missing signature or time', 40, true),
  ('title', 'incorrectly completed allergen', 'contains', 'DOCUMENTATION', 'Incorrect allergen information', 40, true),
  ('title', 'wrong batch code', 'contains', 'LABELS', 'Wrong batch code', 40, true),
  ('title', 'wrong stickers|wrong sticker', 'regex', 'LABELS', 'Wrong label', 40, true),
  ('title', 'discrepancy between the scoop|scoop size', 'regex', 'LABELS', 'Spec discrepancy', 40, true),
  ('title', 'metal found|piece of metal|on the magnet|on magnet', 'regex', 'FOREIGN BODY', 'Metal on magnet', 40, true),
  ('title', 'black residue|rust|corrosion|steel cable', 'regex', 'FOREIGN BODY', 'Contamination risk', 42, true),
  ('title', 'construction waste|wood waste', 'regex', 'HYGIENE', 'Waste not removed', 42, true),
  ('title', 'underweight|net weight|nominal weight|incorrect collagen bag weight', 'regex', 'WEIGHT', 'Weight out of specification', 40, true),
  ('title', 'wrong qty', 'contains', 'SUPPLIER', 'Wrong quantity delivered', 40, true),
  ('title', 'dirty|wet pallet|deep cleaning|moisture|pest control|loose curtain', 'regex', 'HYGIENE', 'GMP breach', 44, true),
  ('title', 'doors not locked', 'contains', 'EQUIPMENT', 'CCP equipment not secured', 40, true),
  ('title', 'leakage', 'contains', 'EQUIPMENT', 'Product leakage', 42, true),
  ('title', 'broken|isn''t working|not working|emergency light|flashing strobe|loose roof panel|repair ', 'regex', 'EQUIPMENT', 'Equipment defect', 46, true),
  ('title', 'toolbox|screwdriver|knife|metal cup', 'regex', 'TOOL CONTROL', 'Tool missing from control', 44, true),
  ('title', 'improperly stored', 'contains', 'STORAGE', 'Improper storage', 40, true),
  ('title', 'placed on hold|production hold|sample bags|in hold', 'regex', 'PRODUCT CONTROL', 'Product placed on hold', 46, true);


-- ================================================================
-- BLOCO 28
-- 20260906221500_an_action_belongs_to_a_line_only_if_someone_was_there.sql
-- ================================================================

-- The Quality screen was stating things nobody had checked.
--
-- "Line 4 — Rafael Tosta — 06/09/2026" reads as a settled fact, and three separate
-- claims are folded into it: that the finding was raised inside Production, that the
-- 6th is the day it was RAISED rather than the day it falls due, and that Rafael was
-- on Line 4 that day. The importer verified none of the three.
--
-- The first is measurable right now: of the forty-nine records imported from
-- SafetyCulture, fifteen came from somewhere other than Production — nine of them from
-- site "External" — and every one of them was counted as an operational action.
--
-- These columns give a record somewhere to say what was checked and what was found, so
-- the screen can stop presenting an inference as an observation. The verdict itself is
-- computed in `_shared/safetyculture/classification.ts` and written by the classify
-- function; the only thing decided in SQL is the one-off backfill at the bottom, which
-- closes the site hole immediately rather than waiting for a deploy.

-- ── The verdict, and the evidence behind it ────────────────────────────────────────
ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS classification text
    CHECK (classification IS NULL OR classification IN
      ('line','leader','quality_error','needs_review','excluded')),
  ADD COLUMN IF NOT EXISTS classification_checks jsonb,
  ADD COLUMN IF NOT EXISTS classification_reasons text[],
  ADD COLUMN IF NOT EXISTS matched_rule_ids uuid[],
  ADD COLUMN IF NOT EXISTS matched_rule_names text[],
  ADD COLUMN IF NOT EXISTS classified_at timestamptz;

COMMENT ON COLUMN public.quality_actions.classification IS
  'What the record is, once the gates have run: line, leader, quality_error, '
  'needs_review, or excluded (raised outside Production). NULL means it has not been '
  'classified yet — not that it passed.';

COMMENT ON COLUMN public.quality_actions.classification_checks IS
  'One state per gate: {"site","action_date","worker","line"} each ok | failed | '
  'unknown. `unknown` is deliberately not `failed`: employee_attendance is sparse, so '
  '"no row for that day" and "a row saying absent" are different statements and only '
  'the second one blocks.';

COMMENT ON COLUMN public.quality_actions.matched_rule_names IS
  'Denormalised on purpose. A rule can be renamed or deleted after it classified a '
  'record, and the drawer still has to be able to say what decided this row.';

-- The operational screen reads by class and date, and only ever for imported rows.
CREATE INDEX IF NOT EXISTS quality_actions_classification_idx
  ON public.quality_actions (classification, recorded_at DESC)
  WHERE source = 'safetyculture';

-- ── Rules gain a name and a verdict of their own ───────────────────────────────────
-- Until now a rule could say which line or which error type an action was about, but
-- not what the action IS. Without that there is nothing for two rules to disagree
-- about, and a conflict that cannot be expressed cannot be caught.
ALTER TABLE public.sc_classification_rules
  ADD COLUMN IF NOT EXISTS name text,
  ADD COLUMN IF NOT EXISTS classification text
    CHECK (classification IS NULL OR classification IN ('line','leader','quality_error'));

COMMENT ON COLUMN public.sc_classification_rules.classification IS
  'What a match asserts. NULL means the rule only tags (line, error type, department) '
  'and leaves the verdict to the default reading. Two matching rules that name '
  'DIFFERENT classes are a conflict: the record goes to review rather than the higher '
  'priority silently winning, because priority is an ordering, not an arbitrator.';

-- Every rule needs something to show in "Matched Rule". The existing sixty-three were
-- written before the column existed, so they are named after what they already do.
UPDATE public.sc_classification_rules
SET name = COALESCE(
  NULLIF(error_type, ''),
  NULLIF(department, ''),
  NULLIF(line_name, ''),
  match_field || ' ~ ' || left(match_value, 40)
)
WHERE name IS NULL OR name = '';

-- ── The one thing that is safe to decide here ──────────────────────────────────────
-- Site is a plain string comparison with no evidence to weigh, so the backfill cannot
-- drift from the TypeScript. Everything else is left NULL for the classify pass.
--
-- Note the two cases are NOT the same. A record raised at another site is excluded; a
-- record with no site at all is sent to a human, because dropping a row from the
-- operational view on the strength of an ABSENT field hides it from everybody.
UPDATE public.quality_actions
SET classification = 'excluded',
    classification_checks = jsonb_build_object(
      'site','failed','action_date','unknown','worker','unknown','line','unknown'),
    classification_reasons = ARRAY['site_not_production'],
    classified_at = now()
WHERE source = 'safetyculture'
  AND classification IS NULL
  AND external_site IS NOT NULL
  AND btrim(lower(external_site)) <> 'production';

UPDATE public.quality_actions
SET classification = 'needs_review',
    classification_checks = jsonb_build_object(
      'site','unknown','action_date','unknown','worker','unknown','line','unknown'),
    classification_reasons = ARRAY['site_missing'],
    classified_at = now()
WHERE source = 'safetyculture'
  AND classification IS NULL
  AND (external_site IS NULL OR btrim(external_site) = '');


-- ================================================================
-- BLOCO 29
-- 20260907090000_a_priority_uuid_is_not_a_priority.sql
-- ================================================================
-- BLOCO 30
-- 20260907080000_the_leader_is_whoever_opened_the_line_that_shift.sql
-- ================================================================

-- Fourteen of the twenty-two imported actions carried the wrong leader's name.
--
-- Reported from the floor: the Line 4 actions of 06/09 came out as Rafael Tosta, and
-- Line 4 that morning was Marcio. It is not a data-entry slip. `leader_line_assignment`
-- holds SEVEN rows and every one of them is open ended — "Rafael Tosta has Line 4 from
-- 2026-08-17, no end date" — so every action on a line came out in one name whatever
-- the day and whatever the shift. Twenty-four of the thirty-one active leaders have no
-- assignment at all; Marcio is one of them.
--
-- Measured on 07/09/2026 against `production_sessions`, which is written when somebody
-- opens the line and records the line, the date, the shift and who opened it:
--
--   478b58c4  Line 4  06/09 09:23  Rafael Tosta -> Marcio
--   53949fc3  Line 4  06/09 07:19  Rafael Tosta -> Marcio
--   2cc27aaf  Line 5  04/09 08:48  Vagner       -> Everton
--   b3e8e0c5  Line 2  03/09 23:21  thiago souza -> Henrique
--   fbc300af  Line 5  03/09 19:12  Vagner       -> Cainan
--   b957de80  Line 2  03/09 06:03  thiago souza -> Guilherme
--   c561947a  Line 4  03/09 02:23  Rafael Tosta -> Filipi
--   2f47bcac  Line 3  02/09 18:05  (nenhum)     -> Kleyve
--   31419910  Line 1  02/09 02:53  Lucas        -> Kaz
--   2e8e2f82  Line 6  02/09 02:46  Ailton       -> Henrique
--   b74e5b26  Line 6  02/09 02:39  Ailton       -> Henrique
--   47945bfa  Line 4  01/09 21:19  Rafael Tosta -> Filipi
--   dc9caca7  Line 6  01/09 21:13  Ailton       -> Henrique
--   2b12cb62  Line 2  01/09 15:06  thiago souza -> Guilherme
--
-- Five of those are past midnight. The night shift opens around 17:00 and runs into
-- the next date, so the session that owns an action raised at 02:23 on the 3rd is the
-- one opened at 17:09 on the 2nd. Matching on the calendar date of the action finds
-- nothing for them — and "nothing" was precisely when the standing assignment stepped
-- in and named the day-shift leader instead.
--
-- The permanent fix is in `_shared/safetyculture/leaderOnDuty.ts`, which every future
-- import and re-classification goes through. This is the one-off repair of what is
-- already stored, written the same way: the last session opened on that line at or
-- before the finding, and no more than sixteen hours before it.

-- Sixteen hours, not twelve: `finished_at` is null on every row in
-- `production_sessions`, so nothing records when a shift ended and the window has to
-- stand in for it. Sixteen leaves room for an overrun without letting last night's
-- shift claim this morning's finding.
WITH in_charge AS (
  SELECT qa.id,
         s.leader_name AS session_leader
  FROM public.quality_actions qa
  CROSS JOIN LATERAL (
    SELECT ps.leader_name
    FROM public.production_sessions ps
    WHERE ps.line = qa.line
      AND ps.started_at <= qa.recorded_at
      AND ps.started_at > qa.recorded_at - interval '16 hours'
    ORDER BY ps.started_at DESC
    LIMIT 1
  ) s
  WHERE qa.source = 'safetyculture'
    AND qa.line IS NOT NULL
),
resolved AS (
  -- The session names the leader and nothing else; `production_sessions.leader_id` is
  -- null on every row. Resolve it the way the rest of this schema does: fold the name
  -- and accept it only when exactly ONE leader answers to it. Two rules for one
  -- question would drift, and the drift would be silent.
  SELECT c.id,
         c.session_leader,
         -- Accepted only when exactly ONE leader answers to the name: a name two
         -- people share identifies neither. (No min(uuid) in Postgres, so the
         -- uniqueness is asserted with a count rather than an aggregate.)
         (SELECT ll.id FROM public.line_leaders ll
           WHERE lower(btrim(ll.name)) = lower(btrim(c.session_leader))
             AND (SELECT count(*) FROM public.line_leaders l2
                   WHERE lower(btrim(l2.name)) = lower(btrim(c.session_leader))) = 1
           LIMIT 1) AS leader_id
  FROM in_charge c
  WHERE c.session_leader IS NOT NULL
)
UPDATE public.quality_actions qa
SET leader_name = r.session_leader,
    leader_id = r.leader_id
FROM resolved r
WHERE qa.id = r.id
  AND qa.leader_name IS DISTINCT FROM r.session_leader;

-- Anything the sessions could not speak for keeps whatever it had; it is not silently
-- blanked. The re-classification pass is what decides whether it can stand, and it now
-- reads the sessions too.


-- ================================================================

-- Every imported action scored one point, and the Priority column held a UUID.
--
-- Measured across all 49 records imported from SafetyCulture on 07/09/2026:
--
--   action_no          0/49   the number the floor reads off the SafetyCulture screen
--   labels             2/49   and one of those two says "Label" — a rule's own name
--   severity           0/49
--   priority as text   0/49   all 49 hold a bare UUID
--
-- Four separate causes, not one. Two of them decide the score: `action_points_at`
-- returns GREATEST(label charge, severity grade), and BOTH inputs were empty on every
-- record, so all 49 fell to the default of 1 whatever they described — a metal finding
-- and a missing signature worth the same.
--
-- The priority is its own problem. SafetyCulture answers with `priority_id`, a UUID,
-- and sends no name for it anywhere in the response — checked against the published
-- API schema, not assumed — and there is no endpoint that lists priorities. So the
-- name cannot be derived; it has to be recorded once, here, and the UUID has to be
-- kept because it is the only thing SafetyCulture actually said.

-- ── Keep the id, and stop passing it off as a name ────────────────────────────────
ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS external_priority_id text;

COMMENT ON COLUMN public.quality_actions.external_priority_id IS
  'The priority UUID exactly as SafetyCulture sent it. `external_priority` holds the '
  'readable name, and stays NULL until the UUID is mapped in sc_priorities — a UUID '
  'on screen is not a priority, it is a gap for somebody to close.';

-- ── What the UUIDs mean ───────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.sc_priorities (
  priority_id text PRIMARY KEY,
  name        text NOT NULL,
  -- Maps onto the severity scale that already scores: critical 5, high 4, medium 3,
  -- low 2. Deliberately NOT a second scale — two tables deciding one number drift,
  -- and the drift is silent.
  severity    text CHECK (severity IS NULL OR severity IN ('critical','high','medium','low')),
  rank        integer NOT NULL DEFAULT 100,
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.sc_priorities TO authenticated;
GRANT ALL ON public.sc_priorities TO service_role;
ALTER TABLE public.sc_priorities ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "sc priorities readable by staff" ON public.sc_priorities;
CREATE POLICY "sc priorities readable by staff"
  ON public.sc_priorities FOR SELECT TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Quality owns the severity weights, so Quality owns what a priority grades as.
DROP POLICY IF EXISTS "sc priorities editable by quality" ON public.sc_priorities;
CREATE POLICY "sc priorities editable by quality"
  ON public.sc_priorities FOR ALL TO authenticated
  USING (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'quality_supervisor'::app_role)
    OR public.is_owner(auth.uid())
  )
  WITH CHECK (
    public.has_role(auth.uid(),'admin'::app_role)
    OR public.has_role(auth.uid(),'quality_supervisor'::app_role)
    OR public.is_owner(auth.uid())
  );

DROP TRIGGER IF EXISTS trg_sc_priorities_updated ON public.sc_priorities;
CREATE TRIGGER trg_sc_priorities_updated BEFORE UPDATE ON public.sc_priorities
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

-- The three in use, confirmed by the factory against the SafetyCulture screen.
--
-- They were separated first by their default due window, which is exact and does not
-- overlap: 3 days, 7 days, and 8.99-9.00 days across 49 records. That is what made
-- the question answerable — but the NAMES come from a person who read them off
-- SafetyCulture, not from the due dates. Another organisation's UUIDs are different
-- ones, which is why this is a table and not a list in the code.
INSERT INTO public.sc_priorities (priority_id, name, severity, rank, note) VALUES
  ('02eb40c1-4f46-40c5-be16-d32941c96ec9', 'High',   'high',   10, 'Default due window: 3 days.'),
  ('ce87c58a-eeb2-4fde-9dc4-c6e85f1f4055', 'Medium', 'medium', 20, 'Default due window: 7 days.'),
  ('16ba4717-adc9-4d48-bf7c-044cfe0d2727', 'Low',    'low',    30, 'Default due window: 9 days.')
ON CONFLICT (priority_id) DO NOTHING;

-- ── Move the UUIDs to the column that is meant to hold them ───────────────────────
UPDATE public.quality_actions
SET external_priority_id = external_priority
WHERE source = 'safetyculture'
  AND external_priority_id IS NULL
  AND external_priority ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';

-- ...and put the name where a person reads it.
UPDATE public.quality_actions qa
SET external_priority = p.name
FROM public.sc_priorities p
WHERE qa.source = 'safetyculture'
  AND qa.external_priority_id = p.priority_id
  AND qa.external_priority IS DISTINCT FROM p.name;

-- ── Give the scorer something to grade ────────────────────────────────────────────
-- Only where nothing has graded it already: a severity set by hand, or by a rule
-- written about that kind of finding, is a deliberate judgement and outranks a
-- priority that came off a template default.
--
-- `quality_action_freeze_points` recalculates `points_at_creation` on UPDATE, so this
-- re-scores the 49 records as a side effect of setting the column. That is the point
-- of it: nothing here writes a score directly.
UPDATE public.quality_actions qa
SET severity = p.severity
FROM public.sc_priorities p
WHERE qa.source = 'safetyculture'
  AND qa.external_priority_id = p.priority_id
  AND p.severity IS NOT NULL
  AND qa.severity IS NULL;

-- The labels and the action numbers are NOT repaired here, and cannot be: they were
-- discarded on the way in and were never stored. They arrive on the next sync, now
-- that `parseAction` reads `unique_id` and `buildRecord` keeps `action_label`.


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
-- BLOCO 31
-- 20260908090000_a_photo_in_the_chat_was_never_going_to_load.sql
-- ================================================================
-- BLOCO 32
-- 20260907103222_81e475e2-3d35-4404-92cf-06d8cb3ef665.sql
-- ================================================================

CREATE OR REPLACE FUNCTION public.rag_actual_is_derived()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _floor numeric;
begin
  if new.entry_date >= date '2026-07-30' then
    _floor := public.rag_actual_from_floor(new.entry_date, new.line, new.shift);
    -- The floor wins whenever production was actually logged there. When the
    -- floor has nothing for that shift, the value being written (SharePoint
    -- workbook or a manual edit) is kept instead of being wiped to zero.
    if coalesce(_floor, 0) > 0 then
      new.actual_qty := _floor;
    else
      new.actual_qty := coalesce(new.actual_qty, 0);
    end if;
  elsif tg_op = 'UPDATE' then
    new.actual_qty := old.actual_qty;
  end if;
  return new;
end
$function$;


-- ================================================================
-- BLOCO 33
-- 20260907103552_c97d06c7-fbdf-4358-80fb-3d28387b56b5.sql
-- ================================================================

ALTER TABLE public.rag_weekly_entries
  ADD COLUMN IF NOT EXISTS actual_source text NOT NULL DEFAULT 'manual';

CREATE OR REPLACE FUNCTION public.rag_actual_is_derived()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare
  _floor numeric;
begin
  -- SharePoint is the master source: whatever the workbook says wins.
  if coalesce(new.actual_source, 'manual') = 'sharepoint' then
    new.actual_qty := coalesce(new.actual_qty, 0);
    return new;
  end if;

  if new.entry_date >= date '2026-07-30' then
    _floor := public.rag_actual_from_floor(new.entry_date, new.line, new.shift);
    if coalesce(_floor, 0) > 0 then
      new.actual_qty := _floor;
    else
      new.actual_qty := coalesce(new.actual_qty, 0);
    end if;
  elsif tg_op = 'UPDATE' then
    new.actual_qty := old.actual_qty;
  end if;
  return new;
end
$function$;

CREATE OR REPLACE FUNCTION public.rag_refresh_actual_from_item()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
declare _sid uuid := coalesce(new.session_id, old.session_id);
        _d date; _line text; _shift text;
begin
  select s.session_date, s.line, s.shift into _d, _line, _shift
  from public.production_sessions s where s.id = _sid;
  if _d is null or _d < date '2026-07-30' then return coalesce(new, old); end if;
  update public.rag_weekly_entries r
  set actual_qty = public.rag_actual_from_floor(_d, _line, _shift), updated_at = now()
  where r.entry_date = _d
    and coalesce(r.actual_source, 'manual') <> 'sharepoint'
    and upper(btrim(r.shift)) = upper(btrim(_shift))
    and lower(replace(btrim(r.line), ' ', '')) = lower(replace(btrim(_line), ' ', ''));
  return coalesce(new, old);
end $function$;


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
-- BLOCO 34
-- 20260908142852_14750ae8-98dd-4b3a-8814-88e507854557.sql
-- ================================================================

DROP POLICY IF EXISTS "part_photos_insert" ON storage.objects;
DROP POLICY IF EXISTS "part_photos_update" ON storage.objects;

CREATE POLICY "part_photos_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'part-photos' AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
    OR public.has_role(auth.uid(), 'engineer'::app_role)
    OR public.has_role(auth.uid(), 'co_engineer'::app_role)
    OR public.has_role(auth.uid(), 'warehouse'::app_role)
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
    OR public.has_role(auth.uid(), 'engineer'::app_role)
    OR public.has_role(auth.uid(), 'co_engineer'::app_role)
    OR public.has_role(auth.uid(), 'warehouse'::app_role)
  )
)
WITH CHECK (
  bucket_id = 'part-photos' AND (
    public.has_role(auth.uid(), 'admin'::app_role)
    OR public.has_role(auth.uid(), 'manager'::app_role)
    OR public.has_role(auth.uid(), 'maintenance_manager'::app_role)
    OR public.has_role(auth.uid(), 'supervisor'::app_role)
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
    OR public.has_role(auth.uid(), 'engineer'::app_role)
    OR public.has_role(auth.uid(), 'co_engineer'::app_role)
    OR public.has_role(auth.uid(), 'warehouse'::app_role)
  )
);


-- ================================================================
-- BLOCO 49B
-- 20260908150429_08337551-2ed5-4584-ae29-1e6e22dd2d9c.sql
--
-- Ficava de fora desde 08/09 e é por isso que este pacote estava vermelho antes
-- de qualquer alteração nova. Entra aqui, no seu lugar cronológico, entre
-- 20260908142852 e 20260909090000.
-- ================================================================

ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS resolution_notes text;
COMMENT ON COLUMN public.work_orders.resolution_notes IS 'Engineer resolution notes captured when finishing a work order, stored in English after optional AI polish.';


-- ================================================================
-- 20260908170000_one_verdict_read_by_every_screen.sql
-- ================================================================

-- The leader's own card has to read the verdict too.
--
-- `classifyAction` decides, once per action, whether Production is answerable for it
-- at all, and writes the answer to `quality_actions.classification`. Measured on
-- 08/09/2026 over the 66 SafetyCulture rows: 29 line, 3 leader, 12 needs_review,
-- 4 quality_error, 18 excluded. The last two groups — 22 findings raised in
-- Facilities and Goods In, or logged against Quality itself — have no line and no
-- leader and never could have: they are not a production leader's to answer for.
--
-- Nothing on the Quality screen read that column, so the screen counted all 66,
-- dropped the 22 into `Unassigned`, and made it the largest row of the leader table.
-- `src/lib/actionVerdict.ts` is now the one place that turns the verdict into
-- "counts here / does not", and the log, the KPIs, the leader table and the manager's
-- scorecard all read it.
--
-- This migration is what stops the LEADER'S copy of that scorecard disagreeing with
-- the manager's. src/lib/leaderScorecard.ts opens with the rule: "Two fetch paths,
-- one arithmetic." The manager's path is a PostgREST select whose column list is
-- widened in the same change as this one. The leader's path is this SECURITY DEFINER
-- function, because RLS scopes a line tablet to a single line — and its projection is
-- a fixed list. A column the list does not name is simply absent from the JSON, and
-- `belongsToProduction` reads an absent verdict as "keep it" (which it must: the 69
-- actions typed by hand on the Quality screen carry NULL forever). So without this,
-- the tablet would keep counting all 22 while the manager's card counted none of
-- them. Same leader, same week, two numbers.
--
-- WHY THIS PATCHES INSTEAD OF REPLACING — the same reason 20260822093000 gives, and
-- the same guard. The function is long, nothing here applies migrations, so the repo
-- is a record of intent and the database is the record of fact. This reads the live
-- definition, checks it has the shape it expects, and rewrites only the projection.
-- If the live function has drifted it RAISES rather than guessing.

DO $patch$
DECLARE
  _src text;
  -- The tail of the projection as 20260822093000 left it. Anchoring on the last
  -- column rather than on the whole list keeps this working if a column was added
  -- ahead of it in between — which is exactly what happened to `domain` and
  -- `safety_kind` after 20260822093000 said they were missing.
  _old constant text := 'qa.points_at_creation';
  _new constant text := 'qa.points_at_creation, qa.classification';
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
  IF position('qa.classification' IN _src) > 0 THEN
    RAISE NOTICE 'leader_self_scorecard ja projecta classification. Sem alteracao.';
    RETURN;
  END IF;

  _hits := (length(_src) - length(replace(_src, _old, ''))) / length(_old);

  IF _hits <> 1 THEN
    RAISE EXCEPTION
      'A projeccao de leader_self_scorecard nao tem a forma esperada (% ocorrencias de "%"). '
      'A funcao viva divergiu do que esta migracao conhece: comparar antes de aplicar, e '
      'acrescentar qa.classification a mao. Um cartao de lider que conta 22 accoes que o '
      'cartao do gestor nao conta e o defeito que isto corrige.',
      _hits, _old
      USING ERRCODE = 'raise_exception';
  END IF;

  EXECUTE replace(_src, _old, _new);
  RAISE NOTICE 'leader_self_scorecard passa a projectar classification.';
END $patch$;


-- ================================================================
-- BLOCO 35
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
-- BLOCO 30B
-- 20260909180300_89d1c42f-8cf1-4d4a-89fb-d459c75b0208.sql
-- Stamped between BLOCO 30 and BLOCO 31, so it is numbered between them.
-- ================================================================

-- The Documentation pillar only scores an action carrying the "Paperwork" label
-- (DOCUMENTATION_LABEL in src/lib/qualityConstants.ts). Four ACTIVE rules already
-- name a paperwork failure in their error_type but carried no label, so every action
-- they matched arrived unlabelled and the pillar had nothing to judge.
--
-- Rules touched (all active, priority 40, match_field = title):
--   Check not recorded
--   Incomplete checklist
--   Missing check on spec
--   Missing signature or time
--
-- Only the label is set. No severity, error_type, department or domain changes, no new
-- rule is created, and no existing quality_actions row is backfilled: future imports only.

UPDATE public.sc_classification_rules
SET label = 'Paperwork'
WHERE active
  AND coalesce(trim(label), '') = ''
  AND error_type IN (
    'Check not recorded',
    'Incomplete checklist',
    'Missing check on spec',
    'Missing signature or time'
  );


-- ================================================================
-- BLOCO 36
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
-- BLOCO 33B
-- 20260910173923_89fa597e-d413-4f76-a6fb-873fabba22c9.sql
-- ================================================================

-- rag_weekly_comments: a leitura era `USING (true)`.
--
-- Estes comentários dizem como correu a semana de cada linha e de cada pessoa, e
-- qualquer sessão autenticada os lia — incluindo as 13 contas de tablet de linha, que
-- são partilhadas por quem passa no chão de fábrica. A fuga gémea, em
-- leader_weekly_scorecard, já tinha sido fechada com `is_owner OR <perfis de gestão>`;
-- é esse o padrão seguido aqui.
--
-- Quem lê passa a ser quem detém `rag.view` na matriz (src/lib/permissions.ts) depois da
-- reforma de perfis de 10/09/2026 — admin, manager, maintenance_manager,
-- production_office_admin — mais o owner, a válvula de emergência.

DROP POLICY IF EXISTS "Authenticated can read rag comments" ON public.rag_weekly_comments;

CREATE POLICY "Management reads rag comments"
ON public.rag_weekly_comments
FOR SELECT
TO authenticated
USING (
  is_owner(auth.uid())
  OR has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'maintenance_manager'::app_role)
  OR has_role(auth.uid(), 'production_office_admin'::app_role)
);

-- Escrita: só arrumação, sem alargar nada.
--
-- 1) O UPDATE do supervisor. Perfil reformado a 10/09/2026: ninguém o tem, a policy
--    nunca dá verdade e só engrossa a lista que se lê quando se procura um problema.
DROP POLICY IF EXISTS "supervisor update rag comments" ON public.rag_weekly_comments;

-- 2) O INSERT chamava-se "Admins Managers Supervisors insert rag comments" e o nome
--    deixou de descrever o que faz. Deixava entrar admin, manager e supervisor; o
--    supervisor está reformado, e o production_office_admin já entrava pela policy ALL
--    "office_admin rag comments" sem aparecer neste nome. Recriada com o mesmo efeito
--    real de hoje e alinhada com `rag.comment` na matriz: admin, manager,
--    production_office_admin.
DROP POLICY IF EXISTS "Admins Managers Supervisors insert rag comments" ON public.rag_weekly_comments;

CREATE POLICY "Management writes rag comments"
ON public.rag_weekly_comments
FOR INSERT
TO authenticated
WITH CHECK (
  has_role(auth.uid(), 'admin'::app_role)
  OR has_role(auth.uid(), 'manager'::app_role)
  OR has_role(auth.uid(), 'production_office_admin'::app_role)
);

-- O DELETE de admin e o UPDATE de admin/manager ficam exactamente como estavam, tal
-- como a policy ALL do production_office_admin.

ALTER TABLE public.rag_weekly_comments ENABLE ROW LEVEL SECURITY;


-- ================================================================
-- BLOCO 33C
-- 20260911075414_59d13ec5-b749-43f2-989d-33a2c820ae30.sql
-- ================================================================

-- =====================================================================
-- A machine fault is not the shift leader's, whatever label it carries
-- =====================================================================
--
-- The case: "Batch Code Printing Issue (L5)", 13/08, Line 5, leader Everton, labels
-- `Batch code` + `Maintenance`. The root cause is a printer failure. Attribution today
-- is per LABEL and one attributable label is enough (see countsAgainstLeader in
-- src/lib/qualityConstants.ts, and the AC-6183 note that documents that choice), so
-- `Maintenance` is excluded and worth 0 while `Batch code` still charges 5. The machine
-- fault reaches the leader's score through a side door.
--
-- The fix is NOT to flip the label rule back to a veto — that lever was removed on
-- purpose, because anyone who worked out that adding "Maintenance" to a genuine
-- paperwork error cleared it had a lever nobody audits. A root cause is a different
-- instrument: exactly ONE per action, chosen deliberately, printed in its own column,
-- written to the action's history with a name against it, and writable only by Quality.
-- That is the same reasoning `countsAgainstLeaderDepartment` (20260827093000) already
-- runs on, applied to the field that actually answers "whose failure was this".
--
-- NULLABLE ON PURPOSE. Every row that exists today keeps exactly the score it has
-- today; no history moves, and nothing is back-filled by guesswork.
--
-- What this migration does NOT touch: the gate. A food safety gate still caps the
-- period at CAP_Gate whatever the root cause turns out to be, because a gate records
-- that the event happened on this line in this period, not who was at fault. The gate
-- is computed in `scorecard_*` and in computeLeaderScore over the LABELS, never over
-- `action_points_at`, so a 0 returned here cannot silence one.

-- =====================================================================
-- 1. The column
-- =====================================================================

ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS root_cause_area text;

COMMENT ON COLUMN public.quality_actions.root_cause_area IS
  'A area responsavel pela causa raiz, escolhida em quality_options (kind = root_cause). '
  'Se a opcao tiver counts_against_leader = false, a accao vale 0 pontos, antes de qualquer '
  'aritmetica de labels — ver action_points_at. NULL significa "ainda nao se sabe" e pontua '
  'exactamente como antes desta migracao.';

-- =====================================================================
-- 2. The list lives in the table, never in code
-- =====================================================================
--
-- Same principle as the labels and the departments: which area answers for what is the
-- factory's judgement and it will change. A list in TypeScript would need a deploy.

ALTER TABLE public.quality_options DROP CONSTRAINT IF EXISTS quality_options_kind_check;
ALTER TABLE public.quality_options ADD CONSTRAINT quality_options_kind_check
  CHECK (kind = ANY (ARRAY['label'::text, 'department'::text, 'safety_label'::text,
                           'maintenance_label'::text, 'root_cause'::text]));

-- A root cause is an attribution, not a price. It answers WHOSE, and the labels answer
-- HOW MUCH; letting one carry points would put two prices on one action.
ALTER TABLE public.quality_options DROP CONSTRAINT IF EXISTS quality_options_only_labels_are_priced;
ALTER TABLE public.quality_options ADD CONSTRAINT quality_options_only_labels_are_priced
  CHECK (kind IN ('label', 'safety_label', 'maintenance_label') OR points = 0);

INSERT INTO public.quality_options (kind, value, active, sort, points, is_gate, counts_against_leader)
VALUES
  ('root_cause', 'Production',  true, 10, 0, false, true),
  ('root_cause', 'Quality',     true, 20, 0, false, true),
  ('root_cause', 'Maintenance', true, 30, 0, false, false),
  ('root_cause', 'Warehouse',   true, 40, 0, false, false),
  ('root_cause', 'Engineering', true, 50, 0, false, false),
  ('root_cause', 'Supplier',    true, 60, 0, false, false),
  ('root_cause', 'External',    true, 70, 0, false, false)
ON CONFLICT (kind, value) DO NOTHING;

-- =====================================================================
-- 3. The rule, ahead of every other rule
-- =====================================================================
--
-- Read LIVE from quality_options rather than from a scoring_version_* snapshot, and the
-- difference is deliberate. The versioned tables freeze PRICES — what a Critical or a
-- Foreign Body was worth on a given date — because re-pricing in November must not
-- rewrite July. This is not a price. It is a statement of fact about one action: the
-- printer failed. A fact corrected today was always true, and the freeze machinery's own
-- rule for a corrected fact is that it recomputes against the action's OWN version,
-- which is exactly what happens below in quality_action_freeze_points.

CREATE OR REPLACE FUNCTION public.action_points_at(
  _domain text,
  _severity text,
  _labels text[],
  _validation_status text,
  _department text,
  _root_cause text,
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

  -- The root cause outranks the labels, the department and the grade, because it is the
  -- broader claim: this deviation is somebody else's failure and no label can argue it
  -- back. A blank root cause counts, for the same reason a blank department and a blank
  -- label list count — leaving a field empty must never quietly remove a deviation from
  -- somebody's score.
  IF btrim(coalesce(_root_cause, '')) <> ''
     AND EXISTS (SELECT 1 FROM public.quality_options o
                  WHERE o.kind = 'root_cause'
                    AND lower(btrim(o.value)) = lower(btrim(_root_cause))
                    AND o.counts_against_leader = false)
  THEN
    RETURN 0;
  END IF;

  _kind := CASE WHEN _domain = 'safety' THEN 'safety_label' ELSE 'label' END;

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

  IF _domain = 'safety' THEN RETURN _charge; END IF;

  SELECT coalesce(points, 0) INTO _grade
    FROM public.scoring_version_severity
   WHERE version_id = _version_id AND severity = _severity;

  RETURN GREATEST(_charge, coalesce(_grade, 0));
END $$;

COMMENT ON FUNCTION public.action_points_at(text, text, text[], text, text, text, bigint) IS
  'O gemeo SQL de livePoints() em src/lib/qualityConstants.ts, contra uma versao datada. '
  'Desde esta migracao uma causa raiz que nao seja do lider anula a accao (0) antes de qualquer '
  'aritmetica de labels. Mudar um, mudar o outro — ver src/__tests__/rootCauseParity.test.ts.';

-- =====================================================================
-- 4. Setting a root cause recomputes THAT action, on ITS OWN ruler
-- =====================================================================
--
-- The UPDATE branch already recomputes against NEW.scoring_version_id and stamps
-- points_recalculated_at, which is precisely the behaviour asked for; all it needed was
-- the new argument. current_date is deliberately NOT used here — correcting a fact must
-- not re-score the action on today's scale.

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
      to_jsonb(NEW)->>'department', to_jsonb(NEW)->>'root_cause_area', _v);
    RETURN NEW;
  END IF;

  _v := coalesce(NEW.scoring_version_id,
                 public.scoring_version_at(coalesce(NEW.recorded_at, now())::date));
  NEW.scoring_version_id     := _v;
  NEW.points_at_creation     := public.action_points_at(
    to_jsonb(NEW)->>'domain', NEW.severity, NEW.labels, NEW.validation_status,
    to_jsonb(NEW)->>'department', to_jsonb(NEW)->>'root_cause_area', _v);
  NEW.points_recalculated_at := now();
  RETURN NEW;
END $$;

-- Two live definitions of one rule is the drift this module was rebuilt to stop.
DROP FUNCTION IF EXISTS public.action_points_at(text, text, text[], text, text, bigint);

-- =====================================================================
-- 5. A change of root cause is written down, like any other field change
-- =====================================================================

CREATE OR REPLACE FUNCTION public.log_quality_action_change()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP='INSERT' THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, COALESCE(NEW.recorded_by, auth.uid()), 'created', NULL, NEW.status);
    RETURN NEW;
  END IF;
  IF NEW.status IS DISTINCT FROM OLD.status THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'status', OLD.status, NEW.status);
  END IF;
  IF NEW.severity IS DISTINCT FROM OLD.severity THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'severity', OLD.severity, NEW.severity);
  END IF;
  IF NEW.validation_status IS DISTINCT FROM OLD.validation_status THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'validation_status', OLD.validation_status, NEW.validation_status);
  END IF;
  -- Who moved the charge off a leader, and when. Without this the one field that can
  -- zero an action would be the only one that changed without a name against it.
  IF NEW.root_cause_area IS DISTINCT FROM OLD.root_cause_area THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'root_cause_area', OLD.root_cause_area, NEW.root_cause_area);
  END IF;
  IF (NEW.closed_at IS NULL) IS DISTINCT FROM (OLD.closed_at IS NULL) THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'closure',
            CASE WHEN OLD.closed_at IS NULL THEN 'open' ELSE 'closed' END,
            CASE WHEN NEW.closed_at IS NULL THEN 'reopened' ELSE 'closed' END);
  END IF;
  IF NEW.labels IS DISTINCT FROM OLD.labels THEN
    INSERT INTO public.quality_action_history(action_id, changed_by, field, old_value, new_value)
    VALUES (NEW.id, auth.uid(), 'labels',
            array_to_string(COALESCE(OLD.labels,'{}'), ', '),
            array_to_string(COALESCE(NEW.labels,'{}'), ', '));
  END IF;
  RETURN NEW;
END
$function$;

-- =====================================================================
-- 6. Only Quality may write it
-- =====================================================================
--
-- A trigger rather than a policy, because RLS is row-level: the existing quality_actions
-- UPDATE policy has to keep letting a manager edit a description, and there is no way to
-- say "every column but this one" in a USING clause. Reading is untouched — anybody who
-- can see the action sees the field, which is the whole point of putting the reason for
-- a zero on the screen.
--
-- has_action(), never has_role(): it reads role_permission_overrides first, so the
-- Permissions screen can move this without a migration. The baselines mirror
-- MATRIX["quality.validate"] and MATRIX["quality.manage"] in src/lib/permissions.ts.
--
-- auth.uid() IS NULL is allowed through: that is the service role and the SafetyCulture
-- importer, neither of which sets this field, and refusing them would break the import
-- for a column they never touch.

CREATE OR REPLACE FUNCTION public.guard_quality_root_cause()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public' AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW.root_cause_area IS NULL THEN RETURN NEW; END IF;
  ELSIF NEW.root_cause_area IS NOT DISTINCT FROM OLD.root_cause_area THEN
    RETURN NEW;
  END IF;

  IF auth.uid() IS NULL THEN RETURN NEW; END IF;

  IF public.has_action(auth.uid(), 'quality.validate',
        ARRAY['admin','quality_supervisor']::app_role[])
     OR public.has_action(auth.uid(), 'quality.manage',
        ARRAY['admin','manager','quality_supervisor','production_office_admin']::app_role[])
  THEN
    RETURN NEW;
  END IF;

  RAISE EXCEPTION 'Only Quality may set the root cause of an action.'
    USING ERRCODE = '42501';
END $$;

REVOKE ALL ON FUNCTION public.guard_quality_root_cause() FROM PUBLIC;

-- Named to sort BEFORE trg_enforce_quality_validation and the two freeze triggers:
-- Postgres fires same-timing triggers in name order, and a write that is about to be
-- refused must not first be frozen at a new figure.
DROP TRIGGER IF EXISTS trg_a_quality_root_cause_guard ON public.quality_actions;
CREATE TRIGGER trg_a_quality_root_cause_guard
  BEFORE INSERT OR UPDATE ON public.quality_actions
  FOR EACH ROW EXECUTE FUNCTION public.guard_quality_root_cause();

-- ================================================================
-- BLOCO 33D
-- 20260911075455_d4647bc6-85e1-402b-9177-33ef7b301192.sql
-- ================================================================

-- The guard is a trigger function: nothing should ever call it by name. It arrived with
-- the schema's default EXECUTE grants, which the linter flags (0028/0029) and which are
-- simply wrong for a SECURITY DEFINER function whose only job is to refuse writes.
-- Triggers run as the table owner, so revoking these does not stop it firing.
REVOKE ALL ON FUNCTION public.guard_quality_root_cause() FROM PUBLIC, anon, authenticated;

-- ================================================================
-- BLOCO 31B
-- 20260911090000_a_cron_feeding_a_screen_that_does_not_exist.sql
-- ================================================================

-- 48 pedidos por dia a um site externo para alimentar um ecrã que não existe.
--
-- `refresh-site-banner` corre de 30 em 30 minutos desde 23/07/2026 e continua vivo: a
-- última escrita em `site_banner.updated_at` foi às 08:00 de hoje. A cada passagem,
-- `public.refresh_site_banner()` faz um `extensions.http_get('https://appliednutrition.uk/')`
-- e guarda as og:tags na linha única de `public.site_banner`.
--
-- A CADEIA, do dado até ao pixel — e onde morre:
--
--   cron 'refresh-site-banner'  (*/30 * * * *)        activo
--     -> public.refresh_site_banner()                 escreve
--       -> public.site_banner                         1 linha, actualizada hoje
--         -> src/hooks/useSiteBanner.ts               ZERO importadores
--           -> src/components/SiteBannerImages.tsx    só usado pelo AuthShell
--             -> AuthShell, prop `backgroundImages`   nenhum dos 4 chamadores a passa
--
-- Os quatro sítios que montam o `AuthShell` (três em ResetPassword.tsx, um em Login.tsx)
-- chamam-no sem `backgroundImages`; dentro do componente, `hasBanner` é sempre falso e o
-- `SiteBannerImages` nunca chega a renderizar. Vertical morta de ponta a ponta: o pedido
-- HTTP sai da base de dados, os dados chegam à tabela, e mais nada os lê.
--
-- O QUE ESTE FICHEIRO FAZ: desagenda o job. Nada mais.
--
-- O QUE NÃO FAZ, e é deliberado: a função `refresh_site_banner()`, a tabela
-- `site_banner`, a policy de leitura e o `GRANT` ficam todos onde estão. Desligar o
-- agendamento reverte-se numa linha (`cron.schedule`, com o mesmo nome e a mesma
-- expressão); apagar a função obrigaria a reescrevê-la se um dia se quiser mesmo o
-- banner no ecrã de login. Também não toca em nenhum outro job.
--
-- O `WHERE EXISTS` não é decoração: esta migração vai correr no DESTINO, onde o job
-- nunca terá sido agendado, e `cron.unschedule()` com um nome que não existe levanta
-- excepção e parte a migração. É o mesmo padrão idempotente que o
-- 20260723250000_site_banner.sql já usava antes de agendar.
--
-- VERIFICAÇÃO depois de aplicar:
--   SELECT jobname FROM cron.job WHERE jobname = 'refresh-site-banner';  -- 0 linhas
--   SELECT updated_at FROM public.site_banner;                           -- pára de avançar

SELECT cron.unschedule('refresh-site-banner')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-site-banner');

-- ================================================================
-- BLOCO 37
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


-- ================================================================
-- BLOCO 32C
-- 20260911120000_o_lider_e_quem_abriu_a_linha_naquele_turno.sql
-- ================================================================

-- O board de líderes saía de `leader_line_assignment`. Essa tabela tem SETE linhas e
-- todas sem fim — "Rafael Tosta tem a Line 4 desde 2026-08-17, sem data de término" —
-- por isso a semana de 06/09/2026 mostrava sete cartões: um dono fixo por linha, o
-- mesmo em todas as semanas, e vinte e quatro dos trinta e um líderes activos sem
-- cartão nenhum.
--
-- Medido na base a 11/09/2026, para a semana que termina a 2026-09-06:
--
--   scorecard_week_board('2026-09-06')                      ->  7 linhas
--   pares (líder, linha) em production_sessions nessa semana -> 22 linhas
--
-- `production_sessions` é escrita quando alguém abre a linha e regista a linha, a data,
-- o turno e quem abriu. É o registo de quem esteve lá, e é dele que o board passa a sair.
--
-- Duas coisas que a sondagem corrigiu face ao que se julgava:
--
--   1. `production_sessions.leader_id` NÃO está nulo em toda a tabela — 426 das 721
--      linhas têm-no, e onde existe concorda com `leader_name` em 426 de 426 casos.
--      O que está a zero é precisamente a semana de 31/08–06/09: 51 sessões com nome
--      e nenhuma com id. Por isso a resolução é `COALESCE(leader_id, <pelo nome>)`:
--      usa o id quando a sessão o tem, e cai no nome só quando não tem.
--   2. A ligação pelo nome só é aceite quando EXACTAMENTE UM líder responde ao nome.
--      Um nome que duas pessoas partilham não identifica ninguém. Hoje os 29 nomes
--      distintos de `production_sessions` resolvem todos para um único líder — as
--      verificações 5d e 5e do pacote voltam a medir isso e têm de dar zero. Se um dia
--      derem alguma coisa, há sessões a desaparecer do board em silêncio.
--
-- O tipo de retorno ganha `shifts_led`, por isso é um DROP e não um CREATE OR REPLACE.
-- `DROP FUNCTION` leva as permissões com ele: a função tinha `authenticated` e
-- `service_role` explícitos e `PUBLIC` revogado (`{postgres=X,authenticated=X,
-- service_role=X}`), e sem repor isso a aplicação deixa de a conseguir chamar.

-- ---------------------------------------------------------------------------
-- 1. O board sai de quem abriu a linha
-- ---------------------------------------------------------------------------

DROP FUNCTION IF EXISTS public.scorecard_week_board(date);

CREATE FUNCTION public.scorecard_week_board(_week_ending date)
RETURNS TABLE(
  leader_id uuid,
  leader_name text,
  line_id uuid,
  line_name text,
  shifts_led integer,
  entry_id uuid,
  state text,
  volume_rag text,
  quality_rag text,
  hs_rag text,
  overall_rag text,
  rag_driver text,
  capa_required boolean,
  score_final numeric,
  score_bruto numeric,
  cap_reason text,
  cap_applied boolean
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH sessao AS (
    -- Uma sessão por (data, turno, linha, quem abriu), já resolvida a ids. A resolução
    -- vem ANTES do DISTINCT de propósito: duas sessões do mesmo turno, uma com
    -- `leader_id` e outra só com o nome, são o mesmo turno da mesma pessoa e não podem
    -- contar duas vezes em `shifts_led`.
    SELECT
      ps.session_date,
      ps.shift,
      COALESCE(
        ps.leader_id,
        (SELECT ll.id
           FROM public.line_leaders ll
          WHERE lower(btrim(ll.name)) = lower(btrim(ps.leader_name))
            AND (SELECT count(*)
                   FROM public.line_leaders l2
                  WHERE lower(btrim(l2.name)) = lower(btrim(ps.leader_name))) = 1
          LIMIT 1)
      ) AS leader_id,
      -- `production_sessions.line` é texto e `lines.name` é a tabela; a normalização é a
      -- mesma que `scorecard_derived_volume` já usava, para que as duas não divirjam.
      (SELECT ln.id
         FROM public.lines ln
        WHERE lower(replace(btrim(ln.name), ' ', '')) = lower(replace(btrim(ps.line), ' ', ''))
        LIMIT 1) AS line_id
    FROM public.production_sessions ps
    WHERE ps.session_date BETWEEN _week_ending - 6 AND _week_ending
      AND ps.leader_name IS NOT NULL
  ),
  turnos AS (
    SELECT DISTINCT session_date, shift, leader_id, line_id
    FROM sessao
    WHERE leader_id IS NOT NULL
      AND line_id IS NOT NULL
  ),
  par AS (
    SELECT leader_id, line_id, count(*)::integer AS shifts_led
    FROM turnos
    GROUP BY leader_id, line_id
  )
  SELECT
    par.leader_id,
    ll.name,
    par.line_id,
    ln.name,
    par.shifts_led,
    w.id,
    CASE
      WHEN w.id IS NULL              THEN 'por preencher'
      WHEN w.approved_at IS NOT NULL THEN 'aprovada'
      WHEN w.submitted_at IS NOT NULL THEN 'submetida'
      ELSE 'rascunho'
    END,
    w.volume_rag, w.quality_rag, w.hs_rag, w.overall_rag,
    w.rag_driver, w.capa_required,
    w.score_final, w.score_bruto, w.cap_reason, w.cap_applied
  FROM par
  JOIN public.line_leaders ll ON ll.id = par.leader_id
  JOIN public.lines        ln ON ln.id = par.line_id
  LEFT JOIN public.v_leader_weekly_scorecard w
         ON w.leader_id   = par.leader_id
        AND w.line_id     = par.line_id
        AND w.week_ending = _week_ending
  -- Por linha e depois por líder: com vários líderes na mesma linha, é a linha que
  -- agrupa a leitura. Ordenar por nome do líder espalhava os três da Line 3 pelo board.
  ORDER BY ln.display_order NULLS LAST, ln.name, ll.name;
$function$;

-- PUBLIC **e** anon: o schema `public` deste projeto tem ALTER DEFAULT PRIVILEGES que
-- concede EXECUTE a anon/authenticated/service_role em cada funcao nova, por isso a
-- funcao recriada nasce com `anon=X` que a original nao tinha. Verificado na base: sem
-- este REVOKE a ACL fica `{postgres,anon,authenticated,service_role}`; com ele volta a
-- ser exactamente `{postgres,authenticated,service_role}`.
REVOKE ALL ON FUNCTION public.scorecard_week_board(date) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scorecard_week_board(date) FROM anon;
GRANT EXECUTE ON FUNCTION public.scorecard_week_board(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scorecard_week_board(date) TO service_role;

COMMENT ON FUNCTION public.scorecard_week_board(date) IS
  'O board da semana, uma linha por (líder, linha) que abriu turno nessa semana segundo production_sessions. shifts_led diz quantos turnos daquela linha foram daquela pessoa.';

-- ---------------------------------------------------------------------------
-- 2. O volume oferecido é o dos turnos do líder, não o da linha inteira
-- ---------------------------------------------------------------------------
--
-- Com a atribuição certa mas o volume da linha, o cartão do Kaz na Line 1 oferecia as
-- 24 533 unidades da semana inteira — o trabalho de nove turnos, quando ele fez três.
--
-- `rag_weekly_entries` e `production_sessions` são ambas por (linha, turno, dia), por
-- isso o volume do líder é uma SELECÇÃO das mesmas linhas, não uma estimativa nem um
-- rateio. Medido para a semana de 06/09:
--
--   Line 1   total 24 533     Kaz 3 turnos 96,2% | Lucas 2 103,8% | Murilo 2 102,8%
--   Line 6                    Ailton 4 86,5% | Henrique 2 73,1% | Pedro 1 103,7% | Izildo 1 102,6%
--
-- `_leader_id` entra como terceiro parâmetro COM DEFAULT NULL, e não como uma função
-- nova: assim a chamada de dois argumentos que o código ainda faz continua a resolver
-- para esta função e devolve exactamente o que devolvia antes — o total da linha. Isso
-- é o que mantém a base aplicável sozinha, antes de o código ir.

DROP FUNCTION IF EXISTS public.scorecard_derived_volume(uuid, date);

CREATE FUNCTION public.scorecard_derived_volume(
  _line_id uuid,
  _week_ending date,
  _leader_id uuid DEFAULT NULL
)
RETURNS TABLE(
  planned_volume integer,
  actual_volume integer,
  unplanned_downtime_minutes integer,
  source_label text
)
LANGUAGE sql
STABLE
SET search_path TO 'public'
AS $function$
  WITH alvo AS (
    SELECT lower(replace(btrim(ln.name), ' ', '')) AS chave
    FROM public.lines ln
    WHERE ln.id = _line_id
  ),
  turnos AS (
    -- Os (dia, turno) que este líder abriu nesta linha nesta semana. Vazio quando
    -- `_leader_id` é nulo — e nesse caso o filtro abaixo não se aplica de todo.
    SELECT DISTINCT ps.session_date, ps.shift
    FROM public.production_sessions ps
    CROSS JOIN alvo
    WHERE _leader_id IS NOT NULL
      AND ps.session_date BETWEEN _week_ending - 6 AND _week_ending
      AND lower(replace(btrim(ps.line), ' ', '')) = alvo.chave
      AND COALESCE(
            ps.leader_id,
            (SELECT ll.id
               FROM public.line_leaders ll
              WHERE lower(btrim(ll.name)) = lower(btrim(ps.leader_name))
                AND (SELECT count(*)
                       FROM public.line_leaders l2
                      WHERE lower(btrim(l2.name)) = lower(btrim(ps.leader_name))) = 1
              LIMIT 1)
          ) = _leader_id
  )
  -- Sem NULLIF, pela mesma razão de sempre: sum() sobre zero linhas já dá a única
  -- ausência verdadeira, e um zero REGISTADO — uma linha que genuinamente não produziu
  -- — é um facto e tem de ler 0. Com `_leader_id` preenchido, "zero linhas" passa a
  -- poder significar também "este líder não abriu nenhum turno nesta linha", que é
  -- igualmente uma ausência e não um zero.
  SELECT
    sum(e.plan_qty)::integer,
    sum(e.actual_qty)::integer,
    sum(e.downtime_min)::integer,
    CASE WHEN _leader_id IS NULL THEN 'RAG Weekly' ELSE 'RAG Weekly (turnos deste líder)' END
  FROM public.rag_weekly_entries e
  CROSS JOIN alvo
  WHERE lower(replace(btrim(e.line), ' ', '')) = alvo.chave
    AND e.entry_date BETWEEN _week_ending - 6 AND _week_ending
    AND (
      _leader_id IS NULL
      OR EXISTS (SELECT 1 FROM turnos t
                  WHERE t.session_date = e.entry_date
                    AND t.shift = e.shift)
    );
$function$;

REVOKE ALL ON FUNCTION public.scorecard_derived_volume(uuid, date, uuid) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.scorecard_derived_volume(uuid, date, uuid) FROM anon;
GRANT EXECUTE ON FUNCTION public.scorecard_derived_volume(uuid, date, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.scorecard_derived_volume(uuid, date, uuid) TO service_role;

COMMENT ON FUNCTION public.scorecard_derived_volume(uuid, date, uuid) IS
  'O que a produção registou nesta linha e semana. Com _leader_id, só os (dia, turno) que essa pessoa abriu; sem ele, a linha inteira.';

-- ---------------------------------------------------------------------------
-- 3. Aprovar exige submeter
-- ---------------------------------------------------------------------------
--
-- O trigger verificava a CAPA, o `approved_by` e o papel de quem assina, e nunca olhava
-- para `submitted_at` — a palavra não aparecia no corpo da função. Uma semana podia ir
-- de rascunho a aprovada sem passar por submetida, que é justamente o estado que o
-- board mostra e o passo em que alguém declara a semana terminada.
--
-- `leader_weekly_scorecard` tem hoje ZERO linhas, portanto não há nenhuma semana
-- aprovada-sem-submissão para reparar e a regra não quebra nada já gravado.

CREATE OR REPLACE FUNCTION public.scorecard_require_capa_before_approval()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
DECLARE
  _fail_type text;
  _approval_changed boolean;
BEGIN
  IF NEW.approved_at IS NULL THEN
    RETURN NEW;
  END IF;

  -- Aprovar é o segundo passo, nunca o primeiro.
  IF NEW.submitted_at IS NULL THEN
    RAISE EXCEPTION
      'Uma semana tem de ser submetida antes de ser aprovada: submitted_at esta por preencher.'
      USING ERRCODE = 'check_violation';
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

  _approval_changed := TG_OP = 'INSERT'
    OR OLD.approved_by IS DISTINCT FROM NEW.approved_by
    OR OLD.approved_at IS DISTINCT FROM NEW.approved_at;

  IF _approval_changed THEN
    -- ...and the somebody it names is the person doing it. Otherwise any writer
    -- could sign an approval in a colleague's name.
    IF NEW.approved_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION
        'Aprovacao tem de ser assinada por quem a faz: approved_by tem de ser o utilizador autenticado.'
        USING ERRCODE = 'check_violation';
    END IF;

    -- ...and that person holds a role that may approve. Preencher e aprovar sao
    -- permissoes diferentes (scorecard.fill vs scorecard.approve): production_office_admin
    -- preenche a semana e nao a assina.
    IF NOT (
      public.has_role(auth.uid(), 'admin'::app_role)
      OR public.has_role(auth.uid(), 'manager'::app_role)
      OR public.has_role(auth.uid(), 'quality_supervisor'::app_role)
    ) THEN
      RAISE EXCEPTION
        'Sem permissao para aprovar uma semana: e preciso admin, manager ou quality_supervisor.'
        USING ERRCODE = 'insufficient_privilege';
    END IF;
  END IF;

  RETURN NEW;
END $function$;


-- ================================================================
-- BLOCO 32B
-- 20260912090000_the_name_the_line_calls_somebody.sql
-- ================================================================

-- The spelling the factory's own headcount sheet uses for a person.
--
-- That sheet is typed by hand every morning and calls people what the line calls
-- them. Measured against `Production Headcount August.xlsx`, four days of the
-- company's own sheet carried 249 names and the import placed 188 of them: a quarter
-- of the factory dropped in silence, every month, to be put back by hand.
--
-- Widening the matching rules recovered most of it. What no rule should ever recover
-- is a typo — "LUCAS GLOR" is Lucas Gloor and "Gimenez" is Gabriel Chimenez, and any
-- code clever enough to work that out is also clever enough to put the wrong person
-- on a line. So it is written down instead: once, on the person, by whoever already
-- knows. Comma separated, the same shape `headcount_areas.sheet_label` already uses
-- for the columns, and read the same way.
alter table public.employees
  add column if not exists sheet_aliases text;

comment on column public.employees.sheet_aliases is
  'Other spellings the company headcount spreadsheet uses for this person, comma separated. Read by the headcount import; never shown on the board.';

-- The six the August sheet had that belong to exactly one person on the payroll.
-- Every other unmatched name was either two people who share a first name or somebody
-- not on the payroll at all, and neither of those is settled here — the import asks.
update public.employees set sheet_aliases = 'LUCAS GLOR'  where full_name = 'Lucas Gloor'        and sheet_aliases is null;
update public.employees set sheet_aliases = 'GYOVANI'     where full_name = 'Giovany Gava'       and sheet_aliases is null;
update public.employees set sheet_aliases = 'Gimenez'     where full_name = 'Gabriel Chimenez'   and sheet_aliases is null;
update public.employees set sheet_aliases = 'Crsitiano'   where full_name = 'Cristiano Brunetto' and sheet_aliases is null;
update public.employees set sheet_aliases = 'Welligton'   where full_name = 'Wellington Segato'  and sheet_aliases is null;
update public.employees set sheet_aliases = 'Russo'       where full_name = 'Carlos Russo'       and sheet_aliases is null;

-- ================================================================
-- BLOCO 38
-- 20260912090000_two_leader_functions_and_a_column_nobody_filled.sql
-- ================================================================

-- Three leftovers from the leader rework, removed now that the evidence says nobody is
-- holding on to them.
--
-- None of this fixes a defect. It removes the material the next defect gets built out
-- of: a column that looks like it means something and is empty, and two functions that
-- PostgREST will pick if a caller happens to omit one argument.

-- =====================================================================
-- 1. The superseded create_leader / update_leader
--
-- Both exist twice, once with `_lines text[]` and once without:
--
--   create_leader(_name text, _pin text)
--   create_leader(_name text, _pin text, _lines text[])
--   update_leader(_id uuid, _name text, _active boolean, _pin text)
--   update_leader(_id uuid, _name text, _active boolean, _pin text, _lines text[])
--
-- PostgREST resolves an overload from the argument names in the JSON body, so the short
-- pair is reachable — a caller that omits `_lines` gets it, silently, and creates a
-- leader assigned to no lines at all. Which is the state that produced a zero scorecard
-- for three people in 20260906090000: a leader whose `lines` does not match production.
--
-- Both call sites pass `_lines` (ManageUsers.tsx, create at :308 and update at :338), so
-- the short pair has no caller. Dropping it turns "silently assigned to nothing" into a
-- 404 from PostgREST, which is a thing somebody notices.
-- =====================================================================

DROP FUNCTION IF EXISTS public.create_leader(_name text, _pin text);
DROP FUNCTION IF EXISTS public.update_leader(_id uuid, _name text, _active boolean, _pin text);

-- =====================================================================
-- 2. line_leaders.line — 31 rows, none of them filled
--
-- Checked four ways before dropping, because a column is not recoverable:
--
--   rows with a value ......................... 0 of 31
--   selects naming it in src/ ................. none — every read is `id, name` or
--                                               `id, name, shift`
--   functions referencing it .................. none
--   RLS policies referencing it ............... none
--   views depending on it ..................... none. Five views read this table
--                                               (v_leader_weekly_scorecard and the four
--                                               scorecard rollups) and pg_depend shows
--                                               every one of them binding `id` and
--                                               `name` only
--
-- It is the same idea as `leader_pins.line`, which is the OTHER half of this mess and is
-- deliberately NOT dropped here: that one still holds values for 12 of 25 leaders, and a
-- column with data in it is a migration that needs somebody to decide, not a tidy-up. It
-- was documented as legacy in 20260906090000 and stays that way.
-- =====================================================================

ALTER TABLE public.line_leaders DROP COLUMN IF EXISTS line;

COMMENT ON TABLE public.line_leaders IS
  'Lideres de linha, e o alvo da FK production_sessions.leader_id. Nao confundir com '
  'leader_pins, que guarda o PIN e o ARRAY de linhas que o scorecard pessoal usa: sao duas '
  'tabelas para a mesma pessoa, ligadas so por nome. Ver a auditoria de 26/08/2026 — dos 25 '
  'PINs todos tem nome igual aqui, mas 5 lideres desta tabela nao tem PIN e por isso nao '
  'conseguem abrir o proprio scorecard.';


-- ================================================================
-- BLOCO 39
-- 20260913090000_nineteen_backups_out_of_the_way_but_not_gone.sql
-- ================================================================

-- Nineteen backup tables, moved out of `public` rather than dropped.
--
-- They accumulated between 29/07 and 05/08 from dedupe and backfill work, and none of
-- them is read by anything: no file in src/ names one, no view depends on one, and the
-- only policy each carries is "admin only". They are not a leak. They are 19 of the 138
-- tables in `public`, which is how a schema stops being readable at a glance.
--
--   _line_stopped_backfill_bak                276 rows
--   sku_products_backup                      1549
--   daily_allocations_bak_20260805           1028
--   attendance_days_bak_20260804              690
--   sku_batch_dupes_20260729                  324
--   overtime_entries_backup_20260802           59
--   absence_rename_bak_20260805                39
--   daily_allocations_backup_0308              35
--   attendance_backfill_bak_20260804            8
--   employees_backup_dept_spelling              5
--   _wo_linestop_fix_bak_20260804               4
--   wo_dedupe_backup_20260804                   2
--   wo_shiftclose_bak_20260804                  2
--   downtime_events_dedupe_backup_20260804      2
--   employees_backup_dedupe                     1
--   wo802/wo803_deleted/wo803_events/wo804      1 each
--
-- WHY NOT DROP, which is what the audit's own finding said to do. Because "clutter" and
-- "expendable" are not the same word. Those rows are the receipt for corrections
-- somebody made to attendance, overtime, allocations and employee records — the before
-- side of a dedupe, the pre-backfill state of 276 line stops. If a figure from July is
-- ever questioned, this is the only place the previous answer still exists. Dropping
-- them is a one-way door, and nothing here is urgent enough to justify one.
--
-- Moving them achieves what the finding actually wanted:
--   * they leave `public`, so `list_tables` and the schema diff stop showing them
--   * PostgREST exposes only the schemas it is configured for — `public` — so they
--     become unreachable through the API entirely, which is stricter than the
--     admin-only policies they have now
--   * and it reverses with one statement per table, which DROP does not
--
-- WHEN TO ACTUALLY DELETE THEM: when somebody decides the corrections they document are
-- settled. That is a decision with a date on it, not a tidy-up, and it is not this
-- migration's to take.

CREATE SCHEMA IF NOT EXISTS archive;

COMMENT ON SCHEMA archive IS
  'Tabelas de backup tiradas a mao durante correccoes de dados (dedupe, backfill), fora do '
  'public para nao poluirem o esquema nem serem alcancaveis pela API. Nada as le. Nao sao '
  'descartaveis: sao o lado "antes" de correccoes a assiduidade, horas extra, alocacoes e '
  'registos de pessoal. Apagar so quando alguem decidir que essas correccoes estao encerradas. '
  'Ver 20260913090000.';

-- The API reaches `public` and nothing else here; this makes that explicit rather than
-- relying on it. `postgres` and the service role are unaffected — they bypass this.
REVOKE ALL ON SCHEMA archive FROM anon, authenticated;

DO $$
DECLARE
  _t text;
  _movidas int := 0;
  _tabelas constant text[] := ARRAY[
    '_line_stopped_backfill_bak',
    '_wo_linestop_fix_bak_20260804',
    'absence_rename_bak_20260805',
    'attendance_backfill_bak_20260804',
    'attendance_days_bak_20260804',
    'daily_allocations_backup_0308',
    'daily_allocations_bak_20260805',
    'downtime_events_dedupe_backup_20260804',
    'employees_backup_dedupe',
    'employees_backup_dept_spelling',
    'overtime_entries_backup_20260802',
    'sku_batch_dupes_20260729',
    'sku_products_backup',
    'wo802_backup_20260804',
    'wo803_deleted_backup_20260804',
    'wo803_events_backup_20260804',
    'wo804_backup_20260804',
    'wo_dedupe_backup_20260804',
    'wo_shiftclose_bak_20260804'
  ];
BEGIN
  FOREACH _t IN ARRAY _tabelas LOOP
    -- Named one by one, never by pattern. A LIKE '%backup%' sweep would eventually
    -- catch a real table somebody named badly, and this is the kind of statement that
    -- gets copied into the next migration.
    IF to_regclass('public.' || quote_ident(_t)) IS NOT NULL THEN
      EXECUTE format('ALTER TABLE public.%I SET SCHEMA archive', _t);
      _movidas := _movidas + 1;
    END IF;
  END LOOP;

  RAISE NOTICE '% tabelas de backup movidas de public para archive.', _movidas;
END $$;


-- ================================================================
-- BLOCO 40
-- 20260914090000_the_leaders_with_no_pin_and_the_key_between_the_two_tables.sql
-- ================================================================

-- Two tables hold the same people, joined by nothing, and five of those people cannot
-- open their own scorecard.
--
-- `line_leaders` (31 rows) is the target of production_sessions.leader_id — the factory's
-- record of who led what. `leader_pins` (25 rows) holds the PIN and the `lines` array
-- that `leader_self_scorecard()` reads. Same people, two tables, and the only thing
-- connecting them is that the names happen to match.
--
-- All 25 PINs have a name in line_leaders. Six line_leaders have no PIN, and five of
-- those have led real sessions:
--
--   Webister    3 sessions, last 20/07     Marcella   1 session, last 24/07
--   Fabricio    3 sessions, last 20/07     Alice      1 session, last 08/08
--   Josiel      1 session, last 07/07      Junior     none
--
-- No PIN means `leader_self_scorecard()` cannot identify them, so /dashboard/leader/scorecard
-- shows them the keypad and nothing else, forever. And nothing says so: the Manage Users
-- screen lists `leader_pins`, so a leader who has no PIN is not missing from the list —
-- they were never on it. The only way to find this was to compare two tables by hand.
--
-- THIS MIGRATION DOES NOT CREATE PINS. A PIN is a secret its owner has to know, and
-- inventing five and writing them into a migration file in a public repository would be
-- worse than the problem. What it does is make the five visible on the screen where
-- somebody can give them one.

-- =====================================================================
-- 1. The key the two tables never had
--
-- Nullable and ON DELETE SET NULL, deliberately: a PIN row whose line_leader is removed
-- should lose the link, not vanish. Nothing reads this column yet — it exists so that the
-- next thing that needs to join these two tables joins on a key instead of on a name,
-- which is the defect that produced 20260906090000.
-- =====================================================================

ALTER TABLE public.leader_pins
  ADD COLUMN IF NOT EXISTS line_leader_id uuid REFERENCES public.line_leaders(id) ON DELETE SET NULL;

-- Backfilled by name, because a name is all there has ever been to go on. Trimmed and
-- case-folded, as everything else in this schema that matches leaders does. All 25 are
-- expected to resolve; any that does not is left null rather than guessed at.
UPDATE public.leader_pins p
   SET line_leader_id = l.id
  FROM public.line_leaders l
 WHERE p.line_leader_id IS NULL
   AND lower(btrim(l.name)) = lower(btrim(p.name));

CREATE UNIQUE INDEX IF NOT EXISTS leader_pins_line_leader_id_key
  ON public.leader_pins (line_leader_id) WHERE line_leader_id IS NOT NULL;

COMMENT ON COLUMN public.leader_pins.line_leader_id IS
  'O mesmo lider em public.line_leaders, que e o alvo de production_sessions.leader_id. '
  'Preenchido por nome em 20260914090000 porque era so isso que havia; daqui para a frente '
  'quem precisar de juntar as duas tabelas junta por esta chave e nao pelo nome. Unico: dois '
  'PINs para o mesmo lider e um erro de dados, nao um caso de uso.';

-- =====================================================================
-- 2. Who leads sessions and cannot sign in to see them
--
-- SECURITY DEFINER because line_leaders is not readable by everyone, and this answers a
-- question the Manage Users screen has to be able to ask. Restricted to the roles that
-- can already manage leaders — the same gate `create_leader` sits behind.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.leaders_without_pin()
RETURNS TABLE(id uuid, name text, shift text, active boolean, sessions bigint, last_session date)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  SELECT l.id,
         l.name,
         l.shift,
         l.active,
         (SELECT count(*) FROM public.production_sessions s
           WHERE s.leader_id = l.id
              OR lower(btrim(s.leader_name)) = lower(btrim(l.name))),
         (SELECT max(s.session_date) FROM public.production_sessions s
           WHERE s.leader_id = l.id
              OR lower(btrim(s.leader_name)) = lower(btrim(l.name)))
    FROM public.line_leaders l
   WHERE NOT EXISTS (
           SELECT 1 FROM public.leader_pins p
            WHERE p.line_leader_id = l.id
               OR lower(btrim(p.name)) = lower(btrim(l.name))
         )
   ORDER BY 5 DESC, l.name;
$function$;

REVOKE ALL ON FUNCTION public.leaders_without_pin() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.leaders_without_pin() TO authenticated;

COMMENT ON FUNCTION public.leaders_without_pin() IS
  'Lideres de line_leaders sem linha em leader_pins — lideram sessoes e nao conseguem abrir o '
  'proprio scorecard, porque leader_self_scorecard() os identifica pelo PIN. Ordenado pela '
  'ultima sessao, para quem esta a olhar comecar por quem lidera agora. Ver 20260914090000.';


-- ================================================================
-- BLOCO 41
-- 20260915090000_the_engineer_who_could_read_the_plan_but_not_write_it.sql
-- ================================================================

-- O engineer lia o plano de preventiva e nao o podia escrever.
--
-- `pm.view` incluia engineer e co_engineer desde que a matriz foi alargada. `pm.manage`
-- nao, e a RLS de pm_schedules e pm_tasks estava cravada em admin/manager/
-- maintenance_manager. O plano nascia longe da maquina: quem sabe o intervalo certo
-- pedia a alguem que nao a assiste que o gravasse por ele.
--
-- A matriz passa a dar-lhes `pm.manage`. Esta migracao poe a base a dizer o mesmo — sem
-- ela o botao "Create plan" aparece e o clique devolve um erro de RLS, que parece uma
-- avaria e nao uma permissao.
--
-- pm_executions ja nao precisava disto: a policy "PM executions insertable by
-- engineers/managers/admins" ja nomeia o engineer desde que registar uma execucao
-- passou a ser trabalho de quem a faz.
--
-- APLICAR ANTES DO MERGE. No Lovable o merge e o deploy, e codigo que chama uma
-- permissao que a base ainda nao da parte o ecra para toda a gente.

DROP POLICY IF EXISTS "PM schedules manageable by mgmt" ON public.pm_schedules;
CREATE POLICY "PM schedules manageable by mgmt" ON public.pm_schedules FOR ALL TO authenticated
  USING (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'maintenance_manager'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role)
    OR has_role(auth.uid(),'co_engineer'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'maintenance_manager'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role)
    OR has_role(auth.uid(),'co_engineer'::app_role)
  );

DROP POLICY IF EXISTS "PM tasks manageable by mgmt" ON public.pm_tasks;
CREATE POLICY "PM tasks manageable by mgmt" ON public.pm_tasks FOR ALL TO authenticated
  USING (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'maintenance_manager'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role)
    OR has_role(auth.uid(),'co_engineer'::app_role)
  )
  WITH CHECK (
    has_role(auth.uid(),'admin'::app_role)
    OR has_role(auth.uid(),'manager'::app_role)
    OR has_role(auth.uid(),'maintenance_manager'::app_role)
    OR has_role(auth.uid(),'engineer'::app_role)
    OR has_role(auth.uid(),'co_engineer'::app_role)
  );


-- O heartbeat do engineer escrevia em `profiles` e o Postgres recusava sempre.
--
-- `useHeartbeat` faz `.from("profiles").update({ last_seen_at })` de 30 em 30 segundos
-- enquanto um engineer tem o dashboard aberto. Root Diagnostics registou seis
-- `42501 permission denied for table profiles` entre 28/08 07:15 e 29/08 08:40, todos
-- em /dashboard/engineer, todos PATCH. Nao falhou uma vez: falha todas, desde sempre.
--
-- Nao e RLS, apesar de aparecer como RLS_ERROR — a policy "Users can update own profile"
-- deixa passar, e `authenticated` tem UPDATE na tabela. O que falta e o SELECT: o
-- PostgREST escreve `UPDATE ... RETURNING profiles.*` mesmo quando o cliente nao pede a
-- linha de volta, e o SELECT de tabela em `profiles` esta revogado desde 20260724130000
-- para o `labor_rate` — o custo/hora de cada pessoa — nao viajar para o browser. Sao os
-- outros nove campos que estao concedidos coluna a coluna, e por isso todos os SELECT
-- explicitos do codigo funcionam; o `RETURNING *` e que nao pode.
--
-- O erro traz a sugestao `GRANT SELECT ON public.profiles TO authenticated` na propria
-- HINT. Segui-la devolve o labor_rate a quem a RLS deixa ver a linha, e a policy
-- "Managers can view non-admin profiles" deixa um manager ver a de toda a gente. A
-- revogacao ja foi reposta em dez migracoes diferentes desde Abril; o caminho nao e
-- repo-la outra vez, e deixar de precisar de ler a linha.
--
-- `touch_last_seen()` escreve a coluna e nao devolve nada. Nao aceita argumentos, por
-- isso ninguem marca ninguem — so a si proprio, pelo `auth.uid()` do pedido, que um
-- SECURITY DEFINER preserva porque vive nas claims e nao no papel da sessao. Os dois
-- triggers de `profiles` continuam a correr: `guard_profile_sensitive` repoe os campos
-- que um utilizador comum nao pode mexer e `guard_profile_labor_rate` recusa quem tente
-- o labor_rate — nenhum deles se opoe a esta coluna.

CREATE OR REPLACE FUNCTION public.touch_last_seen()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.profiles SET last_seen_at = now() WHERE id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION public.touch_last_seen() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated;

COMMENT ON FUNCTION public.touch_last_seen() IS
  'Marca o proprio last_seen_at. Existe porque o PATCH direto a public.profiles nao pode '
  'funcionar: o PostgREST faz RETURNING da linha inteira e authenticated nao tem SELECT em '
  'labor_rate (revogado de proposito), logo o heartbeat devolvia 42501 permission denied '
  'for table profiles. Escreve so a coluna do proprio auth.uid(); nao aceita argumentos, '
  'para nao poder marcar outra pessoa. Ver 20260916090000.';


-- ================================================================
-- BLOCO 42
-- 20260917090000_o_endereco_do_tunel_que_ninguem_podia_gravar.sql
-- ================================================================

-- The Settings screen could never save the SharePoint RAG address.
--
-- 20260729180000 dropped the table-level UPDATE grant on system_settings and
-- re-granted it column by column, so that admin_pin could not be routed around
-- the PIN check. Its own comment left the standing instruction:
--
--     "When a column is added to system_settings, GRANT it here too."
--
-- 20260906085832 added rag_api_base_url and did not come back here. The column
-- has been unwritable ever since — every Save in RagApiAddressDialog dies with
-- 42501, "permission denied for table system_settings", for an admin as much as
-- for anyone else. It is a GRANT, not a policy: "Admins can manage
-- system_settings" already allowed the row, and PostgreSQL refuses one step
-- earlier, on the column. That is why the screen showed a permission error that
-- no amount of reading the policies explained, and why the address that IS in
-- production on 07/09 got there by hand-run SQL rather than through the screen.
--
-- Only the address column. admin_pin stays out of reach of a direct UPDATE, and
-- intouch_sync_enabled still goes through set_intouch_sync_enabled(), which is
-- the whole point of the column-by-column shape.
GRANT UPDATE (rag_api_base_url) ON public.system_settings TO authenticated;


-- ================================================================
-- BLOCO 38B
-- 20260917135845_5b0b8206-5890-4557-9525-f75695902afb.sql
-- ================================================================

CREATE OR REPLACE FUNCTION public.distinct_rag_lines()
RETURNS TABLE(line text)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT DISTINCT e.line FROM public.rag_weekly_entries e ORDER BY 1
$$;

REVOKE ALL ON FUNCTION public.distinct_rag_lines() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.distinct_rag_lines() TO authenticated;
GRANT EXECUTE ON FUNCTION public.distinct_rag_lines() TO service_role;

-- ================================================================
-- BLOCO 38C
-- 20260917192851_bcadeef1-c9fe-4f1d-82f2-2e4079310ad4.sql
-- ================================================================

CREATE OR REPLACE FUNCTION public.import_rag_plan_workbook(
  _updates jsonb DEFAULT '[]'::jsonb,
  _inserts jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  _updated integer := 0;
  _created integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(_updates, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(_inserts, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'import_rag_plan_workbook expects two JSON arrays';
  END IF;

  UPDATE public.rag_weekly_entries e
     SET plan_qty = v.plan_qty
    FROM jsonb_to_recordset(COALESCE(_updates, '[]'::jsonb)) AS v(id uuid, plan_qty numeric)
   WHERE e.id = v.id
     AND e.plan_qty IS DISTINCT FROM v.plan_qty;
  GET DIAGNOSTICS _updated = ROW_COUNT;

  INSERT INTO public.rag_weekly_entries (entry_date, line, shift, plan_qty, created_by)
  SELECT n.entry_date, n.line, n.shift, n.plan_qty, auth.uid()
    FROM jsonb_to_recordset(COALESCE(_inserts, '[]'::jsonb))
      AS n(entry_date date, line text, shift text, plan_qty numeric)
   ON CONFLICT (entry_date, line, shift) DO NOTHING;
  GET DIAGNOSTICS _created = ROW_COUNT;

  RETURN jsonb_build_object('updated', _updated, 'created', _created);
END;
$$;

REVOKE ALL ON FUNCTION public.import_rag_plan_workbook(jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_rag_plan_workbook(jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_rag_plan_workbook(jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- BLOCO 38D
-- 20260918042547_f8165fcc-6b64-40cc-a2be-de02578c34c8.sql
-- ================================================================

-- GUARDA, e não parte da migração: `rag_plan_history` muda de tipo de retorno no
-- bloco 38E, e um CREATE OR REPLACE não pode mudar o tipo de retorno de uma função
-- que já existe. Sem este DROP, colar isto numa base onde o 38E já correu — ou colar
-- o ficheiro uma segunda vez — rebenta a meio da transação com "cannot change return
-- type of existing function".
DROP FUNCTION IF EXISTS public.rag_plan_history(uuid[]);

CREATE OR REPLACE FUNCTION public.rag_plan_history(_entry_ids uuid[])
RETURNS TABLE (
  entry_id uuid,
  changed_at timestamptz,
  user_name text,
  before_qty numeric,
  after_qty numeric
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Same condition as the rag_weekly_select_auth policy on rag_weekly_entries:
  -- any signed-in user who can read the board can read its plan history.
  SELECT
    (a.entity_id)::uuid                       AS entry_id,
    a.created_at                              AS changed_at,
    a.user_name                               AS user_name,
    NULLIF(a.details->>'before', '')::numeric  AS before_qty,
    NULLIF(a.details->>'after', '')::numeric   AS after_qty
  FROM public.audit_logs a
  WHERE auth.uid() IS NOT NULL
    AND a.action = 'update_rag_plan_qty'
    AND a.entity_type = 'rag_weekly_entry'
    AND a.entity_id IS NOT NULL
    AND a.entity_id ~ '^[0-9a-fA-F-]{36}$'
    AND (a.entity_id)::uuid = ANY (COALESCE(_entry_ids, ARRAY[]::uuid[]))
  ORDER BY a.created_at DESC
$$;

REVOKE ALL ON FUNCTION public.rag_plan_history(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rag_plan_history(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.rag_plan_history(uuid[]) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- BLOCO 38E
-- 20260918074846_284f9669-bbc3-4e4d-a07d-005fb5edd8c1.sql
-- ================================================================

-- Target history: the line plan is not the only place a target moves. SKU-level
-- edits log as update_target_qty on production_item and feed the line plan
-- through sync_items_target_from_rag, so the panel must show both or it lies by
-- omission. Still SECURITY DEFINER, still nothing but these two actions.
DROP FUNCTION IF EXISTS public.rag_plan_history(uuid[]);

CREATE FUNCTION public.rag_plan_history(_entry_ids uuid[])
RETURNS TABLE (
  entry_id uuid,
  changed_at timestamptz,
  user_name text,
  before_qty numeric,
  after_qty numeric,
  kind text,
  sku_code text,
  sku_name text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  -- Line/shift plan changes, keyed straight off the audited row id.
  SELECT
    (a.entity_id)::uuid                       AS entry_id,
    a.created_at                              AS changed_at,
    a.user_name                               AS user_name,
    NULLIF(a.details->>'before', '')::numeric AS before_qty,
    NULLIF(a.details->>'after', '')::numeric  AS after_qty,
    'line'::text                              AS kind,
    NULL::text                                AS sku_code,
    NULL::text                                AS sku_name
  FROM public.audit_logs a
  WHERE auth.uid() IS NOT NULL
    AND a.action = 'update_rag_plan_qty'
    AND a.entity_type = 'rag_weekly_entry'
    AND a.entity_id IS NOT NULL
    AND a.entity_id ~ '^[0-9a-fA-F-]{36}$'
    AND (a.entity_id)::uuid = ANY (COALESCE(_entry_ids, ARRAY[]::uuid[]))

  UNION ALL

  -- SKU-level target changes, matched to the cell by date, line and shift.
  SELECT
    e.id,
    a.created_at,
    a.user_name,
    NULLIF(a.details->>'before', '')::numeric,
    NULLIF(a.details->>'after', '')::numeric,
    'sku'::text,
    a.details->>'sku_code',
    a.details->>'sku_name'
  FROM public.audit_logs a
  JOIN public.rag_weekly_entries e
    ON e.id = ANY (COALESCE(_entry_ids, ARRAY[]::uuid[]))
   AND e.entry_date = (a.details->>'session_date')::date
   AND e.line = a.details->>'line'
   AND e.shift = a.details->>'shift'
  WHERE auth.uid() IS NOT NULL
    AND a.action = 'update_target_qty'
    AND a.entity_type = 'production_item'
    AND a.details ? 'session_date'
    AND a.details->>'session_date' ~ '^\d{4}-\d{2}-\d{2}$'
    AND a.details ? 'line'
    AND a.details ? 'shift'

  ORDER BY changed_at DESC
$function$;

REVOKE ALL ON FUNCTION public.rag_plan_history(uuid[]) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.rag_plan_history(uuid[]) FROM anon;
GRANT EXECUTE ON FUNCTION public.rag_plan_history(uuid[]) TO authenticated;

-- The workbook carries the UPM target too. Only plan_qty and upm_target: the
-- measured columns still belong to this system, not to the spreadsheet.
CREATE OR REPLACE FUNCTION public.import_rag_plan_workbook(
  _updates jsonb DEFAULT '[]'::jsonb,
  _inserts jsonb DEFAULT '[]'::jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path TO 'public'
AS $function$
DECLARE
  _updated integer := 0;
  _created integer := 0;
BEGIN
  IF jsonb_typeof(COALESCE(_updates, '[]'::jsonb)) <> 'array'
     OR jsonb_typeof(COALESCE(_inserts, '[]'::jsonb)) <> 'array' THEN
    RAISE EXCEPTION 'import_rag_plan_workbook expects two JSON arrays';
  END IF;

  -- A NULL upm_target in the payload means "the file had nothing there" and the
  -- stored value is kept. The DISTINCT FROM guard keeps the count honest and
  -- stops the audit trigger firing for rows that did not actually move.
  UPDATE public.rag_weekly_entries e
     SET plan_qty   = COALESCE(v.plan_qty, e.plan_qty),
         upm_target = COALESCE(v.upm_target, e.upm_target)
    FROM jsonb_to_recordset(COALESCE(_updates, '[]'::jsonb))
      AS v(id uuid, plan_qty numeric, upm_target numeric)
   WHERE e.id = v.id
     AND (
       e.plan_qty IS DISTINCT FROM COALESCE(v.plan_qty, e.plan_qty)
       OR e.upm_target IS DISTINCT FROM COALESCE(v.upm_target, e.upm_target)
     );
  GET DIAGNOSTICS _updated = ROW_COUNT;

  INSERT INTO public.rag_weekly_entries (entry_date, line, shift, plan_qty, upm_target, created_by)
  SELECT n.entry_date, n.line, n.shift, n.plan_qty, COALESCE(n.upm_target, 0), auth.uid()
    FROM jsonb_to_recordset(COALESCE(_inserts, '[]'::jsonb))
      AS n(entry_date date, line text, shift text, plan_qty numeric, upm_target numeric)
   ON CONFLICT (entry_date, line, shift) DO NOTHING;
  GET DIAGNOSTICS _created = ROW_COUNT;

  RETURN jsonb_build_object('updated', _updated, 'created', _created);
END;
$function$;

REVOKE ALL ON FUNCTION public.import_rag_plan_workbook(jsonb, jsonb) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.import_rag_plan_workbook(jsonb, jsonb) FROM anon;
GRANT EXECUTE ON FUNCTION public.import_rag_plan_workbook(jsonb, jsonb) TO authenticated;

NOTIFY pgrst, 'reload schema';

-- ================================================================
-- BLOCO 43
-- 20260918090000_the_engineer_may_edit_the_part_but_not_photograph_it.sql
-- ================================================================

-- The engineer may edit the part, but not photograph it.
--
-- `part-photos` was written on 26/08 with the stated intent of mirroring
-- `public.products` exactly: "view = anyone who can read products, upload/replace =
-- anyone who can write products". It mirrored the role list products had THAT DAY,
-- by hand. Products has since moved to the Permissions matrix — `has_action(uid,
-- 'stock.view' | 'stock.manage', <baseline>)` — and the bucket did not follow, so the
-- two answers drifted apart in both directions:
--
--   role                     products write   part-photos upload
--   engineer                 yes (override)   NO
--   supervisor               no  (override)   yes
--
-- Measured on this database on 08/09/2026 at 14:05 UTC, for
-- maintenance@appliednutrition.uk (role `engineer`, the account that reported it), as
-- `authenticated` carrying its own JWT, inside a transaction that was rolled back:
--
--   products visible ............. 170
--   has_action('stock.manage') ... true      -- the Edit dialog saves
--   INSERT storage.objects ....... REFUSED   -- the photo does not
--
-- Which is the screen the person saw: a part they had just edited, and "Upload failed
-- — new row violates row-level security policy" on its photograph.
--
-- `20260908142852` (committed 14:28 UTC the same day, while this was being measured)
-- answers the same report by adding `engineer`, `co_engineer` and `warehouse` to the
-- hand-written list. That closes the one door that was knocked on and leaves the
-- mechanism intact — it is now the THIRD copy of "who may touch Stock", and it grants
-- upload to `warehouse` and `co_engineer`, whom the matrix denies `stock.manage`. It
-- had not reached the database as of 15:02 UTC; the policies in force were still the
-- 26/08 five-role version. This migration supersedes it: a later stamp, so a replay in
-- filename order ends here.
--
-- So the three policies stop carrying a copy of the list and ask the matrix the same
-- question products asks, with the same baselines, verbatim from `products select by
-- matrix` and `products insert/update by matrix`. The extra `production_office_admin`
-- branch is not generosity: `office_admin all` on products is an unconditional FOR ALL
-- policy that ignores the matrix, so the bucket has to carry it too or the mirror is
-- broken on the other side.
--
-- `part_photos_delete` is left exactly as it is — admin or production_office_admin
-- already mirrors "Admins can delete products" plus `office_admin all`.
--
-- Applied to the database by hand on 08/09/2026 at 14:07 UTC and verified role by role
-- with a real INSERT, rolled back: engineer true (was false), admin true, operator
-- false, quality_supervisor false.

DROP POLICY IF EXISTS "part_photos_read" ON storage.objects;
CREATE POLICY "part_photos_read"
ON storage.objects FOR SELECT TO authenticated
USING (
  bucket_id = 'part-photos' AND (
    public.has_action(
      auth.uid(),
      'stock.view',
      ARRAY['admin','manager','supervisor','maintenance_manager','planner','engineer','co_engineer','warehouse','production_office_admin']::app_role[]
    )
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
);

DROP POLICY IF EXISTS "part_photos_insert" ON storage.objects;
CREATE POLICY "part_photos_insert"
ON storage.objects FOR INSERT TO authenticated
WITH CHECK (
  bucket_id = 'part-photos' AND (
    public.has_action(
      auth.uid(),
      'stock.manage',
      ARRAY['admin','manager','supervisor','maintenance_manager','production_office_admin']::app_role[]
    )
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
);

DROP POLICY IF EXISTS "part_photos_update" ON storage.objects;
CREATE POLICY "part_photos_update"
ON storage.objects FOR UPDATE TO authenticated
USING (
  bucket_id = 'part-photos' AND (
    public.has_action(
      auth.uid(),
      'stock.manage',
      ARRAY['admin','manager','supervisor','maintenance_manager','production_office_admin']::app_role[]
    )
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
)
WITH CHECK (
  bucket_id = 'part-photos' AND (
    public.has_action(
      auth.uid(),
      'stock.manage',
      ARRAY['admin','manager','supervisor','maintenance_manager','production_office_admin']::app_role[]
    )
    OR public.has_role(auth.uid(), 'production_office_admin'::app_role)
  )
);

-- ================================================================
-- BLOCO 44
-- 20260919090000_a_espera_do_armazem_abre_a_sua_propria_ordem.sql
-- ================================================================

-- A espera do armazém abre a sua própria ordem.
--
-- "Warehouse/Awaiting Packaging" é a linha parada à espera de embalagem. O tempo
-- já era medido — o código tem `requires_wo = false`, por isso o poll manda-o
-- para `production_downtimes` e os minutos entram no OEE — mas ninguém do
-- armazém tem razão nenhuma para abrir essa tabela, e por isso ninguém do
-- armazém sabia que a linha estava à espera dele. Nos 30 dias até 07/09 foram 2
-- a 5 esperas por dia, média entre 5 e 28 minutos, máximo 67. Tudo medido, tudo
-- invisível para quem podia encurtá-lo.
--
-- Cinco coisas aqui. As três primeiras fazem a ordem existir; as duas últimas
-- impedem-na de estragar dois números que não lhe dizem respeito — a saúde da
-- máquina e a data da última manutenção.

-- 1 ─ A coluna. Qual é a paragem que chama o armazém.
--
-- Coluna nova, e não um `wo_target` a substituir o `requires_wo`: aquela coluna
-- é lida pelo poll, por este trigger e por meia dúzia de queries que decidem o
-- que é downtime de produção. Trocar-lhe a semântica partia todas ao mesmo
-- tempo. Isto só acrescenta, e quem não souber dela continua a ler o mesmo.
ALTER TABLE public.intouch_stop_code_map
  ADD COLUMN IF NOT EXISTS raises_warehouse_wo boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN public.intouch_stop_code_map.raises_warehouse_wo IS
  'Esta paragem abre uma ordem de armazém (wo_type = warehouse_service) enquanto durar, para o armazém ver o tempo que a linha está à espera dele. Independente de requires_wo: uma paragem pode chamar o armazém sem nunca chamar a manutenção, que é o caso de Warehouse/Awaiting Packaging.';

-- 2 ─ O dado. Hoje é uma paragem só.
--
-- Pelo GUID e pelo nome: o GUID é o que o iTouching manda, e o nome é o que
-- sobrevive a uma reinstalação que troque os GUIDs. Nenhum dos dois sozinho
-- chega, e ligar a mesma linha duas vezes não custa nada.
UPDATE public.intouch_stop_code_map
SET raises_warehouse_wo = true
WHERE lower(stop_code) = '5dd6a44d-9f0a-4c00-8ccb-f65691a5bc5d'
   OR lower(btrim(label)) = 'warehouse/awaiting packaging';

-- 3 ─ A regra que recusava a ordem antes de ela existir.
--
-- `enforce_intouch_wo_requires_maintenance_code` devolve NULL — a linha
-- desaparece em silêncio e fica um `intouch_wo_blocked` em `audit_logs` — para
-- qualquer ordem com um código do iTouching cujo `requires_wo` não seja true.
-- Foi escrita para uma pergunta só, "a manutenção deve ser chamada a isto?", e
-- respondia-a bem. Só que passou a ser a resposta a uma pergunta que ninguém lhe
-- fez: uma ordem de ARMAZÉM traz o mesmo código e leva a mesma recusa. Sem esta
-- alteração o poll insere, o Postgres cala, e o ecrã do armazém fica vazio sem
-- um único erro em lado nenhum.
--
-- A excepção é estreita de propósito: `wo_type = 'warehouse_service'`, que é um
-- tipo que por desenho nunca abre `downtime_events` nem conta como avaria (ver
-- `20260731120000_preventive_work_orders.sql`). Tudo o resto — a paragem
-- planeada, o tempo de equipa, o `requires_wo` — continua a ser julgado como
-- era, porque tudo isso é sobre chamar a manutenção, e isto não chama ninguém da
-- manutenção.
CREATE OR REPLACE FUNCTION public.enforce_intouch_wo_requires_maintenance_code()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
declare
  _requires boolean;
  _code text := btrim(coalesce(new.intouch_downtime_code, ''));
  _label text;
  _planned boolean;
  _activity text;
begin
  -- Manual orders are untouched: this only governs what iTouching may open.
  if _code = '' then
    return new;
  end if;

  -- Uma ordem de armazém não é uma ordem de manutenção, e é só sobre ordens de
  -- manutenção que esta função sabe alguma coisa. Quem decide se uma paragem
  -- chama o armazém é `intouch_stop_code_map.raises_warehouse_wo`, e o poll é o
  -- único que escreve estas linhas.
  if coalesce(new.wo_type, 'production') = 'warehouse_service' then
    return new;
  end if;

  select m.requires_wo, m.label into _requires, _label
  from public.intouch_stop_code_map m
  where lower(m.stop_code) = lower(_code)
  limit 1;

  -- A paragem que o iTouching diz ser planeada, ou que já está classificada como
  -- tempo da equipa, nunca abre ordem — independentemente do requires_wo.
  -- `order by ... desc nulls last`: o catálogo tem nomes repetidos com code_id
  -- diferentes, e basta uma das linhas dizer planeada para o ser.
  select c.planned into _planned
  from public.intouch_stop_code_catalog c
  where lower(btrim(c.name)) = lower(btrim(coalesce(_label, '')))
  order by c.planned desc nulls last
  limit 1;

  select e.activity into _activity
  from public.intouch_exclusion_map e
  where e.active
    and lower(btrim(e.stop_code_name)) = lower(btrim(coalesce(_label, '')))
  limit 1;

  if _planned is true or _activity is not null then
    insert into public.audit_logs (user_id, user_name, action, entity_type, details)
    values (null, 'system', 'intouch_wo_blocked', 'work_order',
            jsonb_build_object(
              'reason', case when _activity is not null
                             then 'team activity (' || _activity || ')'
                             else 'planned stop code' end,
              'stop_code', _code, 'label', _label,
              'machine', new.machine, 'description', new.description));
    return null;
  end if;

  if _requires is not true then
    insert into public.audit_logs (user_id, user_name, action, entity_type, details)
    values (null, 'system', 'intouch_wo_blocked', 'work_order',
            jsonb_build_object(
              'reason', case when _requires is null then 'stop code not mapped' else 'requires_wo = false' end,
              'stop_code', _code, 'machine', new.machine, 'description', new.description));
    return null;
  end if;

  -- Rewrite the poller's raw notes into something an engineer can read. The
  -- poller writes "[Auto-created from iTouching poll] / Machine: X / Status: 7 /
  -- Downtime code: <GUID>" — the status number is meaningless on the floor and
  -- nobody can tell what a GUID refers to. The edge function was fixed to write
  -- this properly, but edge functions do not deploy with the front end, so this
  -- normalises the text no matter which version of the poller is running.
  if new.notes like '[Auto-created from iTouching poll]%' then
    new.notes := coalesce(_label, new.description, 'Stop') || ' detected automatically by iTouching.' || chr(10)
              || 'Machine: ' || coalesce(
                   nullif(btrim(split_part(split_part(new.notes, 'Machine: ', 2), chr(10), 1)), ''),
                   new.machine, '—')
              || chr(10)
              || 'Detected: ' || to_char(coalesce(new.created_at, now()) at time zone 'Europe/London', 'DD/MM/YYYY HH24:MI');
  end if;

  return new;
end
$function$;

COMMENT ON FUNCTION public.enforce_intouch_wo_requires_maintenance_code() IS
  'Só as ordens de MANUTENÇÃO do iTouching são governadas aqui. Uma paragem planeada no catálogo, ou classificada como tempo da equipa, nunca abre ordem — mesmo com requires_wo ligado. A recusa fica em audit_logs como intouch_wo_blocked. As ordens de armazém (wo_type = warehouse_service) passam sem julgamento: quem as decide é intouch_stop_code_map.raises_warehouse_wo.';

-- 4 ─ A saúde da máquina não pode descer por o armazém se atrasar.
--
-- `recalculate_health_scores` conta TODAS as ordens da máquina nos últimos 30
-- dias e tira 5 pontos por cada uma. Não olha ao `wo_type`. Com 2 a 5 esperas de
-- armazém por dia, cada máquina de enchimento juntaria entre 60 e 150 ordens em
-- 30 dias e a conta `100 - 5*n` punha-a em ZERO — não por avariar, mas por ter
-- esperado por embalagem. A média das 28 máquinas é 66 hoje.
--
-- O erro já existia em pequeno: as ordens de armazém abertas à mão no
-- `/dashboard/warehouse` e as preventivas sempre contaram como avarias aqui. A
-- app já não as conta — `NON_FAILURE_TYPES` em `src/lib/pmIntelligence.ts` e o
-- filtro em `ReliabilityDashboard.tsx` excluem as duas — por isso o número no
-- ecrã e o número na coluna diziam coisas diferentes sobre a mesma máquina.
-- Alinha-se a base com a regra que a app já aplica.
CREATE OR REPLACE FUNCTION public.recalculate_health_scores()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _machine_name text;
  _wo_count integer;
  _long_repair_count integer;
  _recurrent_count integer;
  _score integer;
BEGIN
  _machine_name := COALESCE(NEW.machine, OLD.machine);

  -- Count WOs in last 30 days. Só as correctivas: uma preventiva é trabalho
  -- planeado e uma de armazém nunca tocou na máquina.
  SELECT COUNT(*) INTO _wo_count
  FROM work_orders
  WHERE machine = _machine_name
    AND COALESCE(wo_type, 'production') = 'production'
    AND created_at >= now() - interval '30 days';

  -- Count WOs with repair > 120 min in last 30 days
  SELECT COUNT(*) INTO _long_repair_count
  FROM work_orders
  WHERE machine = _machine_name
    AND COALESCE(wo_type, 'production') = 'production'
    AND created_at >= now() - interval '30 days'
    AND started_at IS NOT NULL
    AND finished_at IS NOT NULL
    AND EXTRACT(EPOCH FROM (finished_at - started_at)) / 60 > 120;

  -- Count recurrent problems (same problem >= 3 times in 30 days)
  SELECT COUNT(*) INTO _recurrent_count
  FROM (
    SELECT description, COUNT(*) as cnt
    FROM work_orders
    WHERE machine = _machine_name
      AND COALESCE(wo_type, 'production') = 'production'
      AND created_at >= now() - interval '30 days'
    GROUP BY description
    HAVING COUNT(*) >= 3
  ) sub;

  -- Calculate score: 100 - 5*wo_count - 10*long_repairs - 15*recurrent
  _score := GREATEST(0, 100 - (_wo_count * 5) - (_long_repair_count * 10) - (_recurrent_count * 15));

  -- Update machine health score
  UPDATE machines SET health_score = _score WHERE name = _machine_name;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.recalculate_health_scores() IS
  'Saúde da máquina a partir das ordens CORRECTIVAS dos últimos 30 dias. Preventivas e ordens de armazém não entram — a mesma regra que src/lib/pmIntelligence.ts aplica no ecrã.';

-- 5 ─ Esperar por embalagem não é uma manutenção feita.
--
-- `sync_machine_status_from_wo` corre ao fechar qualquer ordem e, se não houver
-- outra aberta na máquina, põe `machines.status = 'active'` e carimba
-- `last_maintenance_date = now()`. Numa ordem de armazém isso são duas mentiras
-- pequenas e diárias: ninguém fez manutenção nenhuma, e uma máquina que estava
-- em 'maintenance' por outra razão voltaria a 'active' porque o armazém trouxe
-- as caixas.
CREATE OR REPLACE FUNCTION public.sync_machine_status_from_wo()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _open_wo_count integer;
BEGIN
  -- Only act on status changes
  IF OLD.status = NEW.status THEN
    RETURN NEW;
  END IF;

  -- Uma ordem de armazém não diz nada sobre o estado da máquina.
  IF COALESCE(NEW.wo_type, 'production') = 'warehouse_service' THEN
    RETURN NEW;
  END IF;

  -- When WO becomes open or in_progress, set machine to maintenance
  IF NEW.status IN ('open', 'in_progress') THEN
    UPDATE machines SET status = 'maintenance' WHERE name = NEW.machine;
  END IF;

  -- When WO is closed or finished, check if there are other active WOs for this machine
  IF NEW.status IN ('closed', 'finished', 'completed', 'force_closed') THEN
    SELECT COUNT(*) INTO _open_wo_count
    FROM work_orders
    WHERE machine = NEW.machine
      AND id != NEW.id
      AND COALESCE(wo_type, 'production') <> 'warehouse_service'
      AND status NOT IN ('closed', 'finished', 'completed', 'force_closed');

    IF _open_wo_count = 0 THEN
      UPDATE machines
      SET status = 'active',
          last_maintenance_date = now()
      WHERE name = NEW.machine;
    ELSE
      -- Still has open WOs, just update last_maintenance_date
      UPDATE machines
      SET last_maintenance_date = now()
      WHERE name = NEW.machine;
    END IF;
  END IF;

  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION public.sync_machine_status_from_wo() IS
  'Estado da máquina a partir das ordens que lhe tocam. As ordens de armazém (warehouse_service) não entram, nem para mudar o estado nem para o contar: esperar por embalagem não é manutenção feita.';

-- ================================================================
-- BLOCO 51B
-- 20260920043132_29205a62-5c78-403c-93f6-557f22d257bd.sql
-- ================================================================

-- Headcount board areas only. Nothing in `lines` is touched: RAG, scorecards and
-- downtime read those rows.

-- Retired rather than deleted: daily_allocations rows point at them and the history
-- of every board already drawn has to keep reading back.
UPDATE public.headcount_areas
   SET active = false, sheet_group = NULL
 WHERE name IN ('Capsules Machine 1', 'Capsules Machine 2');

-- The column the workbook calls "Pill line". line_id stays null: the Headcount board
-- never reads it (areas such as Gel Room, Hygiene and Quality have none either), and
-- inventing a link would tie a headcount column to a production line it is not.
INSERT INTO public.headcount_areas (name, kind, section, department, sheet_label, sort_order, active)
SELECT 'Pill Line', 'production', 'production', 'Production', 'Pill line', 80, true
 WHERE NOT EXISTS (SELECT 1 FROM public.headcount_areas WHERE name = 'Pill Line');

-- The night workbook has a Wrapping column.
INSERT INTO public.headcount_areas (name, kind, section, department, sheet_label, sort_order, active)
SELECT 'Wrapping', 'production', 'production', 'Production', 'Wrapping', 155, true
 WHERE NOT EXISTS (SELECT 1 FROM public.headcount_areas WHERE name = 'Wrapping');

-- The night workbook writes it "GELL ROOM". sheet_label takes a comma-separated list.
UPDATE public.headcount_areas
   SET sheet_label = 'Gel Room, GELL ROOM'
 WHERE name = 'Gel Room' AND (sheet_label IS NULL OR sheet_label = 'Gel Room');

-- A ordem do armazém não é da manutenção.
--
-- A `20260919090000` fez a espera de embalagem abrir a sua própria ordem, do
-- tipo `warehouse_service`, e deu ao papel `warehouse` uma policy para a ver. O
-- que não fez foi tirá-la a quem já via tudo: `Engineers can view WOs` é
-- `has_role(auth.uid(), 'engineer')` e mais nada, sem uma palavra sobre
-- `wo_type`. As policies de leitura são permissivas e somam-se, portanto a
-- ordem nova entrou na vista dos engenheiros pela porta que já estava aberta.
--
-- No dia 09/09 foi exactamente isso que aconteceu: a primeira ordem de armazém
-- apareceu no quadro do engenheiro, dentro do contador "Open Maintenance
-- Order(s) Waiting!", e tocou-lhe a sirene. Um trabalho que não é dele, que ele
-- não consegue fechar, e que ninguém lhe explicou.
--
-- UMA POLICY RESTRITIVA, E NÃO UMA EMENDA ÀS QUE EXISTEM. Há sete policies de
-- leitura nesta tabela e a resposta certa está na intersecção de todas: as
-- ordens de armazém são do armazém, ponto. Emendar as sete uma a uma seria sete
-- oportunidades de enganar-me e sete sítios para a próxima pessoa ter de
-- lembrar-se de repetir a regra. Uma restritiva soma-se por AND a tudo o que
-- houver, agora e no futuro, e diz a regra uma vez só.
--
-- `FOR ALL` e não `FOR SELECT`: um engenheiro que não pode ver a ordem também
-- não tem nada que a escrever, e `Engineers can update locked or unlocked WOs`
-- deixá-lo-ia fazê-lo às cegas. Numa policy restritiva sem `WITH CHECK` o
-- Postgres usa o `USING` também para a verificação de escrita, que é o que se
-- quer aqui.
--
-- QUEM FICA. `warehouse` e `admin`. É o que foi decidido, e é mais estreito do
-- que o desenho anterior: o líder de linha (papel `operator`) via a ordem da
-- sua própria linha por causa de `Operators view own or assigned-line WOs`, e
-- deixa de a ver. Fica registado aqui porque é a consequência menos óbvia
-- desta migração, e a que se há-de querer rever primeiro.
--
-- O poll não é afectado: corre com a service role, que não passa por RLS.
--
-- Já aplicada à base a 09/09/2026 pelo MCP do Lovable. Este ficheiro é o
-- registo, e é idempotente para poder correr outra vez sem estoirar.

DROP POLICY IF EXISTS "Warehouse orders belong to the warehouse" ON public.work_orders;

CREATE POLICY "Warehouse orders belong to the warehouse"
ON public.work_orders
AS RESTRICTIVE
FOR ALL
TO public
USING (
  coalesce(wo_type, 'production') <> 'warehouse_service'
  OR has_role(auth.uid(), 'admin'::app_role)
  OR EXISTS (
    SELECT 1 FROM public.user_roles ur
    WHERE ur.user_id = auth.uid() AND ur.role::text = 'warehouse'
  )
);


-- ================================================================
-- BLOCO 45
-- 20260920090000_o_numero_da_accao_vive_no_outro_sistema.sql
-- ================================================================

-- A projecção do tablet passa a dizer de que sistema veio a linha.
--
-- 115 das 135 acções não têm `action_no`, e as duas ausências não são a mesma coisa.
-- Uma acção escrita à mão no ecrã de Quality pode simplesmente nunca ter recebido
-- número. Uma acção da SafetyCulture TEM sempre um — `unique_id`, "A-1042", o número
-- que a fábrica lê no telemóvel — e é esta base que ainda não o guarda: nas 66 linhas
-- importadas o campo está a NULL, incluindo nas 36 que a SafetyCulture voltou a
-- alterar depois de o importador aprender a lê-lo.
--
-- Sem `source` o cartão não consegue distinguir os dois casos e a única saída honesta
-- é não escrever nada em nenhum — que é o que fazia. Com ele, uma linha sem referência
-- diz onde a referência vive, e passa a mostrar o número no dia em que ele chegar, sem
-- mais nenhuma alteração aqui.
--
-- O select do gestor já podia pedir a coluna (é PostgREST sobre a tabela); esta função
-- é a outra via, e as duas têm de projectar o mesmo campo ou o líder e o gestor leem
-- cartões diferentes sobre a mesma pessoa — que é a única coisa que este módulo não
-- pode fazer. Ver LeaderScorecardBody.
--
-- Escrito como emenda ao texto da função e não como CREATE OR REPLACE completo, pelo
-- mesmo motivo que 20260908170000: o corpo desta função é longo e tem sido alterado
-- por várias migrações, e recopiá-lo por inteiro faz desta migração uma reversão
-- silenciosa de tudo o que entrou depois da cópia.
--
-- E acrescenta mais duas ao mesmo tempo, que não são novidade nenhuma para a base e
-- são-no para este repositório. `title` e `error_type` ESTÃO na função em produção e
-- não há migração nenhuma aqui que os lá tenha posto — entraram por fora. Enquanto
-- assim for, qualquer reconstrução da função a partir das migrações apaga-os, e a
-- projecção do tablet volta a dizer "No description recorded" sobre as 54 acções que
-- só se descrevem no `title`. Ficam declarados aqui para que o repositório passe a
-- explicar o que a produção já tem. Cada coluna é acrescentada só se faltar, portanto
-- correr isto contra a base de hoje só acrescenta `source`.
DO $$
DECLARE
  _src   text;
  _col   text;
  _anchor constant text := 'qa.points_at_creation';
  _added text[] := '{}';
BEGIN
  SELECT pg_get_functiondef(p.oid) INTO _src
    FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public' AND p.proname = 'leader_self_scorecard'
   LIMIT 1;

  IF _src IS NULL THEN
    RAISE NOTICE 'leader_self_scorecard nao existe nesta base. Sem alteracao.';
    RETURN;
  END IF;

  IF position(_anchor IN _src) = 0 THEN
    RAISE EXCEPTION
      'leader_self_scorecard nao contem "%" — a funcao mudou de forma. Acrescentar as '
      'colunas a mao. Uma projeccao que nao traz a coluna entrega-a como NULL, e todos '
      'os predicados deste modulo leem NULL como "nao ha motivo para excluir".', _anchor;
  END IF;

  -- Escritas por extenso, e não montadas a partir do nome da coluna: é assim que
  -- theTwoCardsProjectTheSameRow.test.ts consegue ler daqui o que esta função projecta.
  -- Um teste que não consegue ver a coluna no ficheiro não guarda nada.
  FOREACH _col IN ARRAY ARRAY['qa.source', 'qa.title', 'qa.error_type'] LOOP
    IF position(_col IN _src) = 0 THEN
      _src := replace(_src, _anchor, _anchor || ', ' || _col);
      _added := _added || _col;
    END IF;
  END LOOP;

  IF cardinality(_added) = 0 THEN
    RAISE NOTICE 'leader_self_scorecard ja projecta source, title e error_type. Sem alteracao.';
    RETURN;
  END IF;

  EXECUTE _src;
  RAISE NOTICE 'leader_self_scorecard passa a projectar %.', array_to_string(_added, ', ');
END $$;

-- ================================================================
-- BLOCO 46
-- 20260921090000_a_causa_raiz_tinha_de_mexer_o_numero.sql
-- ================================================================

-- =====================================================================
-- A root cause nobody writes, and that changed no number when they did
-- =====================================================================
--
-- 20260911075414 added `quality_actions.root_cause_area` so that a machine fault would
-- stop charging the shift leader through a side door — `Batch code` + `Maintenance`
-- charging 5 because the label rule needs only ONE attributable label. The reasoning
-- there still stands and none of it is reopened here.
--
-- It did not work. Two independent reasons, both found on 2026-09-11 by reading the
-- live base rather than the repo:
--
--   1. THE COLUMN WAS EMPTY. 0 of 182 rows carried a root cause. 84 of those actions
--      arrive from the SafetyCulture sync, which never writes the field (it does not
--      write `department` either, which is why the department veto of 20260827093000
--      has never fired on a synced row). The field could only be filled by a person
--      opening one action at a time, and no person did.
--
--   2. FILLING IT IN CHANGED NOTHING. `trg_quality_action_freeze_points_upd` re-prices
--      an action when one of the inputs to the price changes, and its WHEN clause named
--      severity, labels, validation_status and domain — but NOT root_cause_area. So
--      Quality could set the root cause, the value was stored, the history recorded it,
--      and `points_at_creation` — the only figure a scorecard reads — stayed exactly
--      where it was. The instruction "open the action and mark the root cause" could not
--      have worked for anybody who followed it.
--
-- The second is the worse of the two, because it fails in the direction that looks like
-- success: the field saves, the screen's LIVE preview recomputes and shows 0, and the
-- frozen number behind the card still says 5. Two numbers for one action, which is the
-- exact failure the freezing mechanism exists to prevent.
--
-- What this migration does NOT change: the label rule (`countsAgainstLeader`) is not
-- flipped to a veto. That lever was removed on purpose in `cd417686` and the note above
-- it explains why at length — a label lives in a SET, and anyone who worked out that
-- adding "Maintenance" to a genuine paperwork error cleared it would have an amnesty
-- nobody audits. The root cause is the instrument that closes the same door while
-- staying auditable: exactly one per action, its own column, its own history row with a
-- name and a time, and writable only by Quality (trg_a_quality_root_cause_guard).
--
-- And NOT the gate. `Foreign Body` + `Maintenance` now charges 0 points and still caps
-- the period at CAP_Gate, because the gate is computed over the LABELS — in
-- `scorecard_*` and in computeLeaderScore (src/lib/leaderScore.ts, the gateLabels test
-- on `a.labels`) — and never over `action_points_at`. A 0 returned there cannot silence
-- one. That is what BRC requires: a foreign body counts on the line it happened on,
-- whoever was at fault.

-- =====================================================================
-- 1. The re-pricing trigger learns about the field
-- =====================================================================
--
-- One line — `root_cause_area` — and without it nothing else in this file matters.

DROP TRIGGER IF EXISTS trg_quality_action_freeze_points_upd ON public.quality_actions;

CREATE TRIGGER trg_quality_action_freeze_points_upd
BEFORE UPDATE ON public.quality_actions
FOR EACH ROW
WHEN (
  old.severity          IS DISTINCT FROM new.severity
  OR old.labels            IS DISTINCT FROM new.labels
  OR old.validation_status IS DISTINCT FROM new.validation_status
  OR old.domain            IS DISTINCT FROM new.domain
  OR old.root_cause_area   IS DISTINCT FROM new.root_cause_area
)
EXECUTE FUNCTION public.quality_action_freeze_points();

COMMENT ON TRIGGER trg_quality_action_freeze_points_upd ON public.quality_actions IS
  'Recongela points_at_creation quando muda um input do preco. root_cause_area faltava '
  'aqui: a causa raiz gravava-se e o numero ficava o mesmo, por isso marcar Maintenance '
  'numa accao nao mudava cartao nenhum.';

-- =====================================================================
-- 2. The Maintenance label declares the root cause instead of hinting at it
-- =====================================================================
--
-- A default, not an override, and the difference is the whole design. The label says
-- "a machine is involved"; the factory has decided that when nobody says otherwise,
-- a machine being involved means the machine is the cause. Quality disagreeing is the
-- case this must not break, so an explicit value — including an explicit `Production`
-- that puts the charge back — always wins and is never touched here.
--
-- In a trigger rather than in the sync edge function or the log form, because there are
-- four writers to this table (the form, the SafetyCulture sync, the importer, and SQL
-- run by hand) and a rule placed in one of them is a rule the other three do not have.
--
-- The `_b_` in the name is load-bearing. Trigger order is alphabetical, and this must
-- run:
--   * AFTER trg_a_quality_root_cause_guard — that guard raises 42501 when somebody
--     without `quality.validate`/`quality.manage` sets a root cause. Firing first would
--     mean a line leader logging a machine fault got "Only Quality may set the root
--     cause of an action." thrown in their face for ticking a label.
--   * BEFORE trg_quality_action_freeze_points_* — which is what actually re-prices, and
--     reads NEW as the BEFORE triggers have left it.

CREATE OR REPLACE FUNCTION public.default_root_cause_from_label()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
BEGIN
  -- So preenche o vazio. Uma causa raiz escrita pela Qualidade manda sempre: quem
  -- disser que a culpa foi da Producao num equipamento avariado tem de continuar a
  -- ver os pontos a voltar.
  IF NEW.root_cause_area IS NOT NULL THEN RETURN NEW; END IF;

  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(NEW.labels, ARRAY[]::text[])) AS l
     WHERE lower(btrim(l)) = 'maintenance'
  ) THEN
    NEW.root_cause_area := 'Maintenance';
  END IF;

  RETURN NEW;
END $function$;

COMMENT ON FUNCTION public.default_root_cause_from_label() IS
  'O rotulo Maintenance passa a declarar a causa raiz em vez de a insinuar. O nome do '
  'gatilho comeca por _b_ de proposito: tem de correr DEPOIS do '
  'trg_a_quality_root_cause_guard (senao um lider que registe uma avaria levava com o '
  'erro "Only Quality may set the root cause") e ANTES do '
  'trg_quality_action_freeze_points_upd, que e quem repreca a accao.';

DROP TRIGGER IF EXISTS trg_b_quality_root_cause_default ON public.quality_actions;

CREATE TRIGGER trg_b_quality_root_cause_default
BEFORE INSERT OR UPDATE ON public.quality_actions
FOR EACH ROW
EXECUTE FUNCTION public.default_root_cause_from_label();

-- =====================================================================
-- 3. The 47 rows that were already logged
-- =====================================================================
--
-- 20260911075414 deliberately back-filled nothing — "every row that exists today keeps
-- exactly the score it has today". That was the right call for a field whose meaning
-- was still being decided; it is the wrong one now that the rule is settled and the
-- consequence of leaving it is known. What was left standing, read off the live base:
--
--   23 actions carrying `Maintenance` alongside a priced label, charging 100 points,
--   51 of them to a named leader. Henrique 11, Ailton 10, and 5 each to Kaz, Kleyve,
--   Lucas, Nilton and Everton for, among others:
--
--     "The ceiling in the women's restroom requires repair"          GMP  5
--     "The floor needs to be repaired (canteen upstairs)"            GMP  5
--     "Laboratory Air Conditioner Leaking"                           GMP  5
--     "The table in line 1 needs to be repaired or replaced"         GMP  5
--     "Filling line 3 needs to be painted"                           GMP  5
--
-- A leader losing five quality points because a canteen ceiling needs plastering is not
-- a rounding error in an appraisal, it is the appraisal being wrong.
--
-- Scoped to the label, and to rows where nobody has said anything: `root_cause_area IS
-- NULL` means the question was never answered, and only that. A row somebody HAS
-- answered is left exactly as they answered it. The UPDATE re-fires the trigger above,
-- which re-prices each row against `scoring_version_id` as it already stands — so v1
-- rows are re-priced on v1's scale, v2 on v2's, and no action is quietly dragged onto
-- today's ruler. Idempotent: on a base where this has run, it matches no rows.

UPDATE public.quality_actions
   SET root_cause_area = 'Maintenance'
 WHERE root_cause_area IS NULL
   AND EXISTS (
     SELECT 1 FROM unnest(coalesce(labels, ARRAY[]::text[])) AS l
      WHERE lower(btrim(l)) = 'maintenance'
   );

-- ================================================================
-- BLOCO 47
-- 20260921122320_63d476d1-9e39-45ce-b5d0-579113ca4fc0.sql
-- ================================================================

CREATE TABLE public.technical_info_topics (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  title text NOT NULL,
  kind text NOT NULL DEFAULT 'table' CHECK (kind IN ('table','pdf')),
  columns jsonb NOT NULL DEFAULT '[]'::jsonb,
  rows jsonb NOT NULL DEFAULT '[]'::jsonb,
  note text,
  file_path text,
  sort_order integer NOT NULL DEFAULT 100,
  created_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.technical_info_topics TO authenticated;
GRANT ALL ON public.technical_info_topics TO service_role;

ALTER TABLE public.technical_info_topics ENABLE ROW LEVEL SECURITY;

CREATE POLICY "technical_info_select_auth" ON public.technical_info_topics
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);
CREATE POLICY "technical_info_insert_auth" ON public.technical_info_topics
  FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "technical_info_update_auth" ON public.technical_info_topics
  FOR UPDATE TO authenticated USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "technical_info_delete_auth" ON public.technical_info_topics
  FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

CREATE TRIGGER technical_info_topics_updated_at
  BEFORE UPDATE ON public.technical_info_topics
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

CREATE POLICY "technical_docs_read" ON storage.objects
  FOR SELECT TO authenticated USING (bucket_id = 'technical-docs');
CREATE POLICY "technical_docs_insert" ON storage.objects
  FOR INSERT TO authenticated WITH CHECK (bucket_id = 'technical-docs');
CREATE POLICY "technical_docs_delete" ON storage.objects
  FOR DELETE TO authenticated USING (bucket_id = 'technical-docs');

INSERT INTO public.technical_info_topics (title, kind, columns, rows, note, sort_order)
VALUES (
  'Palletiser Robot — Pallet configuration',
  'table',
  '["Prog","Pallet","Tub","Boxes per layer","Total layers","Total tubes"]'::jsonb,
  '[["1","EURO","750","6","11","792"],["2","EURO","1000","6","8","576"],["3","STANDARD","750","8","15","1500"],["4","STANDARD","750","8","10","960"],["5","STANDARD","1000","8","13","1248"],["6","STANDARD","750","16","11","792"],["7","STANDARD","750","8","8","768"]]'::jsonb,
  '6 tubes per box',
  10
);




-- ================================================================
-- BLOCO 48
-- 20260922090000_um_dia_de_formacao_nao_e_um_dia_de_falta.sql
-- ================================================================

-- Training on the production board.
--
-- `employee_attendance` has accepted `training` since the workforce board was written
-- — it is one of six values its check constraint allows. `daily_allocations` never
-- did, so the board a supervisor actually plans the day on had five statuses and no
-- word for the one thing that is neither a line nor an absence: somebody who came in,
-- is paid, and spent the shift in a classroom.
--
-- With nowhere to put them they were marked as holiday, or left off the board and
-- counted as unallocated. Both are wrong in the same direction: the first spends a day
-- of their annual leave, the second makes the shift look short-staffed at a glance.
--
-- Nothing else about the row changes. The two partial constraints already on the table
-- refuse a late arrival or an early finish on any status but `assigned` and `overtime`,
-- and a training row is written with `area_id` null, exactly as sickness and holiday
-- are — they are not at a place that day.
ALTER TABLE public.daily_allocations DROP CONSTRAINT IF EXISTS daily_allocations_status_check;
ALTER TABLE public.daily_allocations ADD CONSTRAINT daily_allocations_status_check
  CHECK (status = ANY (ARRAY['assigned','overtime','sick','unpaid','holiday','training']));



-- ================================================================
-- BLOCO 49
-- 20260923090000_o_zero_que_ninguem_mediu_e_o_turno_que_ninguem_escreveu.sql
-- ================================================================

-- Duas colunas que inventavam uma medição, e uma que apagava metade do trabalho.
--
-- A tela Production Performance imprimia, em todas as linhas, "0.0%" de sucata, "0"
-- de equipa e "0" pontos de qualidade. Nenhum dos três era uma leitura: eram o
-- default da coluna e um filtro a cair no vazio.
--
--   1. production_items.scrap_qty é NOT NULL DEFAULT 0. Das 943 linhas, 943 valem
--      exactamente 0 e nenhuma é NULL — ou seja, o ramo "not recorded" que o
--      LineIndicators e o ShiftScrapCard escrevem contra NULL nunca chegou a correr.
--      Pior: com scrap "registada" em toda a parte, a nota honesta ("Scrap — o campo
--      acabou de abrir") desaparecia do rodapé da tabela.
--
--   2. production_sessions.staff_actual já levou esta correcção uma vez, em
--      20260801120000, que anulou os 231 zeros que existiam nesse dia. O que essa
--      migração não fez foi tirar o DEFAULT 0 — e as 493 sessões criadas desde então
--      nasceram outra vez a dizer que a linha correu sem ninguém lá.
--
--   3. quality_actions.shift só é escrito pela origem 'pm' (69 linhas, todas
--      carimbadas às 12:00 de Londres, que é um meio-dia sintético: o formulário só
--      pede a data). A sync do SafetyCulture — 123 linhas, com instantes reais
--      espalhados por todas as horas — nunca o escreveu. E a tela abre fixada no
--      turno a correr, com `.eq("shift", …)` no servidor, portanto derrubava todas
--      as acções vivas: zero pontos e zero acções abertas em cada linha, todos os
--      dias.
--
-- Zero é uma afirmação. NULL é a única coisa verdadeira que estas colunas tinham
-- para dizer, e o turno de uma acção com hora real lê-se do relógio da fábrica.

-- 1. Sucata: em branco quer dizer que ninguém mediu.
--    O 0 que alguém escreveu de propósito no ShiftScrapCard continua a valer 0 — mas
--    a partir de agora é distinguível, porque nenhum é criado sozinho.
ALTER TABLE public.production_items
  ALTER COLUMN scrap_qty DROP DEFAULT,
  ALTER COLUMN scrap_qty DROP NOT NULL;

UPDATE public.production_items SET scrap_qty = NULL WHERE scrap_qty = 0;

-- 2. Efectivo: o mesmo, e desta vez sem o default a repor o problema.
ALTER TABLE public.production_sessions
  ALTER COLUMN staff_actual  DROP DEFAULT,
  ALTER COLUMN staff_planned DROP DEFAULT;

UPDATE public.production_sessions SET staff_actual  = NULL WHERE staff_actual  = 0;
UPDATE public.production_sessions SET staff_planned = NULL WHERE staff_planned = 0;

-- 3. O turno de uma acção do SafetyCulture, lido do instante em que foi levantada.
--    Day 06:00–17:59, Night 18:00–05:59, hora de Londres — a mesma regra que
--    src/lib/shifts.ts aplica no ecrã e que workOrdersInPeriod() já aplica a uma
--    ordem de trabalho, que também não tem coluna de turno.
--
--    Só as linhas da sync. As da origem 'pm' ficam como estão: o meio-dia delas é
--    sintético e derivar DAY dele seria trocar um branco honesto por uma invenção.
CREATE OR REPLACE FUNCTION public.factory_shift_of(at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXTRACT(HOUR FROM (at AT TIME ZONE 'Europe/London')) BETWEEN 6 AND 17
    THEN 'DAY' ELSE 'NIGHT'
  END;
$$;

UPDATE public.quality_actions
   SET shift = public.factory_shift_of(recorded_at)
 WHERE shift IS NULL
   AND source = 'safetyculture'
   AND recorded_at IS NOT NULL;

-- E a mesma regra à porta, para que o próximo deploy da edge function não possa
-- voltar a esquecer-se dela. Cada edge function tem o seu deploy e a sync pode ficar
-- atrás do resto do sistema durante dias; o gatilho fecha essa janela.
-- Só actua quando o escritor não disse nada — quem preenche o turno manda.
CREATE OR REPLACE FUNCTION public.quality_action_stamp_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.shift IS NULL
     AND NEW.source = 'safetyculture'
     AND NEW.recorded_at IS NOT NULL
  THEN
    NEW.shift := public.factory_shift_of(NEW.recorded_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quality_action_stamp_shift ON public.quality_actions;
CREATE TRIGGER trg_quality_action_stamp_shift
BEFORE INSERT OR UPDATE OF recorded_at, shift ON public.quality_actions
FOR EACH ROW
EXECUTE FUNCTION public.quality_action_stamp_shift();

-- Recriar uma função devolve-lhe o anon: nenhuma destas é para ser chamada de fora.
REVOKE ALL ON FUNCTION public.factory_shift_of(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quality_action_stamp_shift() FROM PUBLIC, anon, authenticated;

-- ================================================================
-- BLOCO 50
-- 20260924090000_a_ordem_do_armazem_tem_a_sua_propria_serie.sql
-- ================================================================

-- A ordem do armazém tem a sua própria série.
--
-- `work_orders.wo_number` é `DEFAULT nextval('wo_number_seq')` — uma sequência
-- só para toda a gente — com um índice UNIQUE por cima. As 14 ordens de armazém
-- abertas desde 09/09 tiraram senha dessa fila: ficaram com os números 1027,
-- 1042, 1051… e deixaram catorze buracos na série da manutenção, que é a série
-- que vai nas folhas assinadas.
--
-- UMA COLUNA NOVA, E NÃO UMA SEGUNDA SEQUÊNCIA NA MESMA COLUNA. Duas sequências
-- a escrever em `wo_number` colidem contra o UNIQUE assim que a segunda alcançar
-- um número que a primeira já deu — não é um risco teórico, é uma questão de
-- semanas. Tornar o índice parcial por `wo_type` partia a única coisa que
-- `wo_number` promete: que identifica uma ordem.
--
-- Por isso `wo_number` não se toca. Fica o identificador interno, o índice fica
-- íntegro, e a única consulta do sistema que procura por ele
-- (`src/lib/mcp/tools/get-work-order.ts`) não dá por nada. O que é novo é
-- `warehouse_number`, preenchido só para as ordens de armazém, e é ele que a
-- interface escreve como `WH-2026-000001`.
--
-- AS 14 QUE JÁ EXISTEM SÃO RENUMERADAS, por ordem de abertura. Decidido com o
-- utilizador a 15/09/2026. É seguro precisamente porque o `wo_number` antigo não
-- desaparece: quem tiver uma folha com WO-2026-001027 continua a encontrá-la
-- pela pesquisa.
--
-- O trigger é BEFORE INSERT e não um DEFAULT na coluna: um default corre em toda
-- a linha inserida, e só as de armazém podem gastar a sequência. Uma ordem de
-- manutenção que passasse por aqui deixaria um buraco na série nova — o mesmo
-- erro, ao contrário.

-- ── A sequência ──────────────────────────────────────────────────────────────
CREATE SEQUENCE IF NOT EXISTS public.warehouse_number_seq AS integer START WITH 1;

-- ── A coluna ─────────────────────────────────────────────────────────────────
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS warehouse_number integer;

COMMENT ON COLUMN public.work_orders.warehouse_number IS
  'Série própria das ordens de armazém (WH-YYYY-NNNNNN). Nula em tudo o resto. O wo_number continua a ser o identificador da ordem.';

-- Único entre as ordens de armazém, e indiferente às outras: um índice parcial
-- diz exactamente isso, e não obriga as 616 ordens de manutenção a carregar uma
-- entrada nula cada.
CREATE UNIQUE INDEX IF NOT EXISTS idx_work_orders_warehouse_number
  ON public.work_orders (warehouse_number)
  WHERE warehouse_number IS NOT NULL;

-- ── Quem o atribui ───────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.work_orders_set_warehouse_number()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- `to_jsonb(NEW)->>'wo_type'` e não `NEW.wo_type`: é como os outros triggers
  -- desta tabela lêem campos que podem não existir na versão da linha que lhes
  -- chega, e custa o mesmo.
  IF coalesce(to_jsonb(NEW)->>'wo_type', 'production') = 'warehouse_service'
     AND NEW.warehouse_number IS NULL THEN
    NEW.warehouse_number := nextval('public.warehouse_number_seq');
  END IF;
  RETURN NEW;
END;
$$;

-- `REVOKE FROM PUBLIC` porque recriar uma função devolve-lhe o EXECUTE do anon:
-- o `CREATE OR REPLACE` acima repõe os defaults de quem a pode correr.
REVOKE ALL ON FUNCTION public.work_orders_set_warehouse_number() FROM PUBLIC;

DROP TRIGGER IF EXISTS trg_work_orders_set_warehouse_number ON public.work_orders;
CREATE TRIGGER trg_work_orders_set_warehouse_number
  BEFORE INSERT ON public.work_orders
  FOR EACH ROW
  EXECUTE FUNCTION public.work_orders_set_warehouse_number();

-- ── As que já existem ────────────────────────────────────────────────────────
-- Por ordem de abertura, 1..N. Idempotente: só toca nas que ainda não têm
-- número, para poder correr outra vez sem renumerar nada.
WITH ordenadas AS (
  SELECT id, row_number() OVER (ORDER BY created_at, wo_number) AS n
  FROM public.work_orders
  WHERE coalesce(wo_type, 'production') = 'warehouse_service'
    AND warehouse_number IS NULL
)
UPDATE public.work_orders w
SET warehouse_number = o.n + coalesce(
      (SELECT max(warehouse_number) FROM public.work_orders), 0)
FROM ordenadas o
WHERE w.id = o.id;

-- A sequência continua de onde o backfill parou, ou a espera seguinte repetia
-- um número que já está numa folha.
SELECT setval(
  'public.warehouse_number_seq',
  greatest(coalesce((SELECT max(warehouse_number) FROM public.work_orders), 0), 1),
  (SELECT count(*) > 0 FROM public.work_orders WHERE warehouse_number IS NOT NULL)
);

-- ================================================================
-- BLOCO 51
-- 20260925073955_7d0e31d0-3b72-4ec1-84a9-72e46c71bb0a.sql
-- ================================================================

-- Use the existing Runner area and its history; Wrapping was an alternate label for that Headcount position.
UPDATE public.headcount_areas
SET active = true, kind = 'production', section = 'production', department = 'Production',
    sheet_label = 'Runner, Wrapping', sort_order = 130
WHERE name = 'Runner';

-- Retain all six saved Wrapping placements by moving them to the same Runner board area.
UPDATE public.daily_allocations
SET area_id = (SELECT id FROM public.headcount_areas WHERE name = 'Runner')
WHERE area_id = (SELECT id FROM public.headcount_areas WHERE name = 'Wrapping');

UPDATE public.headcount_areas SET active = false, sheet_label = NULL
WHERE name = 'Wrapping';


-- ================================================================
-- BLOCO 52
-- 20260925090000_o_pin_de_admin_nao_se_le.sql
-- ================================================================

-- O hash do PIN de admin é legível por qualquer conta autenticada.
--
-- Em Abril isto esteve fechado. `20260421105946` trocou o SELECT de tabela por um
-- SELECT de colunas em `system_settings` e deixou `admin_pin` de fora; `20260423202741`
-- repetiu-o. Depois `20260627071614` acrescentou duas colunas e, para as conceder,
-- escreveu `GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO
-- authenticated` — um grant de tabela, que cobre TODAS as colunas e apagou os dois
-- anteriores. `20260729180000` deu por isso no UPDATE e reparou-o coluna a coluna.
-- Ninguém voltou ao SELECT, e desde 27/06 que ele está aberto.
--
-- O que fica exposto é o bcrypt de um PIN de quatro dígitos. São 10 000 hipóteses:
-- quem tenha a linha parte-o na sua própria máquina em segundos, sem tocar outra vez
-- na aplicação e sem deixar rasto nenhum aqui. O que segura a porta hoje é só a RLS,
-- e o papel de admin está em 10 das 29 contas.
--
-- A MESMA ARMADILHA OUTRA VEZ: um grant de tabela cobre todas as colunas, por isso
-- revogar `admin_pin` sozinho não faz nada. É preciso deitar abaixo o grant de tabela
-- e voltar a conceder coluna a coluna. QUANDO SE ACRESCENTAR UMA COLUNA A
-- system_settings, ACRESCENTA-SE AQUI TAMBÉM — nas duas listas.
--
-- O `admin_pin` sai também do UPDATE. Ninguém no frontend o escreve: quem o muda é a
-- edge function `update-admin-pin`, que chama `set_admin_pin()` — SECURITY DEFINER, e
-- é lá que o valor passa por `crypt()`. Um PATCH directo à coluna gravaria o PIN em
-- claro por cima do hash, e a partir daí `crypt(_pin, admin_pin)` deixava de comparar
-- coisa nenhuma.

-- ── SELECT ───────────────────────────────────────────────────────────────────
REVOKE SELECT ON public.system_settings FROM authenticated, anon;

GRANT SELECT (
  id,
  created_at,
  updated_at,
  intouch_auto_wo_enabled,
  intouch_sync_enabled,
  rag_api_base_url
) ON public.system_settings TO authenticated;

-- ── UPDATE ───────────────────────────────────────────────────────────────────
-- A lista de `20260729180000` mais `rag_api_base_url` de `20260917090000`, menos
-- `admin_pin`. `intouch_sync_enabled` continua de fora: só se mexe por
-- `set_intouch_sync_enabled()`, que exige o PIN de admin e escreve em `audit_logs`.
REVOKE UPDATE ON public.system_settings FROM authenticated, anon;

GRANT UPDATE (
  id,
  created_at,
  updated_at,
  intouch_auto_wo_enabled,
  rag_api_base_url
) ON public.system_settings TO authenticated;

COMMENT ON COLUMN public.system_settings.admin_pin IS
  'Hash bcrypt do PIN de admin. Sem SELECT nem UPDATE para authenticated: lê-se por verify_admin_pin() e escreve-se por set_admin_pin(), ambas SECURITY DEFINER. Um GRANT de tabela em system_settings volta a abri-la.';

-- ================================================================
-- BLOCO 53
-- 20260925091000_o_pin_de_admin_cansa_se_de_ser_adivinhado.sql
-- ================================================================

-- O PIN de admin aceita tentativas sem fim.
--
-- O PIN de líder não: desde `20260623225146` que `verify_pin_with_lockout()` conta os
-- falhanços em `pin_attempts` e fecha a porta por 30s, 60s, 120s, 300s a partir do
-- sexto. O PIN de admin nunca teve nada disso. `verify_admin_pin()` compara o hash e
-- responde, tantas vezes quantas lhe perguntem.
--
-- O ALVO NÃO É REMOTO. `verify_admin_pin()` já exige o papel de admin, por isso quem
-- adivinha já entrou. É exactamente a pessoa para quem o `AdminPinGate` foi escrito —
-- o portátil deixado aberto no escritório, que é a razão declarada da segunda porta à
-- frente do Attendance e do Finance Close. Quem se senta a esse teclado percorre as
-- 10 000 hipóteses de um PIN de quatro dígitos pela consola do browser, sem que nada
-- o atrase e sem deixar linha nenhuma escrita.
--
-- PORQUE É QUE ISTO NÃO PODE LEVANTAR UMA EXCEPÇÃO PARA DIZER "ESTÁS BLOQUEADO":
-- a chamada inteira é uma transação. Um `RAISE` no fim desfaz o `UPDATE` que acabou
-- de contar o falhanço e o `locked_until` que acabou de ser escrito — o contador
-- nunca chegava ao disco e o bloqueio nunca existia. É por isso que a função dos
-- líderes devolve jsonb em vez de rebentar, e é a mesma forma que se usa aqui.
--
-- `verify_admin_pin(text)` fica de pé, com a mesma assinatura e a mesma resposta
-- booleana, porque `set_intouch_sync_enabled()` chama-a e porque um `CREATE OR
-- REPLACE` com a assinatura igual preserva os privilégios. Passa a delegar, para que
-- a contagem valha em todos os caminhos e não só no da edge function.

-- ── A tabela de tentativas ───────────────────────────────────────────────────
-- Separada de `pin_attempts` de propósito. Partilhar a linha faria um PIN de admin
-- errado bloquear a verificação do PIN de engenheiro da mesma conta, e obrigaria a
-- mexer em `verify_pin_with_lockout()` — a função por onde entra toda a fábrica.
CREATE TABLE IF NOT EXISTS public.admin_pin_attempts (
  user_id      uuid PRIMARY KEY,
  failures     integer NOT NULL DEFAULT 0,
  lockout_step integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_attempt timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.admin_pin_attempts TO service_role;
-- Sem grants a anon/authenticated de propósito: só as funções SECURITY DEFINER
-- abaixo lêem e escrevem aqui.

ALTER TABLE public.admin_pin_attempts ENABLE ROW LEVEL SECURITY;
-- Sem policies => fechada. As funções SECURITY DEFINER passam por cima da RLS.

-- ── O verificador com escada ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_admin_pin_with_lockout(_pin text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _uid  uuid := auth.uid();
  _now  timestamptz := now();
  _row  public.admin_pin_attempts%ROWTYPE;
  _ok   boolean;
  _step integer;
  _wait integer;
  -- A mesma escada de verify_pin_with_lockout(). Duas escadas diferentes para a
  -- mesma fábrica seriam duas respostas diferentes à mesma pergunta.
  _max_free constant integer   := 5;
  _ladder   constant integer[] := ARRAY[30, 60, 120, 300];
BEGIN
  -- Uma recusa dura não conta tentativa nenhuma, por isso pode rebentar à vontade:
  -- não há estado para perder.
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  SELECT * INTO _row FROM public.admin_pin_attempts WHERE user_id = _uid FOR UPDATE;

  IF _row.locked_until IS NOT NULL AND _row.locked_until > _now THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'locked',
      'locked_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_row.locked_until - _now)))::int),
      'remaining', 0);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.system_settings
     WHERE admin_pin = extensions.crypt(_pin, admin_pin)
  ) INTO _ok;

  IF _ok THEN
    DELETE FROM public.admin_pin_attempts WHERE user_id = _uid;
    RETURN jsonb_build_object('success', true);
  END IF;

  INSERT INTO public.admin_pin_attempts (user_id, failures, lockout_step, last_attempt, updated_at)
  VALUES (_uid, 1, 0, _now, _now)
  ON CONFLICT (user_id) DO UPDATE
    SET failures     = admin_pin_attempts.failures + 1,
        last_attempt = _now,
        updated_at   = _now
  RETURNING * INTO _row;

  IF _row.failures > _max_free THEN
    _step := LEAST(_row.failures - _max_free, array_length(_ladder, 1));
    _wait := _ladder[_step];
    UPDATE public.admin_pin_attempts
       SET locked_until = _now + make_interval(secs => _wait),
           lockout_step = _step
     WHERE user_id = _uid;
    RETURN jsonb_build_object(
      'success', false, 'error', 'locked', 'locked_seconds', _wait, 'remaining', 0);
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'error', 'invalid_pin',
    'remaining', GREATEST(0, _max_free - _row.failures));
END;
$function$;

-- Recriar uma função devolve-lhe o EXECUTE do PUBLIC, e com ele o do anon.
REVOKE EXECUTE ON FUNCTION public.verify_admin_pin_with_lockout(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.verify_admin_pin_with_lockout(text) TO authenticated;

COMMENT ON FUNCTION public.verify_admin_pin_with_lockout(text) IS
  'Verifica o PIN de admin com a escada de bloqueio de admin_pin_attempts (5 livres, depois 30/60/120/300s). Devolve jsonb e nunca levanta excepção por PIN errado — um RAISE desfazia a contagem do falhanço.';

-- ── A antiga passa a delegar ─────────────────────────────────────────────────
-- Mesma assinatura e mesmo tipo de retorno: o CREATE OR REPLACE preserva os
-- privilégios que 20260418090223 e 20260623230737 deixaram. Deixa de ser STABLE
-- porque agora escreve — o planeador podia reutilizar o resultado de uma chamada
-- STABLE e a contagem ficava por fazer.
CREATE OR REPLACE FUNCTION public.verify_admin_pin(_pin text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Bloqueado responde o mesmo que errado, que é o que um booleano sabe dizer. Quem
  -- precisa da diferença — o AdminPinGate — chama a função de cima e lê o jsonb.
  RETURN COALESCE(
    (public.verify_admin_pin_with_lockout(_pin) ->> 'success')::boolean,
    false);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.verify_admin_pin(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.verify_admin_pin(text) TO authenticated;

COMMENT ON FUNCTION public.verify_admin_pin(text) IS
  'Delega em verify_admin_pin_with_lockout(). Mantida com a assinatura booleana porque set_intouch_sync_enabled() a chama. Bloqueado e errado respondem ambos false.';

-- ================================================================
-- BLOCO 54
-- 20260925133748_afff8d32-e1b1-4493-976b-f11a1e81c376.sql
-- ================================================================

create or replace function public.line_team_board(p_line_id uuid)
returns table(
  employee_name text,
  status text,
  is_leader boolean,
  half_day boolean,
  note text,
  shift text,
  on_date date
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_line_name text;
  v_area_id uuid;
  v_now timestamp := now() at time zone 'Europe/London';
  v_shift text;
  v_date date;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  -- An operator account may only read the team of a line its login is bound to.
  -- Staff roles that already run the headcount board may read any line.
  if not (
    exists (
      select 1 from public.operator_line_accounts ola
      where ola.user_id = v_caller and p_line_id = any(ola.line_ids)
    )
    or public.has_any_role(v_caller, array['admin','manager','maintenance_manager','supervisor','planner','production_office_admin']::app_role[])
  ) then
    raise exception 'not allowed to read this line''s team';
  end if;

  select l.name into v_line_name from public.lines l where l.id = p_line_id;
  if v_line_name is null then
    raise exception 'unknown line';
  end if;

  -- The headcount board draws its columns from headcount_areas; the line and the
  -- area share a name (Line 6 = Line 6). sheet_label is the spreadsheet spelling,
  -- tried as a fallback so a renamed column still resolves.
  select a.id into v_area_id
  from public.headcount_areas a
  where a.active
    and (lower(a.name) = lower(v_line_name) or lower(coalesce(a.sheet_label,'')) = lower(v_line_name))
  order by a.sort_order
  limit 1;

  -- Factory clock: Day runs 06:00-18:00 London; before 06:00 is still last
  -- night's board, the same rule the rest of the system applies.
  if v_now::time >= time '06:00' and v_now::time < time '18:00' then
    v_shift := 'Day';
    v_date := v_now::date;
  elsif v_now::time >= time '18:00' then
    v_shift := 'Night';
    v_date := v_now::date;
  else
    v_shift := 'Night';
    v_date := v_now::date - 1;
  end if;

  return query
  select
    e.full_name,
    da.status,
    coalesce(da.is_leader, false),
    coalesce(da.half_day, false),
    da.note,
    da.shift,
    da.on_date
  from public.daily_allocations da
  join public.employees e on e.id = da.employee_id
  where da.on_date = v_date
    and da.shift = v_shift
    and da.area_id = v_area_id
  order by coalesce(da.is_leader, false) desc, e.full_name;
end;
$$;

revoke all on function public.line_team_board(uuid) from public;
grant execute on function public.line_team_board(uuid) to authenticated;


-- ================================================================
-- BLOCO 55
-- 20260925133810_9acd3f88-cbdf-4074-88df-e5741e37ff88.sql
-- ================================================================

revoke execute on function public.line_team_board(uuid) from public, anon;
grant execute on function public.line_team_board(uuid) to authenticated;


-- ================================================================
-- BLOCO 56
-- 20260926074139_f12a50a4-9d37-4e1a-a20e-125dd47882cc.sql
-- ================================================================

alter table public.daily_allocations
  add column if not exists sheet_name text null,
  add column if not exists sheet_start_time text null,
  add column if not exists sheet_tag text null;

drop function if exists public.line_team_board(uuid);

create function public.line_team_board(p_line_id uuid)
returns table(
  employee_name text,
  display_name text,
  status text,
  is_leader boolean,
  half_day boolean,
  note text,
  shift text,
  on_date date,
  sheet_start_time text,
  sheet_tag text,
  area_name text,
  area_sort integer
)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_caller uuid := auth.uid();
  v_line_name text;
  v_area_ids uuid[];
  v_now timestamp := now() at time zone 'Europe/London';
  v_shift text;
  v_date date;
begin
  if v_caller is null then
    raise exception 'not authenticated';
  end if;

  if not (
    exists (
      select 1 from public.operator_line_accounts ola
      where ola.user_id = v_caller and p_line_id = any(ola.line_ids)
    )
    or public.has_any_role(v_caller, array['admin','manager','maintenance_manager','supervisor','planner','production_office_admin']::app_role[])
  ) then
    raise exception 'not allowed to read this line''s team';
  end if;

  select l.name into v_line_name from public.lines l where l.id = p_line_id;
  if v_line_name is null then
    raise exception 'unknown line';
  end if;

  -- Areas linked to the line by FK; all of them (a line can have several columns).
  select array_agg(a.id) into v_area_ids
  from public.headcount_areas a
  where a.active and a.line_id = p_line_id;

  -- Fallback: no area carries line_id, match by name / sheet_label.
  if v_area_ids is null then
    select array_agg(a.id) into v_area_ids
    from public.headcount_areas a
    where a.active
      and (lower(a.name) = lower(v_line_name)
        or exists (
          select 1 from unnest(string_to_array(coalesce(a.sheet_label,''), ',')) s
          where lower(trim(s)) = lower(v_line_name)
        ));
  end if;

  if v_now::time >= time '06:00' and v_now::time < time '18:00' then
    v_shift := 'Day';  v_date := v_now::date;
  elsif v_now::time >= time '18:00' then
    v_shift := 'Night'; v_date := v_now::date;
  else
    v_shift := 'Night'; v_date := v_now::date - 1;
  end if;

  return query
  select
    e.full_name,
    coalesce(da.sheet_name, e.full_name),
    da.status,
    coalesce(da.is_leader, false),
    coalesce(da.half_day, false),
    da.note,
    da.shift,
    da.on_date,
    da.sheet_start_time,
    da.sheet_tag,
    a.name,
    a.sort_order
  from public.daily_allocations da
  join public.employees e on e.id = da.employee_id
  join public.headcount_areas a on a.id = da.area_id
  where da.on_date = v_date
    and da.shift = v_shift
    and da.area_id = any(coalesce(v_area_ids, array[]::uuid[]))
  order by a.sort_order, coalesce(da.is_leader, false) desc, coalesce(da.sheet_name, e.full_name);
end;
$$;

revoke all on function public.line_team_board(uuid) from public, anon;
grant execute on function public.line_team_board(uuid) to authenticated;


-- ================================================================
-- BLOCO 57
-- 20260929122209_702cb5c3-bc21-43f2-beea-96f0ad050146.sql
-- ================================================================

CREATE TABLE IF NOT EXISTS public.admin_pin_attempts (
  user_id uuid PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  lockout_step integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_attempt timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
GRANT ALL ON public.admin_pin_attempts TO service_role;
ALTER TABLE public.admin_pin_attempts ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.verify_admin_pin_with_lockout(_pin text)
RETURNS jsonb LANGUAGE plpgsql VOLATILE SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _now timestamptz := now();
  _row public.admin_pin_attempts%ROWTYPE;
  _ok boolean; _step integer; _wait integer;
  _max_free constant integer := 5;
  _ladder constant integer[] := ARRAY[30, 60, 120, 300];
BEGIN
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  SELECT * INTO _row FROM public.admin_pin_attempts WHERE user_id = _uid FOR UPDATE;
  IF _row.locked_until IS NOT NULL AND _row.locked_until > _now THEN
    RETURN jsonb_build_object('success', false, 'error', 'locked',
      'locked_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_row.locked_until - _now)))::int), 'remaining', 0);
  END IF;
  SELECT EXISTS (SELECT 1 FROM public.system_settings WHERE admin_pin = extensions.crypt(_pin, admin_pin)) INTO _ok;
  IF _ok THEN
    DELETE FROM public.admin_pin_attempts WHERE user_id = _uid;
    RETURN jsonb_build_object('success', true);
  END IF;
  INSERT INTO public.admin_pin_attempts (user_id, failures, lockout_step, last_attempt, updated_at)
  VALUES (_uid, 1, 0, _now, _now)
  ON CONFLICT (user_id) DO UPDATE SET failures = admin_pin_attempts.failures + 1, last_attempt = _now, updated_at = _now
  RETURNING * INTO _row;
  IF _row.failures > _max_free THEN
    _step := LEAST(_row.failures - _max_free, array_length(_ladder, 1));
    _wait := _ladder[_step];
    UPDATE public.admin_pin_attempts SET locked_until = _now + make_interval(secs => _wait), lockout_step = _step WHERE user_id = _uid;
    RETURN jsonb_build_object('success', false, 'error', 'locked', 'locked_seconds', _wait, 'remaining', 0);
  END IF;
  RETURN jsonb_build_object('success', false, 'error', 'invalid_pin', 'remaining', GREATEST(0, _max_free - _row.failures));
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.verify_admin_pin_with_lockout(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_admin_pin_with_lockout(text) TO authenticated;


-- ================================================================
-- BLOCO 58
-- 20260930062811_e5dc5147-de5f-4dde-b09a-96e55a1101d0.sql
-- ================================================================

ALTER TABLE public.products ADD COLUMN IF NOT EXISTS priority text CHECK (priority IN ('high','low'));


-- ================================================================
-- BLOCO 59
-- 20260930064203_58f720b2-4b51-4199-97c4-0b46c9109667.sql
-- ================================================================

-- Set minimum replenishment alert for all belts to 2 units
UPDATE public.products
SET min_stock = 2
WHERE lower(coalesce(name, '')) LIKE '%belt%'
   OR lower(coalesce(code, '')) LIKE '%belt%';


-- ================================================================
-- BLOCO 60
-- 20261001203000_pontualidade_tem_o_seu_proprio_alvo.sql
-- ================================================================

-- Pontualidade passa a ter o seu proprio alvo, ao lado da assiduidade.
--
-- O scorecard semanal ja guardava `leader_lateness_incidents` e
-- `team_lateness_incidents`, mas contagens soltas: nada dizia quantos atrasos sao
-- demais, por isso o numero aparecia e nao significava nada. A assiduidade tinha
-- THR_AttendTarget desde o inicio; a pontualidade nao tinha par nenhum.
--
-- Uma contagem de atrasos nao se compara com um alvo sem denominador -- duas faltas
-- de pontualidade em cinco entradas e outra coisa que duas em cinquenta -- por isso o
-- que entra aqui e a FRACCAO de entradas sem atraso, espelhando exactamente
-- leader_attendance_pct / team_attendance_pct: mesmo tipo, mesma escala, mesmo CHECK.
-- As contagens ficam onde estao; medem o volume, estas medem a taxa.
--
-- Monitorado, NAO pontua, pela mesma razao que a assiduidade nao pontua -- e porque a
-- fonte (daily_allocations.arrived_late_at) esta hoje com 1 registo em 6.640. Um alvo
-- que pontuasse agora daria nota cheia a toda a gente por ninguem marcar nada, que e
-- a leitura exactamente ao contrario da verdade.

alter table leader_weekly_scorecard
  add column if not exists leader_punctuality_pct numeric(5,4)
    check (leader_punctuality_pct >= 0 and leader_punctuality_pct <= 1),
  add column if not exists team_punctuality_pct numeric(5,4)
    check (team_punctuality_pct >= 0 and team_punctuality_pct <= 1);

comment on column leader_weekly_scorecard.leader_punctuality_pct is
  'Fraccao das entradas do lider sem atraso na semana. Monitorado, NAO pontua -- par de leader_attendance_pct. Julgado contra THR_PunctualTarget.';
comment on column leader_weekly_scorecard.team_punctuality_pct is
  'Fraccao das entradas da equipa sem atraso na semana. Monitorado, NAO pontua -- par de team_attendance_pct.';

-- O limiar, com vigencia como todos os outros. Alterar e fechar esta linha e abrir a
-- seguinte, nunca um UPDATE do valor: isso reescreveria o julgamento de todas as
-- semanas ja registadas.
insert into leader_scorecard_threshold (name, value, pillar, valid_from, valid_to, note)
select 'THR_PunctualTarget', 0.980, 'Monitorado', date '2000-01-01', null,
       'Alvo de pontualidade: fraccao de entradas sem atraso. Monitorado, NAO pontua em nenhum RAG. Fonte: daily_allocations.arrived_late_at, hoje quase sempre vazio.'
where not exists (
  select 1 from leader_scorecard_threshold where name = 'THR_PunctualTarget' and valid_to is null
);

-- A view, alterada a partir da sua propria definicao em vez de reescrita por extenso.
--
-- Deliberado: uma copia da definicao inteira dentro de uma migracao congela um retrato
-- de um objecto que continua a mudar, e a proxima migracao que o reescreva por extenso
-- apaga em silencio o que esta tiver acrescentado. Assim a alteracao e cirurgica e
-- ABORTA em vez de adivinhar, se a ancora que espera ja nao estiver la.
--
-- As colunas novas vao para o FIM da lista para que CREATE OR REPLACE chegue: trocar a
-- ordem obrigaria a um DROP, e isso leva atras v_leader_weekly_scorecard_periods e os
-- rollups todos.
do $$
declare d text; antes int;
begin
  d := pg_get_viewdef('v_leader_weekly_scorecard'::regclass, true);

  antes := length(d);
  d := replace(d,
    'max(th.value) FILTER (WHERE th.name = ''THR_AttendTarget''::text) AS attend_target,',
    'max(th.value) FILTER (WHERE th.name = ''THR_AttendTarget''::text) AS attend_target,
            max(th.value) FILTER (WHERE th.name = ''THR_PunctualTarget''::text) AS punctual_target,');
  if length(d) = antes then
    raise exception 'v_leader_weekly_scorecard: nao encontrei THR_AttendTarget no lateral dos limiares';
  end if;

  antes := length(d);
  d := replace(d,
    '    s.volume_source' || chr(10) || '   FROM leader_weekly_scorecard s',
    '    s.volume_source,
    s.leader_punctuality_pct,
    s.team_punctuality_pct,
    s.leader_punctuality_pct IS NOT NULL AND s.leader_punctuality_pct < t.punctual_target AS leader_punctuality_below_target
   FROM leader_weekly_scorecard s');
  if length(d) = antes then
    raise exception 'v_leader_weekly_scorecard: nao encontrei o fim da lista de colunas (s.volume_source)';
  end if;

  execute 'CREATE OR REPLACE VIEW v_leader_weekly_scorecard AS ' || d;
end $$;

-- ================================================================
-- BLOCO 61
-- 20261002210000_o_relogio_e_o_board_em_migracao.sql
-- ================================================================

-- As tres pecas que o Lote 2A le, postas em migracao.
--
-- Foram aplicadas a produção a 02/10 e nunca foram escritas aqui. O frontend do 2A
-- ficou dependente de tres objectos que o repositorio nao sabia que existiam: numa
-- base nova, ou numa branch de preview, o `useClockCoverage` apanha um erro de
-- relacao inexistente e as tres telas passam a dizer para sempre que a cobertura nao
-- pode ser lida — que e, ironicamente, o unico modo de falha que o 2A existe para
-- tornar visivel.
--
-- Tudo com CREATE OR REPLACE: em produção isto e um no-op, numa base vazia cria.
--
-- A regra que estas tres peças implementam, e que nao pode mudar sem uma decisao:
-- o board (`daily_allocations`) e o relogio (`attendance_days`) sao dois registos
-- separados e nenhum corrige o outro. Nada aqui escreve nada. Sao leituras.

-- ---------------------------------------------------------------------------
-- 1. Onde chegou o relogio.
-- ---------------------------------------------------------------------------
-- Uma linha so. A distancia ate hoje NAO e calculada aqui de proposito: o "ha quantos
-- dias" mede-se contra a data operacional, que e a da app (`currentShift`), e a meia
-- noite e meia a base e a app discordariam sobre que dia e hoje.
CREATE OR REPLACE VIEW public.v_timemoto_coverage AS
SELECT
  (SELECT max(on_date) FROM attendance_days)               AS last_on_date,
  (SELECT min(on_date) FROM attendance_days)               AS first_on_date,
  (SELECT count(DISTINCT employee_id) FROM attendance_days) AS employees_covered,
  (SELECT count(*) FROM employees WHERE active)             AS active_employees,
  (SELECT count(*) FROM attendance_days)                    AS rows_total;

-- ---------------------------------------------------------------------------
-- 2. O veredicto de um board num dia.
-- ---------------------------------------------------------------------------
-- Quatro numeros e uma palavra. A palavra sozinha nao chega para por num ecra — ver
-- `src/lib/boardClockStatus.ts`, que decide o que eles querem dizer e tem os testes.
--
-- Duas regras que custaram a acertar e que nao se mexem sem ler isto:
--
-- 1. `deste_board` repete a regra da app (`boardShiftFor`): shift_group 'Night' vai
--    para o board Night, tudo o resto para o Day. Sem ela, a malta do dia que picou
--    contava como divergencia do board da noite — 55 por dia, todas falsas.
-- 2. `cobertos` exclui quem nunca apareceu no relogio. A ausencia de uma linha para
--    quem nunca esteve no TimeMoto nao diz nada sobre essa pessoa, e conta-la seria
--    reportar como divergencia o facto de o relogio nao a cobrir.
CREATE OR REPLACE FUNCTION public.fn_board_clock_status(p_date date, p_shift text)
RETURNS TABLE(status text, clock_rows integer, covered_people integer, differs integer)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH cobertos AS (
    SELECT DISTINCT ad.employee_id AS eid FROM attendance_days ad
  ),
  deste_board AS (
    SELECT e.id AS eid FROM employees e
    WHERE e.active
      AND (CASE WHEN e.shift_group = 'Night' THEN 'Night' ELSE 'Day' END) = p_shift
  ),
  relogio AS (
    SELECT ad.employee_id AS eid, COALESCE(ad.worked_minutes, 0) AS mins
    FROM attendance_days ad WHERE ad.on_date = p_date
  ),
  board AS (
    SELECT da.employee_id AS eid
    FROM daily_allocations da
    WHERE da.on_date = p_date AND da.shift = p_shift
      AND da.status IN ('assigned', 'overtime')
  ),
  discordam AS (
    SELECT b.eid FROM board b
    JOIN cobertos c ON c.eid = b.eid
    LEFT JOIN relogio r ON r.eid = b.eid
    WHERE COALESCE(r.mins, 0) = 0
    UNION
    SELECT r.eid FROM relogio r
    JOIN deste_board d ON d.eid = r.eid
    WHERE r.mins > 0 AND NOT EXISTS (SELECT 1 FROM board b WHERE b.eid = r.eid)
  )
  SELECT
    CASE WHEN (SELECT count(*) FROM relogio) = 0 THEN 'planned'
         WHEN (SELECT count(*) FROM discordam) = 0 THEN 'clocked'
         ELSE 'differs' END,
    (SELECT count(*) FROM relogio)::int,
    (SELECT count(*) FROM board b JOIN cobertos c ON c.eid = b.eid)::int,
    -- Sem relogio nesse dia nao ha nada para comparar: zero, nao o numero de pessoas
    -- por confirmar, que se leria como um veredito.
    CASE WHEN (SELECT count(*) FROM relogio) = 0 THEN 0
         ELSE (SELECT count(*) FROM discordam)::int END
$function$;

-- ---------------------------------------------------------------------------
-- 3. O mesmo veredicto, para todos os dias de uma vez.
-- ---------------------------------------------------------------------------
-- A funcao responde por um dia; esta responde pelos 82. A app usa a vista para o badge
-- e as duas tem de concordar — foram verificadas nos 123 pares, nas quatro colunas,
-- com zero discordancias.
CREATE OR REPLACE VIEW public.v_board_clock_status AS
WITH dias AS (
  SELECT DISTINCT on_date, shift FROM daily_allocations
),
cobertos AS (
  SELECT DISTINCT employee_id FROM attendance_days
),
crew AS (
  SELECT id AS employee_id,
         CASE WHEN shift_group = 'Night' THEN 'Night' ELSE 'Day' END AS board
  FROM employees WHERE active
),
cnt AS (
  SELECT on_date, count(*) AS clock_rows FROM attendance_days GROUP BY on_date
),
no_board_sem_horas AS (
  SELECT d.on_date, d.shift, count(*) AS n
  FROM dias d
  JOIN daily_allocations da
    ON da.on_date = d.on_date AND da.shift = d.shift
   AND da.status = ANY (ARRAY['assigned'::text, 'overtime'::text])
  JOIN cobertos c ON c.employee_id = da.employee_id
  LEFT JOIN attendance_days ad ON ad.on_date = d.on_date AND ad.employee_id = da.employee_id
  WHERE COALESCE(ad.worked_minutes, 0) = 0
  GROUP BY d.on_date, d.shift
),
picou_fora_do_board AS (
  SELECT d.on_date, d.shift, count(*) AS n
  FROM dias d
  JOIN attendance_days ad ON ad.on_date = d.on_date AND COALESCE(ad.worked_minutes, 0) > 0
  JOIN crew cw ON cw.employee_id = ad.employee_id AND cw.board = d.shift
  WHERE NOT EXISTS (
    SELECT 1 FROM daily_allocations da
    WHERE da.on_date = d.on_date AND da.shift = d.shift AND da.employee_id = ad.employee_id
      AND da.status = ANY (ARRAY['assigned'::text, 'overtime'::text])
  )
  GROUP BY d.on_date, d.shift
),
cov AS (
  SELECT d.on_date, d.shift, count(*) AS covered_people
  FROM dias d
  JOIN daily_allocations da
    ON da.on_date = d.on_date AND da.shift = d.shift
   AND da.status = ANY (ARRAY['assigned'::text, 'overtime'::text])
  JOIN cobertos c ON c.employee_id = da.employee_id
  GROUP BY d.on_date, d.shift
)
SELECT
  d.on_date,
  d.shift,
  COALESCE(cnt.clock_rows, 0::bigint)::integer     AS clock_rows,
  COALESCE(cov.covered_people, 0::bigint)::integer AS covered_people,
  CASE WHEN COALESCE(cnt.clock_rows, 0::bigint) = 0 THEN 0
       ELSE (COALESCE(a.n, 0::bigint) + COALESCE(b.n, 0::bigint))::integer END AS differs,
  CASE WHEN COALESCE(cnt.clock_rows, 0::bigint) = 0 THEN 'planned'::text
       WHEN (COALESCE(a.n, 0::bigint) + COALESCE(b.n, 0::bigint)) = 0 THEN 'clocked'::text
       ELSE 'differs'::text END AS status
FROM dias d
LEFT JOIN cnt ON cnt.on_date = d.on_date
LEFT JOIN cov ON cov.on_date = d.on_date AND cov.shift = d.shift
LEFT JOIN no_board_sem_horas a ON a.on_date = d.on_date AND a.shift = d.shift
LEFT JOIN picou_fora_do_board b ON b.on_date = d.on_date AND b.shift = d.shift;

GRANT SELECT ON public.v_timemoto_coverage  TO authenticated;
GRANT SELECT ON public.v_board_clock_status TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_board_clock_status(date, text) TO authenticated;

-- ================================================================
-- BLOCO 62
-- 20261002215000_a_reconciliacao_tem_nomes_e_nao_so_contagens.sql
-- ================================================================

-- A reconciliacao board <-> relogio, com nomes em vez de contagens.
--
-- `v_board_clock_status` ja responde "quantos discordam neste dia e neste board".
-- Esta responde "quem", e e read-only de proposito: board e relogio sao duas verdades
-- separadas e nenhuma corrige a outra. Nao ha aqui nada que sincronize, repare ou
-- substitua -- e a decisao de 02/10/2026.
--
-- A REGRA E A MESMA, LITERALMENTE. As duas primeiras ramificacoes sao
-- `no_board_sem_horas` e `picou_fora_do_board` da vista de contagem, com as linhas no
-- lugar do `count(*)`. Isso e o ponto: o detalhe tem de somar exactamente ao numero
-- que o badge mostra, ou o ecra e o badge dizem coisas diferentes sobre o mesmo dia,
-- que e a falha que este modulo ja cometeu duas vezes. Verificado nos 123 pares
-- (on_date, shift): 712 = 712, zero desacordos.
--
-- Tres sentidos, e o terceiro nao e uma divergencia:
--
--   planned_not_clocked   no board, conhecido do relogio, e nao picou
--   clocked_not_planned   picou, e deste board, e nao esta no board
--   not_comparable        no board, e o relogio nunca o viu
--
-- O terceiro existe porque sem ele os outros dois nao se podem ler. 113 dos 211
-- activos nao tem registo nenhum no relogio, e 62 dos 64 da crew da noite -- por isso
-- "zero divergencias" na noite nao quer dizer que o board estava certo, quer dizer que
-- nao havia ninguem para comparar. Contar essa gente como divergencia seria acusar
-- alguem de faltar com base numa linha que nunca existiu; esconde-la seria deixar o
-- numero parecer solido. Fica a vista, fora da conta.
--
-- Dias sem relogio nenhum nao entram: nao ha comparacao a fazer, e o badge conta 0 por
-- essa mesma razao. 30 dos 82 dias de board estao nesse caso.

create or replace view public.v_board_clock_reconciliation
with (security_invoker = true) as
with dias as (
  select distinct on_date, shift from daily_allocations
),
-- Quem alguma vez apareceu no relogio, e nao quem picou nesse dia. A ausencia de uma
-- linha so diz alguma coisa sobre quem o relogio conhece.
cobertos as (select distinct employee_id from attendance_days),
crew as (
  select id as employee_id,
         case when shift_group = 'Night' then 'Night' else 'Day' end as board
  from employees where active
),
com_relogio as (select on_date, count(*) n from attendance_days group by on_date),
board as (
  select da.on_date, da.shift, da.employee_id, da.status
  from daily_allocations da
  where da.status in ('assigned','overtime')
)
select b.on_date, b.shift, b.employee_id,
       'planned_not_clocked'::text as kind,
       b.status as board_status,
       coalesce(ad.worked_minutes, 0)::int as worked_minutes
from board b
join com_relogio cr on cr.on_date = b.on_date
join cobertos c on c.employee_id = b.employee_id
left join attendance_days ad on ad.on_date = b.on_date and ad.employee_id = b.employee_id
where coalesce(ad.worked_minutes, 0) = 0

union all

select d.on_date, d.shift, ad.employee_id,
       'clocked_not_planned'::text,
       null::text,
       ad.worked_minutes::int
from dias d
join com_relogio cr on cr.on_date = d.on_date
join attendance_days ad on ad.on_date = d.on_date and coalesce(ad.worked_minutes,0) > 0
join crew cw on cw.employee_id = ad.employee_id and cw.board = d.shift
where not exists (
  select 1 from board b
  where b.on_date = d.on_date and b.shift = d.shift and b.employee_id = ad.employee_id
)

union all

select b.on_date, b.shift, b.employee_id,
       'not_comparable'::text,
       b.status,
       null::int
from board b
join com_relogio cr on cr.on_date = b.on_date
where not exists (select 1 from cobertos c where c.employee_id = b.employee_id);

revoke all on public.v_board_clock_reconciliation from public, anon;
grant select on public.v_board_clock_reconciliation to authenticated;

comment on view public.v_board_clock_reconciliation is
  'Quem discorda entre o board e o relogio, por dia e por board. Read-only: as duas fontes sao separadas e nenhuma corrige a outra. As duas primeiras kinds somam ao differs de v_board_clock_status; not_comparable fica de fora da conta de proposito.';

-- ================================================================
-- BLOCO 63
-- 20261003200000_o_calendario_de_folha_e_quatro_quatro_cinco.sql
-- ================================================================

-- O calendário de folha é 4-4-5, e de dezembro em diante não era.
--
-- A migração de 07/08 corrigiu setembro para os trinta e cinco dias certos e deixou
-- escrito que os períodos seguintes eram "only a floor" e que "December may move".
-- Move: 07/12-03/01 são vinte e oito dias onde o trimestre Out+Nov+Dez pede trinta e
-- cinco. E o `generate_series` de 28 em 28 que veio a seguir não tem a semana extra
-- de todo, por isso os dezassete períodos de 2027 e 2028 afastam-se do calendário
-- cerca de um dia por mês — é essa deriva que põe `January 2028` em duas linhas e
-- deixa sete períodos com um nome que não corresponde ao mês em que acabam.
--
-- 4-4-5 quer dizer trimestres de noventa e um dias: quatro semanas, quatro, cinco.
-- Confirmado contra os dados: Jul+Ago+Set 2026 são 28+28+35, e todo o período de
-- fevereiro a novembro de 2026 já cai exactamente onde a regra o põe. O que falta é
-- daí para a frente.
--
-- Importa para o fecho porque `expectedShifts` conta os dias da rota dentro do
-- intervalo do período. Um período com a duração errada dá um devido errado a toda
-- a gente, e é o devido que alimenta o `shiftBalance` e o cartão "Shifts short".
--
-- Nada antes de 07/12/2026 é tocado: todos os períodos já decorridos ficam como
-- estão. Os três períodos de 2026 que nunca foram criados (12/01-08/02, 13/04-10/05
-- e 11/05-07/06) continuam por criar — não têm um único turno, linha de relógio nem
-- marca manual lá dentro, por isso são arrumação e não correcção.

-- Guarda: se alguém tiver lançado overtime num período que isto substitui, parar.
-- Hoje `overtime_entries` está vazia, mas uma migração corre quando corre.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
    FROM public.overtime_entries o
    JOIN public.workforce_payroll_periods p ON p.id = o.period_id
   WHERE p.start_date >= DATE '2026-12-07';
  IF n > 0 THEN
    RAISE EXCEPTION 'Overtime lancado em % periodo(s) a partir de 07/12/2026. Resolver antes de remexer no calendario.', n;
  END IF;
END $$;

-- December 2026 é o período de cinco semanas do seu trimestre. Só o fim muda, por
-- isso nada se desloca para trás.
UPDATE public.workforce_payroll_periods
   SET end_date = DATE '2027-01-10'
 WHERE start_date = DATE '2026-12-07';

-- De 04/01/2027 em diante vinha do `generate_series` de 28 em 28. Substituir inteiro
-- é mais seguro do que acertar datas uma a uma, e são todos períodos futuros.
DELETE FROM public.workforce_payroll_periods WHERE start_date >= DATE '2027-01-04';

-- Nome = mês em que o período começa, que é a regra que os períodos correctos de
-- junho de 2026 em diante já seguem.
INSERT INTO public.workforce_payroll_periods (name, start_date, end_date) VALUES
  ('January 2027',   DATE '2027-01-11', DATE '2027-02-07'),  -- 28d
  ('February 2027',  DATE '2027-02-08', DATE '2027-03-07'),  -- 28d
  ('March 2027',     DATE '2027-03-08', DATE '2027-04-11'),  -- 35d
  ('April 2027',     DATE '2027-04-12', DATE '2027-05-09'),  -- 28d
  ('May 2027',       DATE '2027-05-10', DATE '2027-06-06'),  -- 28d
  ('June 2027',      DATE '2027-06-07', DATE '2027-07-11'),  -- 35d
  ('July 2027',      DATE '2027-07-12', DATE '2027-08-08'),  -- 28d
  ('August 2027',    DATE '2027-08-09', DATE '2027-09-05'),  -- 28d
  ('September 2027', DATE '2027-09-06', DATE '2027-10-10'),  -- 35d
  ('October 2027',   DATE '2027-10-11', DATE '2027-11-07'),  -- 28d
  ('November 2027',  DATE '2027-11-08', DATE '2027-12-05'),  -- 28d
  ('December 2027',  DATE '2027-12-06', DATE '2028-01-09'),  -- 35d
  ('January 2028',   DATE '2028-01-10', DATE '2028-02-06'),  -- 28d
  ('February 2028',  DATE '2028-02-07', DATE '2028-03-05'),  -- 28d
  ('March 2028',     DATE '2028-03-06', DATE '2028-04-09'),  -- 35d
  ('April 2028',     DATE '2028-04-10', DATE '2028-05-07'),  -- 28d
  ('May 2028',       DATE '2028-05-08', DATE '2028-06-04'),  -- 28d
  ('June 2028',      DATE '2028-06-05', DATE '2028-07-09');  -- 35d

-- ================================================================
-- BLOCO 64
-- 20261003203000_um_dia_nao_pode_pertencer_a_dois_periodos.sql
-- ================================================================

-- Um dia nao pode pertencer a dois periodos de folha.
--
-- O calendario 4-4-5 acabou de ser reposto a mao, e nada na base impedia que
-- voltasse a sair do sitio. O que correu mal hoje foi um `generate_series` de 28
-- em 28 dias que escreveu dezassete periodos desalinhados sem dar erro nenhum:
-- as datas ficaram erradas em silencio e so se notou ao olhar para o ecra de
-- fecho semanas depois.
--
-- Estas duas restricoes nao impedem datas erradas -- impedem a classe de erro que
-- custa dinheiro. Um dia dentro de dois periodos e trabalho contado duas vezes
-- num documento de onde se paga, e um periodo que acaba antes de comecar faz o
-- `expectedShifts` devolver zero dias de rota, o que se le como "ninguem tinha
-- de vir trabalhar".
--
-- O que estas restricoes NAO fazem, de proposito:
--
--   * Nao verificam a duracao. Vinte e oito ou trinta e cinco dias e a regra de
--     hoje, nao uma lei: um ano de transicao ou uma mudanca de calendario podem
--     precisar de outra coisa, e uma restricao que bloqueie o negocio e pior do
--     que o defeito que evita. A verificacao da duracao vive nas consultas, onde
--     e barata de mudar.
--   * Nao impedem BURACOS. Um periodo em falta nao e detectavel por restricao --
--     a base nao sabe que devia la estar alguma coisa. Para isso e preciso olhar,
--     e a consulta que olha esta em `claude/periodos-de-folha-2026-10-03.md`.
--
-- Verificado contra a producao antes de escrever: zero pares sobrepostos, zero
-- periodos com fim antes do inicio, nas vinte e oito linhas. Nenhum dado
-- existente e recusado por isto.

-- `daterange(a, b, '[]')` inclui as duas pontas: um periodo que acaba a 10/01 e
-- outro que comeca a 10/01 SAO um conflito, que e exactamente o que se quer.
ALTER TABLE public.workforce_payroll_periods
  ADD CONSTRAINT workforce_payroll_periods_sem_sobreposicao
  EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&);

ALTER TABLE public.workforce_payroll_periods
  ADD CONSTRAINT workforce_payroll_periods_fim_depois_do_inicio
  CHECK (end_date >= start_date);

COMMENT ON CONSTRAINT workforce_payroll_periods_sem_sobreposicao
  ON public.workforce_payroll_periods IS
  'Um dia so pode estar num periodo. Dois periodos a cobrir o mesmo dia e trabalho contado duas vezes num documento de onde se paga.';

-- ================================================================
-- BLOCO 65
-- 20261004200000_o_titulo_tambem_diz_de_quem_e.sql
-- ================================================================

-- O título também diz de quem é a culpa.
--
-- Até aqui só o rótulo Maintenance declarava a causa raiz. Uma acção chamada
-- "Wrong box label/Pallet label (Office)." carregava 4 pontos ao líder da linha, e
-- havia 28 assim (~93 pontos): o erro era do Office, do Warehouse, do fornecedor ou
-- do Lab, e o título dizia-o. Regra do negócio: se o título nomeia outra área, o
-- líder não é cobrado, mesmo que nomeie também a linha ("L2/Lab").
--
-- Três regras que não mudam:
--   * um valor escrito pela Qualidade nunca é sobrescrito;
--   * numa UPDATE só se deriva quando o título ou os rótulos mudaram — senão limpar a
--     causa (devolver os pontos ao líder) era desfeito no save seguinte;
--   * o gatilho continua a ser trg_b_: depois do guard, antes do freeze.

-- 1. A tabela de palavras-chave --------------------------------------------------
CREATE TABLE IF NOT EXISTS public.root_cause_area_keyword (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  area text NOT NULL,
  pattern text NOT NULL,
  active boolean NOT NULL DEFAULT true,
  note text,
  sort integer NOT NULL DEFAULT 0,
  created_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.root_cause_area_keyword TO authenticated;
GRANT ALL ON public.root_cause_area_keyword TO service_role;

ALTER TABLE public.root_cause_area_keyword ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can read root cause keywords"
  ON public.root_cause_area_keyword FOR SELECT TO authenticated USING (true);

CREATE POLICY "Quality manages root cause keywords"
  ON public.root_cause_area_keyword FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'quality_supervisor'))
  WITH CHECK (public.has_role(auth.uid(), 'admin') OR public.has_role(auth.uid(), 'quality_supervisor'));

-- Uma expressão inválida gravada pela UI partia todas as escritas em quality_actions.
CREATE OR REPLACE FUNCTION public.root_cause_keyword_valid_pattern()
RETURNS trigger LANGUAGE plpgsql SET search_path TO 'public' AS $$
BEGIN
  PERFORM '' ~* NEW.pattern;
  RETURN NEW;
EXCEPTION WHEN invalid_regular_expression THEN
  RAISE EXCEPTION 'Invalid pattern: %', NEW.pattern USING ERRCODE = '22023';
END $$;

CREATE TRIGGER trg_root_cause_keyword_valid
BEFORE INSERT OR UPDATE ON public.root_cause_area_keyword
FOR EACH ROW EXECUTE FUNCTION public.root_cause_keyword_valid_pattern();

INSERT INTO public.root_cause_area_keyword (area, pattern, sort, note) VALUES
  ('Office',      '\moffice\M',                   10, NULL),
  ('Warehouse',   '\mwarehouse\M',                20, NULL),
  ('Supplier',    '\msuppliers?\M|\mgoods? in\M', 30, 'Supplier or Goods In'),
  ('Lab',         '\mlab\M',                      40, 'Word boundary: must not match "label"'),
  ('Maintenance', '\mmaintenance\M',              50, NULL);

-- 2. As áreas novas têm de existir como causa que não conta ao líder -------------
-- action_points_at só zera quando encontra a área com counts_against_leader = false;
-- uma área desconhecida cobra (de propósito). Office e Lab não estavam na lista.
INSERT INTO public.quality_options (kind, value, counts_against_leader, sort)
SELECT 'root_cause', v, false,
       (SELECT coalesce(max(sort), 0) FROM public.quality_options WHERE kind = 'root_cause') + n
  FROM (VALUES ('Office', 1), ('Lab', 2)) AS t(v, n)
 WHERE NOT EXISTS (
   SELECT 1 FROM public.quality_options
    WHERE kind = 'root_cause' AND lower(btrim(value)) = lower(v));

-- 3. O gatilho ------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.default_root_cause_from_label()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _area text;
BEGIN
  -- Uma causa raiz escrita pela Qualidade manda sempre.
  IF NEW.root_cause_area IS NOT NULL THEN RETURN NEW; END IF;

  IF TG_OP = 'UPDATE' THEN
    -- A Qualidade limpou-a: os pontos voltam ao líder e ficam lá.
    IF OLD.root_cause_area IS NOT NULL THEN RETURN NEW; END IF;
    -- Nada que a derivação leia mudou; validar ou fechar não re-deriva.
    IF NEW.title IS NOT DISTINCT FROM OLD.title
       AND NEW.labels IS NOT DISTINCT FROM OLD.labels THEN
      RETURN NEW;
    END IF;
  END IF;

  IF coalesce(NEW.domain, 'quality') = 'safety' THEN RETURN NEW; END IF;

  -- (a) O rótulo Maintenance, como antes.
  IF EXISTS (
    SELECT 1 FROM unnest(coalesce(NEW.labels, ARRAY[]::text[])) AS l
     WHERE lower(btrim(l)) = 'maintenance'
  ) THEN
    NEW.root_cause_area := 'Maintenance';
    RETURN NEW;
  END IF;

  -- (b) A primeira palavra-chave activa que o título nomeia.
  IF NEW.title IS NOT NULL AND btrim(NEW.title) <> '' THEN
    SELECT k.area INTO _area
      FROM public.root_cause_area_keyword k
     WHERE k.active AND NEW.title ~* k.pattern
     ORDER BY k.sort, k.area
     LIMIT 1;
    IF _area IS NOT NULL THEN NEW.root_cause_area := _area; END IF;
  END IF;

  RETURN NEW;
END $function$;

COMMENT ON FUNCTION public.default_root_cause_from_label() IS
  'Preenche root_cause_area vazio a partir do rotulo Maintenance ou de uma palavra-chave '
  'de root_cause_area_keyword no titulo. Nunca sobrescreve; numa UPDATE so deriva se o '
  'titulo ou os rotulos mudaram e a causa ja estava vazia. Corre como trg_b_: depois do '
  'guard, antes do trg_quality_action_freeze_points_*.';


-- Os dois gatilhos, recriados iguais, para que uma base nova fique com a ordem certa:
-- trg_a_ (guard) -> trg_b_ (esta derivação) -> trg_quality_action_freeze_points_*.
DROP TRIGGER IF EXISTS trg_b_quality_root_cause_default ON public.quality_actions;
CREATE TRIGGER trg_b_quality_root_cause_default
BEFORE INSERT OR UPDATE ON public.quality_actions
FOR EACH ROW
EXECUTE FUNCTION public.default_root_cause_from_label();

--
-- One line — `root_cause_area` — and without it nothing else in this file matters.

DROP TRIGGER IF EXISTS trg_quality_action_freeze_points_upd ON public.quality_actions;

CREATE TRIGGER trg_quality_action_freeze_points_upd
BEFORE UPDATE ON public.quality_actions
FOR EACH ROW
WHEN (
  old.severity          IS DISTINCT FROM new.severity
  OR old.labels            IS DISTINCT FROM new.labels
  OR old.validation_status IS DISTINCT FROM new.validation_status
  OR old.domain            IS DISTINCT FROM new.domain
  OR old.root_cause_area   IS DISTINCT FROM new.root_cause_area
)
EXECUTE FUNCTION public.quality_action_freeze_points();


-- 4. As acções que já existem ---------------------------------------------------
-- Sem auth.uid() o guard deixa passar; o freeze repreca porque root_cause_area muda;
-- o histórico regista a mudança.
UPDATE public.quality_actions q
   SET root_cause_area = m.area
  FROM (
    SELECT a.id, (
      SELECT k.area FROM public.root_cause_area_keyword k
       WHERE k.active AND a.title ~* k.pattern
       ORDER BY k.sort, k.area LIMIT 1
    ) AS area
      FROM public.quality_actions a
     WHERE a.root_cause_area IS NULL
       AND coalesce(a.domain, 'quality') <> 'safety'
       AND a.title IS NOT NULL
  ) m
 WHERE q.id = m.id AND m.area IS NOT NULL;

-- ================================================================
-- BLOCO 66
-- 20261004210000_a_rls_de_employees_le_a_matriz.sql
-- ================================================================

-- A RLS de `employees` passa a ler a matriz de permissões, como o ecrã já lê.
--
-- O painel do empregado abre o formulário a quem tem `workforce.manage`. O
-- `production_office_admin` TEM, por override gravado no ecrã de Permissões
-- (`role_permission_overrides`), e são cinco contas reais. A RLS, no entanto, só tinha
-- a policy `employees admin` (ALL, has_role('admin')): essas cinco pessoas abriam o
-- formulário, escreviam, e o PATCH do PostgREST devolvia 204 com zero linhas e sem
-- erro. O toast dizia "Saved" e o painel voltava ao valor antigo.
--
-- Isto só ACRESCENTA policies. A `employees admin` fica como está, e o DELETE continua
-- a ser só de admin de propósito: `employee_attendance` e `overtime_entries` fazem
-- cascade, portanto apagar alguém leva a assiduidade e as horas com ele. O caminho
-- para uma saída é o `active = false` com `left_on`, que é um UPDATE.
--
-- `has_action` é SECURITY DEFINER e lê `user_roles` + `role_permission_overrides`,
-- nunca `employees` — não há recursão. É a mesma função que a policy de SELECT já usa,
-- com o mesmo baseline, para que o ecrã e a base não possam voltar a discordar.

DROP POLICY IF EXISTS "employees update by matrix" ON public.employees;
CREATE POLICY "employees update by matrix"
  ON public.employees
  FOR UPDATE
  TO authenticated
  USING (public.has_action((SELECT auth.uid()), 'workforce.manage', ARRAY['admin']::app_role[]))
  WITH CHECK (public.has_action((SELECT auth.uid()), 'workforce.manage', ARRAY['admin']::app_role[]));

DROP POLICY IF EXISTS "employees insert by matrix" ON public.employees;
CREATE POLICY "employees insert by matrix"
  ON public.employees
  FOR INSERT
  TO authenticated
  WITH CHECK (public.has_action((SELECT auth.uid()), 'workforce.manage', ARRAY['admin']::app_role[]));

-- ================================================================
-- BLOCO 67
-- 20261005090000_o_cartao_do_lider_nao_sabia_de_quem_era_a_culpa.sql
-- ================================================================

-- O cartão do líder não sabia de quem era a culpa.
--
-- `leader_self_scorecard` é a única porta pela qual o tablet lê o cartão: as linhas
-- vêm de uma projecção FIXA, e uma coluna que a lista não nomeia chega ao cliente
-- como `undefined`. Todos os predicados deste repositório leem `undefined` como "não
-- há motivo para excluir" — é o mesmo defeito que `20260822093000` (domain) e
-- `20260908170000` (classification) já vieram fechar, pela terceira vez.
--
-- Medido na base viva a 04/10/2026, com pg_get_functiondef. A projecção acaba em
-- `qa.points_at_creation` e NÃO nomeia três colunas que o select do gestor nomeia:
--
--   root_cause_area   77 acções com líder têm uma causa que não lhe é cobrada
--                     (Maintenance 49, Lab 12, Warehouse 9, Office 5, Supplier 2)
--   classification    0 linhas afectadas hoje — nenhuma `excluded`/`quality_error`
--                     tem leader_name — mas `20260908170000` foi escrita para a
--                     acrescentar e nunca chegou a correr nesta base
--   source            separa as duas origens do log; o gestor lê-a, o tablet não
--
-- O que isto estragava, e não é o total. As 77 têm todas `points_at_creation = 0`,
-- e `actionPoints` prefere a figura congelada, portanto o NÚMERO no tablet está
-- certo. O que está errado é a RAZÃO. Sem `root_cause_area`, `livePoints` recalcula
-- 4 para uma acção congelada a 0, e `pointsBreakdown` entra no ramo "frozen":
--
--   "0 points — the scale in force when this was logged. Today's scale would make
--    it 4; past actions keep the scale of their own day."
--
-- O cartão do gestor, com a coluna, diz a verdade na mesma acção:
--
--   "0 points — root cause is Office, so this is not charged to the leader."
--
-- A um líder que abre o seu próprio cartão a primeira frase diz que houve uma tabela
-- de preços que mudou. Não houve: a Qualidade atribuiu aquilo ao Office. Duas frases
-- diferentes para a mesma linha é o que `leaderScorecard.ts` abre a proibir — "Two
-- fetch paths, one arithmetic" — e aqui as duas vias davam razões contraditórias.
--
-- PORQUE É QUE ISTO REMENDA EM VEZ DE SUBSTITUIR: a mesma razão que `20260822093000`
-- e `20260908170000` dão. A função é longa, nada neste repositório aplica migrações,
-- e por isso o repositório é o registo da INTENÇÃO e a base é o registo do FACTO. Lê
-- a definição viva, confirma que tem a forma que espera, e reescreve só a projecção.
-- Se a função tiver divergido, LEVANTA em vez de adivinhar.

DO $patch$
DECLARE
  _src text;
  -- A cauda da projecção. Ancorar na última coluna, e não na lista inteira, é o que
  -- mantém isto a funcionar quando uma coluna foi acrescentada à frente entretanto —
  -- foi exactamente o que aconteceu a `domain` e `safety_kind` depois de 20260822093000.
  _anchor constant text := 'qa.points_at_creation';
  -- Por ordem de quanto custa a sua ausência. Cada uma é acrescentada só se faltar,
  -- para que isto e `20260908170000` possam correr em qualquer ordem, ou duas vezes.
  --
  -- Escritas com o prefixo `qa.` à letra, e não montadas com `'qa.' || _col`:
  -- theTwoCardsProjectTheSameRow.test.ts procura `qa.<coluna>` nos ficheiros desta
  -- pasta, e uma lista montada em tempo de execução não aparece a quem lê o texto.
  _wanted constant text[] := ARRAY['qa.root_cause_area', 'qa.classification', 'qa.source'];
  _missing text[] := '{}';
  _col text;
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

  FOREACH _col IN ARRAY _wanted LOOP
    IF position(_col IN _src) = 0 THEN
      _missing := _missing || _col;
    END IF;
  END LOOP;

  -- Idempotente: voltar a correr uma migração não pode ser uma maneira de estragar algo.
  IF cardinality(_missing) = 0 THEN
    RAISE NOTICE 'leader_self_scorecard ja projecta as tres colunas. Sem alteracao.';
    RETURN;
  END IF;

  _hits := (length(_src) - length(replace(_src, _anchor, ''))) / length(_anchor);

  IF _hits <> 1 THEN
    RAISE EXCEPTION
      'A projeccao de leader_self_scorecard nao tem a forma esperada (% ocorrencias de "%"). '
      'A funcao viva divergiu do que esta migracao conhece: comparar com '
      'pg_get_functiondef antes de aplicar, e acrescentar % a mao. Um cartao que diz '
      'ao lider que o preco mudou, quando o que mudou foi a area culpada, e o defeito '
      'que isto corrige.',
      _hits, _anchor, array_to_string(_missing, ', ')
      USING ERRCODE = 'raise_exception';
  END IF;

  EXECUTE replace(
    _src,
    _anchor,
    _anchor || ', ' || array_to_string(_missing, ', ')
  );

  RAISE NOTICE 'leader_self_scorecard passa a projectar %.', array_to_string(_missing, ', ');
END $patch$;

-- ================================================================
-- BLOCO 68
-- 20261005091000_a_hora_que_a_janela_de_leitura_nao_via.sql
-- ================================================================

-- A hora que a janela de leitura não via.
--
-- `leader_self_scorecard` abre a sua janela de leitura em
--
--   _gte := (_from::text || 'T00:00:00.000Z')::timestamptz
--
-- que é UTC, enquanto TODAS as regras que decidem a que dia uma acção pertence leem a
-- hora de LONDRES — `shiftSessionDate` em src/lib/shifts.ts, e o `AT TIME ZONE
-- 'Europe/London'` que o resto desta base usa. Oito meses por ano as duas concordam.
-- Sob BST estão uma hora afastadas, e é a ponta de baixo que custa:
--
--   '2026-07-28T00:00:00Z' é 01:00 em Londres. Uma acção registada entre 00:00 e 00:59
--   do dia 28 — marcada 23:xx UTC do dia 27 — fica FORA da janela. Se a coluna `shift`
--   disser NIGHT ela pertence ao dia 27 e nada se perde. Se disser DAY,
--   `shiftSessionDate` arquiva-a no dia 28, o período pediu o dia 28, e a linha
--   simplesmente nunca foi lida. Sem erro e sem ecrã vazio: uma acção ausente do dia
--   de um líder, e nada que o diga.
--
-- Corrigido do lado do TypeScript em `shiftDateFetchRange`, que é a mesma janela e tinha
-- a mesma hora escrita da mesma maneira errada, e lida por seis ecrãs. Esta é a cópia
-- em SQL — "Two fetch paths, one arithmetic" — e tem de andar com a outra.
--
-- Medido na produção a 04/10/2026: as 48 acções registadas antes das 07:00 de Londres
-- têm todas uma coluna `shift` que concorda com o relógio (37 NIGHT antes das 06:00,
-- 11 DAY a partir das 06:00), portanto HOJE isto não move linha nenhuma. É a hora onde
-- a próxima teria caído.
--
-- SÓ A PONTA DE BAIXO. A de cima fica em `(_to + 1) 06:59:59.999Z` como está: o cliente
-- volta a filtrar tudo com `actionsInPeriod`, que devolve ao remetente qualquer linha
-- cuja data de turno caia fora do período, por isso a janela de cima só tem de ser um
-- SUPERCONJUNTO — e é. Apertá-la não ganharia uma linha e seria mais uma coisa a poder
-- estar errada.

DO $patch$
DECLARE
  _src text;
  _old constant text := '(_from::text || ''T00:00:00.000Z'')::timestamptz';
  _new constant text := '(_from::text || '' 00:00'')::timestamp AT TIME ZONE ''Europe/London''';
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

  -- Idempotente: voltar a correr uma migração não pode ser uma maneira de estragar algo.
  IF position(_new IN _src) > 0 THEN
    RAISE NOTICE 'leader_self_scorecard ja abre a janela a meia-noite de Londres. Sem alteracao.';
    RETURN;
  END IF;

  _hits := (length(_src) - length(replace(_src, _old, ''))) / length(_old);

  IF _hits <> 1 THEN
    RAISE EXCEPTION
      'A janela de leitura de leader_self_scorecard nao tem a forma esperada '
      '(% ocorrencias). A funcao viva divergiu do que esta migracao conhece: comparar '
      'com pg_get_functiondef antes de aplicar. O defeito a corrigir e _gte estar em '
      'UTC quando shiftSessionDate le a hora de Londres.',
      _hits
      USING ERRCODE = 'raise_exception';
  END IF;

  EXECUTE replace(_src, _old, _new);
  RAISE NOTICE 'leader_self_scorecard abre a janela a meia-noite de Londres.';
END $patch$;

-- ================================================================
-- BLOCO 69
-- 20261005120000_o_relogio_mede_a_ultima_picagem.sql
-- ================================================================

-- A cobertura do relogio mede a ultima PICAGEM, nao o dia mais longe que o import cobre.
--
-- Medido na base a 05/10/2026. A view dava `last_on_date = 2026-10-11`, seis dias a
-- FRENTE de hoje, porque `last_on_date` era `max(on_date)` e o `attendance_days` tinha
-- 210 linhas datadas depois de hoje:
--
--   dia     linhas  worked_minutes>0  start_time  scheduled_minutes>0
--   06/10     35           0              0              0
--   07/10     35           0              0              0
--   08/10     35           0              0              0
--   09/10     35           0              0             32
--   10/10     35           0              0             32
--   11/10     35           0              0             35
--
-- Seis dias, 35 pessoas cada, todas `source = 'timemoto'`, todas escritas de uma vez a
-- 03/10 as 07:15:48. **Zero minutos trabalhados e zero horas de entrada**: o que o
-- import trouxe foi o HORARIO PREVISTO, nao picagens.
--
-- Nenhuma dessas linhas e uma picagem, e o `max(on_date)` contava-as. O
-- `ClockCoverageNote` — que tres ecras leem (Attendance, Leave, Production Headcount)
-- — dizia por isso "The clock was last imported for 11 Oct 2026", e o `Math.max(0, …)`
-- da app transformava os -6 dias em zero, que nessa nota se escreve "today". A nota
-- existe exactamente para impedir que se leia mal o relogio.
--
-- A app ja foi corrigida para nunca mais chamar "today" a uma data futura (PR #537,
-- `coverageFrom` + `daysAhead`). Isso era o remendo; isto e a correccao: a pergunta
-- certa feita no sitio onde esta escrita.
--
-- **O que conta como picagem.** Uma linha tem conteudo de relogio quando tem minutos
-- trabalhados, OU uma hora de entrada, OU uma ausencia registada. A ausencia conta de
-- proposito: o TimeMoto sabe alguma coisa daquele dia e disse-a, portanto o import
-- CHEGA la. O que nao conta e uma linha so com `scheduled_minutes`, que e o turno que
-- a pessoa devia fazer e nao noticia nenhuma sobre o que fez.
--
-- `rows_total` fica a contar a tabela inteira, que e o que o nome diz. Nenhum ecra o
-- mostra hoje; serve de controlo, e um dia em que `rows_total` cresce sem o
-- `employees_covered` crescer e precisamente este caso a acontecer outra vez.
--
-- **Medido na base, antes e depois de aplicar isto:**
--
--   last_on_date        2026-10-11  ->  2026-10-03   (de seis dias A FRENTE para dois atras)
--   first_on_date       2026-06-08  ->  2026-06-08   (igual)
--   employees_covered           99  ->  99           (igual)
--   rows_total                7108      dos quais 3228 (45%) sao linhas so com horario
--
-- O `employees_covered` NAO se move, e vale dizer porque: suspeitei que o "99 de 211"
-- estivesse inflado pelas linhas de horario, e nao esta — quem so tem horario previsto
-- tambem tem picagem noutro dia qualquer. O que estava errado era a data, so a data.
--
-- As colunas, os nomes, a ordem e os tipos ficam iguais: `CREATE OR REPLACE VIEW`
-- exige-o, e e a razao pela qual **nao ha codigo acoplado a esta migracao** — o
-- `useClockCoverage` e o unico leitor na app e nao muda uma linha. Pode ser aplicada
-- antes ou depois de qualquer merge.

CREATE OR REPLACE VIEW public.v_timemoto_coverage AS
WITH picado AS (
  SELECT on_date, employee_id
  FROM attendance_days
  WHERE worked_minutes > 0
     OR start_time IS NOT NULL
     OR absence_name IS NOT NULL
)
SELECT
  (SELECT max(on_date) FROM picado)                AS last_on_date,
  (SELECT min(on_date) FROM picado)                AS first_on_date,
  (SELECT count(DISTINCT employee_id) FROM picado) AS employees_covered,
  (SELECT count(*) FROM employees WHERE active)    AS active_employees,
  (SELECT count(*) FROM attendance_days)           AS rows_total;

COMMENT ON VIEW public.v_timemoto_coverage IS
  'Onde o relogio do TimeMoto esta, para os ecras que leem numeros assentes nele. Conta so linhas com picagem ou ausencia registada: uma linha so com horario previsto e um plano, e ja fez a nota dizer "today" sobre uma data seis dias no futuro.';

-- Reafirmado em vez de assumido. O `CREATE OR REPLACE VIEW` preserva os privilegios
-- que a view ja tinha, portanto um GRANT a mais que alguem tenha dado sobrevive a isto
-- sem aparecer no ficheiro. Uma view sem RLS propria le a tabela com os direitos de
-- quem a criou — foi uma view assim que ja expos 508 ordens de trabalho ao `anon`
-- nesta base — e o `anon` nao tem nada que saber onde esta o relogio da fabrica.
REVOKE ALL ON public.v_timemoto_coverage FROM PUBLIC;
REVOKE ALL ON public.v_timemoto_coverage FROM anon;
GRANT SELECT ON public.v_timemoto_coverage TO authenticated;

-- ================================================================
-- BLOCO 70
-- 20261006180000_overtime_is_offered_before_it_is_worked.sql
-- ================================================================

-- 10 · Overtime is offered before it is worked.
--
-- `overtime_entries` records hours AFTER the fact, copied from the payroll sheet, and
-- a trigger refuses hand-written rows. Nothing in the schema says what happened
-- BEFORE: who was asked, who said yes, who the supervisor picked, who then failed to
-- turn up. That is the part the floor actually fights over, and it lived in WhatsApp.
--
-- Three tables, one per moment:
--   overtime_requests   the supervisor's ask — "Saturday 14:00–22:00, I need 4"
--   overtime_responses  one row per person per ask — yes/no, then accepted/reserve/declined
--   overtime_outcomes   what the person did on the day — turned up, sick, no-show
--
-- Hours are NOT recorded here. When the day is over, the hours arrive from TimeMoto
-- as they do for every other day; this module only knows who was supposed to be in.
--
-- Idempotent throughout. Safe to run twice.

-- ---------------------------------------------------------------------------
-- 1. The ask
-- ---------------------------------------------------------------------------
create table if not exists public.overtime_requests (
  id            uuid primary key default gen_random_uuid(),
  on_date       date not null,
  starts_at     time not null,
  ends_at       time not null,
  -- How many people the supervisor needs. Not how many will say yes.
  headcount     integer not null check (headcount > 0),
  -- Who sees it. Null = every active employee.
  department    text,
  shift_group   text,
  note          text,
  status        text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  closed_at     timestamptz,
  constraint overtime_requests_ends_after_starts check (ends_at <> starts_at)
);

create index if not exists overtime_requests_on_date_idx on public.overtime_requests (on_date desc);

-- ---------------------------------------------------------------------------
-- 2. The answer, then the decision
-- ---------------------------------------------------------------------------
create table if not exists public.overtime_responses (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.overtime_requests(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  -- What the person said. 'no' is kept, so the supervisor knows who has seen it.
  answer        text not null check (answer in ('yes', 'no')),
  -- What the supervisor did with a 'yes'. Null until decided.
  decision      text check (decision in ('accepted', 'reserve', 'declined')),
  answered_at   timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references auth.users(id),
  -- One answer per person per ask. Changing your mind is an UPDATE, not a second row.
  constraint overtime_responses_one_per_person unique (request_id, employee_id)
);

create index if not exists overtime_responses_request_idx on public.overtime_responses (request_id);
create index if not exists overtime_responses_employee_idx on public.overtime_responses (employee_id);

-- ---------------------------------------------------------------------------
-- 3. What happened on the day
-- ---------------------------------------------------------------------------
create table if not exists public.overtime_outcomes (
  response_id   uuid primary key references public.overtime_responses(id) on delete cascade,
  outcome       text not null check (outcome in (
                  'attended', 'no_show', 'called_sick', 'cancelled_in_time', 'cancelled_late')),
  note          text,
  recorded_by   uuid not null references auth.users(id),
  recorded_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. Who may do what
-- ---------------------------------------------------------------------------
alter table public.overtime_requests  enable row level security;
alter table public.overtime_responses enable row level security;
alter table public.overtime_outcomes  enable row level security;

-- The roles that run overtime. Mirrors `overtime.manage` in src/lib/permissions.ts;
-- the two lists must agree or the screen promises what the database refuses. The
-- `supervisor` enum value is retired and deliberately absent: the people who run the
-- floor sign in as manager or production_office_admin.
create or replace function public.can_manage_overtime(uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  -- Through has_action, so an override saved on the Permissions Matrix screen
  -- counts here too. The array is the baseline: the same three the matrix carries.
  select public.has_action(uid, 'overtime.manage',
           array['admin','manager','production_office_admin']::app_role[]);
$$;

-- The employee row that belongs to the signed-in person, if any.
create or replace function public.my_employee_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.employees where user_id = auth.uid() and active limit 1;
$$;

drop policy if exists "overtime_requests_read"   on public.overtime_requests;
drop policy if exists "overtime_requests_manage" on public.overtime_requests;
create policy "overtime_requests_read" on public.overtime_requests
  for select to authenticated using (true);
create policy "overtime_requests_manage" on public.overtime_requests
  for all to authenticated
  using (public.can_manage_overtime(auth.uid()))
  with check (public.can_manage_overtime(auth.uid()));

drop policy if exists "overtime_responses_read"     on public.overtime_responses;
drop policy if exists "overtime_responses_own"      on public.overtime_responses;
drop policy if exists "overtime_responses_decide"   on public.overtime_responses;
-- Everybody signed in can see the list. The floor already knows who put their hand
-- up; hiding it here would only move the argument back to WhatsApp.
create policy "overtime_responses_read" on public.overtime_responses
  for select to authenticated using (true);
-- A person writes only their own answer, and only while the ask is open.
create policy "overtime_responses_own" on public.overtime_responses
  for insert to authenticated
  with check (
    employee_id = public.my_employee_id()
    and exists (select 1 from public.overtime_requests r
                 where r.id = request_id and r.status = 'open')
  );
-- Managers may change anything: the decision, or an answer on behalf of somebody
-- who has no login and said yes at the desk.
create policy "overtime_responses_decide" on public.overtime_responses
  for all to authenticated
  using (public.can_manage_overtime(auth.uid()))
  with check (public.can_manage_overtime(auth.uid()));

drop policy if exists "overtime_outcomes_read"   on public.overtime_outcomes;
drop policy if exists "overtime_outcomes_manage" on public.overtime_outcomes;
create policy "overtime_outcomes_read" on public.overtime_outcomes
  for select to authenticated using (true);
create policy "overtime_outcomes_manage" on public.overtime_outcomes
  for all to authenticated
  using (public.can_manage_overtime(auth.uid()))
  with check (public.can_manage_overtime(auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Answering — the one write an employee makes
-- ---------------------------------------------------------------------------
-- An UPSERT behind a function rather than a raw upsert from the screen, so the rules
-- live in one place: you can change 'no' to 'yes' while the ask is open; you cannot
-- change anything once the supervisor has decided on you.
create or replace function public.answer_overtime(p_request_id uuid, p_answer text)
returns public.overtime_responses
language plpgsql security definer set search_path = public
as $$
declare
  v_emp uuid := public.my_employee_id();
  v_row public.overtime_responses;
begin
  if v_emp is null then
    raise exception 'No employee record is linked to this login' using errcode = 'P0001';
  end if;
  if p_answer not in ('yes', 'no') then
    raise exception 'Answer must be yes or no' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.overtime_requests where id = p_request_id and status = 'open') then
    raise exception 'This overtime is no longer open' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.overtime_responses
              where request_id = p_request_id and employee_id = v_emp and decision is not null) then
    raise exception 'The supervisor has already decided on your answer' using errcode = 'P0001';
  end if;

  insert into public.overtime_responses (request_id, employee_id, answer)
  values (p_request_id, v_emp, p_answer)
  on conflict (request_id, employee_id)
  do update set answer = excluded.answer, answered_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Linking a login to an employee row
-- ---------------------------------------------------------------------------
-- Employees mostly have no login: `employees.user_id` is null for nearly everybody.
-- The sign-up page (invite code) creates the login; this links it to the person, once,
-- and only to a row nobody else holds. If the row has an email, it has to match.
create or replace function public.link_me_to_employee(p_employee_id uuid)
returns public.employees
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_row   public.employees;
begin
  if public.my_employee_id() is not null then
    raise exception 'This login is already linked to an employee' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = auth.uid();

  update public.employees
     set user_id = auth.uid()
   where id = p_employee_id
     and active
     and user_id is null
     and (email is null or lower(email) = lower(coalesce(v_email, '')))
  returning * into v_row;

  if v_row.id is null then
    raise exception 'That employee cannot be linked to this login' using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6b. Names, without the roster
-- ---------------------------------------------------------------------------
-- `employees` is readable only behind `workforce.view` (admin). That is right for a
-- table with emails, reporting lines and a notes field — and it means neither the
-- manager posting an ask nor the operator answering it can read it. These three
-- functions hand out only what the screens need: an id, a name, a department and a
-- shift. No email, no notes, no manager. A printed rota on the wall says as much.

-- Active people, for the manager choosing. Gated on the same permission as the screen.
create or replace function public.overtime_roster()
returns table (id uuid, full_name text, department text, shift_group text)
language sql stable security definer set search_path = public
as $$
  select e.id, e.full_name, e.department, e.shift_group
    from public.employees e
   where e.active
     and public.can_manage_overtime(auth.uid())
   order by e.full_name;
$$;

-- The caller's own row. Null when the login is not linked to anybody yet.
create or replace function public.my_overtime_identity()
returns table (id uuid, full_name text, department text, shift_group text)
language sql stable security definer set search_path = public
as $$
  select e.id, e.full_name, e.department, e.shift_group
    from public.employees e
   where e.user_id = auth.uid() and e.active
   limit 1;
$$;

-- Names nobody has claimed yet, for the first visit. Any login may read this list:
-- it is how a new login finds itself, and it holds no more than a name and a department.
create or replace function public.overtime_unlinked_names()
returns table (id uuid, full_name text, department text, shift_group text)
language sql stable security definer set search_path = public
as $$
  select e.id, e.full_name, e.department, e.shift_group
    from public.employees e
   where e.active and e.user_id is null
   order by e.full_name;
$$;

-- ---------------------------------------------------------------------------
-- 7. The number beside the name
-- ---------------------------------------------------------------------------
-- How many times, this calendar month, each person did not turn up — from the three
-- places the factory records it: the headcount board (`employee_attendance`), the
-- TimeMoto import (`attendance_days`) and overtime they had accepted (`overtime_outcomes`).
-- Booked holiday is not an absence and is not counted. The 60-day column is overtime
-- only: accepted shifts, and how many of those were actually worked.
create or replace function public.overtime_reliability(p_month date default current_date)
returns table (
  employee_id        uuid,
  sick_this_month    integer,
  absent_this_month  integer,
  ot_accepted_60d    integer,
  ot_attended_60d    integer
)
language sql stable security definer set search_path = public
as $$
  with bounds as (
    select date_trunc('month', p_month)::date                       as m_from,
           (date_trunc('month', p_month) + interval '1 month')::date as m_to,
           (current_date - 60)                                        as d60
  ),
  board as (
    select a.employee_id,
           count(*) filter (where a.status = 'sick')                       as sick,
           count(*) filter (where a.status in ('unpaid', 'absent', 'awol')) as absent
      from public.employee_attendance a, bounds b
     where a.on_date >= b.m_from and a.on_date < b.m_to
     group by a.employee_id
  ),
  clocks as (
    select d.employee_id,
           count(*) filter (where d.absence_name ~* 'sick')                                 as sick,
           count(*) filter (where d.absence_name is not null
                              and d.absence_name !~* 'sick'
                              and d.absence_name !~* 'holiday|vacation|annual')               as absent
      from public.attendance_days d, bounds b
     where d.on_date >= b.m_from and d.on_date < b.m_to
     group by d.employee_id
  ),
  ot_month as (
    select r.employee_id,
           count(*) filter (where o.outcome = 'called_sick')                          as sick,
           count(*) filter (where o.outcome in ('no_show', 'cancelled_late'))          as absent
      from public.overtime_outcomes o
      join public.overtime_responses r on r.id = o.response_id
      join public.overtime_requests q on q.id = r.request_id, bounds b
     where q.on_date >= b.m_from and q.on_date < b.m_to
     group by r.employee_id
  ),
  ot_60 as (
    select r.employee_id,
           count(*)                                            as accepted,
           count(*) filter (where o.outcome = 'attended')      as attended
      from public.overtime_responses r
      join public.overtime_requests q on q.id = r.request_id
      left join public.overtime_outcomes o on o.response_id = r.id, bounds b
     where r.decision = 'accepted' and q.on_date >= b.d60 and q.on_date <= current_date
     group by r.employee_id
  ),
  ids as (
    select employee_id from board
    union select employee_id from clocks
    union select employee_id from ot_month
    union select employee_id from ot_60
  )
  select i.employee_id,
         coalesce(b.sick, 0) + coalesce(c.sick, 0) + coalesce(m.sick, 0),
         coalesce(b.absent, 0) + coalesce(c.absent, 0) + coalesce(m.absent, 0),
         coalesce(s.accepted, 0),
         coalesce(s.attended, 0)
    from ids i
    left join board    b on b.employee_id = i.employee_id
    left join clocks   c on c.employee_id = i.employee_id
    left join ot_month m on m.employee_id = i.employee_id
    left join ot_60    s on s.employee_id = i.employee_id;
$$;

grant execute on function public.answer_overtime(uuid, text)       to authenticated;
grant execute on function public.link_me_to_employee(uuid)         to authenticated;
grant execute on function public.overtime_reliability(date)        to authenticated;
grant execute on function public.can_manage_overtime(uuid)         to authenticated;
grant execute on function public.my_employee_id()                  to authenticated;
grant execute on function public.overtime_roster()                 to authenticated;
grant execute on function public.my_overtime_identity()            to authenticated;
grant execute on function public.overtime_unlinked_names()         to authenticated;

-- ================================================================
-- BLOCO 71
-- 20261006193000_an_ask_tells_the_people_it_is_for.sql
-- ================================================================

-- An ask tells the people it is for.
--
-- Posting an overtime ask wrote a row and nothing else. Whoever did not open the app
-- that day never knew, and "first to answer" quietly became "first to look". The push
-- goes out from the manager's screen through `send-push`, which already writes the
-- in-app bell and web-pushes to anyone who turned it on. What the screen lacked was
-- the list of logins to send to: `employees` is admin-only, so a manager could not
-- read user_id off it.
--
-- This hands out exactly that — user ids, nothing else — and only to somebody who can
-- manage overtime. With no employee list it returns the ask's audience (department and
-- shift as the ask narrows them, every linked employee otherwise). With a list it
-- returns those people's logins, for "you're in" and "you're on reserve".
--
-- Idempotent.

create or replace function public.overtime_push_targets(
  p_request_id  uuid,
  p_employee_ids uuid[] default null
)
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select distinct e.user_id
    from public.employees e
    join public.overtime_requests q on q.id = p_request_id
   where public.can_manage_overtime(auth.uid())
     and e.active
     and e.user_id is not null
     and (
       (p_employee_ids is null
        and (q.department  is null or q.department  = e.department)
        and (q.shift_group is null or q.shift_group = e.shift_group))
       or e.id = any (coalesce(p_employee_ids, '{}'::uuid[]))
     );
$$;

grant execute on function public.overtime_push_targets(uuid, uuid[]) to authenticated;

-- ================================================================
-- BLOCO 72
-- 20261006193800_two_buckets_the_policies_already_assumed.sql
-- ================================================================

-- Dois buckets que as políticas já presumiam, e que nenhuma migração criava.
--
-- `part-photos` tem políticas desde 26/08 (e revistas a 08/09 e 18/09).
-- `technical-docs` tem políticas desde 21/09. A app lê e escreve nos dois:
-- `usePartPhotos.ts` e `useTechnicalInfo.ts`.
--
-- Nenhum dos dois foi alguma vez criado por uma migração. Existem em produção
-- porque alguém os criou à mão no painel. O que ficou escrito no repositório
-- foram as políticas — regras sobre um bucket que o SQL nunca cria.
--
-- Numa base nova as políticas aplicam-se a um bucket que não está lá, e os ecrãs
-- falham com "Bucket not found": a fotografia de peças no Stock, e o repositório
-- técnico inteiro de manuais e procedimentos de máquina.
--
-- Verificado a 06/10/2026 no destino da migração `ammlyqnjlhioukpgldgc`: tem
-- `dm-audio`, `part-photos`, `quality-photos` e `wo-photos` — e **não** tem
-- `technical-docs`. O `part-photos` também lá está por mão humana, não por este
-- SQL; entra aqui para que a próxima base não dependa de ninguém se lembrar.
--
-- É a mesma classe de falha que o `AGENTS.md` já regista para vistas e funções
-- ("Database objects the app reads must exist in a migration"), aplicada a
-- buckets, que o teste existente não cobria. Passa a cobrir — ver
-- `src/__tests__/aAppNaoLeNenhumBucketQueNaoEstejaNumaMigracao.test.ts`.
--
-- Os dois são privados, e isso não é escolha deste ficheiro:
--   * `part-photos` foi documentado como privado quando as políticas foram
--     escritas ("live in the private part-photos bucket");
--   * `technical-docs` é lido por `createSignedUrl`, que só um bucket privado
--     precisa.
--
-- Idempotente de propósito: a produção já tem os dois, e aqui isto não faz nada.

INSERT INTO storage.buckets (id, name, public)
VALUES ('part-photos', 'part-photos', false)
ON CONFLICT (id) DO NOTHING;

INSERT INTO storage.buckets (id, name, public)
VALUES ('technical-docs', 'technical-docs', false)
ON CONFLICT (id) DO NOTHING;

-- ================================================================
-- BLOCO 72
-- 20261006204000_an_invite_that_never_expires_is_a_door_left_open.sql
-- ================================================================

-- An invite that never expires is a door left open.
--
-- The invite code is one string, pasted into a WhatsApp group, and it stays valid until
-- an admin remembers to change it. Nobody remembers. The overtime module is about to
-- send that link to 211 people, which is 211 phones it can be forwarded from.
--
-- One column: when the code stops working. Null keeps today's behaviour, so nothing
-- changes until an admin sets a date; the settings card proposes seven days whenever a
-- new code is generated. check_invite_code is the only reader and gains the one clause.
--
-- Idempotent.

alter table public.signup_config
  add column if not exists invite_expires_at timestamptz;

create or replace function public.check_invite_code(code text)
returns boolean
language sql security definer set search_path = public
as $$
  select coalesce(bool_or(
           enabled
           and invite_code is not null
           and invite_code = code
           and (invite_expires_at is null or now() < invite_expires_at)
         ), false)
    from public.signup_config
   where id;
$$;

revoke all on function public.check_invite_code(text) from public;
grant execute on function public.check_invite_code(text) to anon, authenticated;

-- ================================================================
-- BLOCO 73
-- 20261006210000_a_floor_login_does_not_wait_in_a_queue.sql
-- ================================================================

-- A floor login does not wait in a queue.
--
-- Self sign-ups land pending — no role, inactive — and an admin activates each one by
-- hand. Right for a login that will see production figures; wrong for the 211 people
-- the overtime link is about to reach, who need to do exactly one thing: say yes or no.
-- An operator login can see its own asks and its own answers, and nothing an admin
-- would mind it seeing. Two hundred approvals would mean two hundred people who could
-- not answer this week's overtime.
--
-- One setting on signup_config: the role a self sign-up starts with. Null (today's
-- value, and the default) keeps the queue. 'operator' makes the account active with
-- that role on creation. Admins still hear about it — a quieter notification, with the
-- name and the role — and can deactivate as before. handle_new_user is the only reader.
--
-- Idempotent.

alter table public.signup_config
  add column if not exists self_signup_role public.app_role;

-- What the sign-up page tells the person to expect. Anonymous, because they are not
-- signed in yet; returns the role name or null, nothing else.
create or replace function public.self_signup_role()
returns text
language sql stable security definer set search_path = public
as $$
  select self_signup_role::text from public.signup_config where id;
$$;
revoke all on function public.self_signup_role() from public;
grant execute on function public.self_signup_role() to anon, authenticated;

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  is_first_user boolean;
  is_self boolean := (new.raw_user_meta_data->>'self_signup' = 'true');
  auto_role public.app_role := (select self_signup_role from public.signup_config where id);
  display_name text := coalesce(new.raw_user_meta_data->>'name', new.email);
begin
  select not exists (select 1 from public.profiles for update) into is_first_user;

  insert into public.profiles (id, name, email, active)
  values (
    new.id,
    display_name,
    new.email,
    case when is_self and not is_first_user and auto_role is null then false else true end
  );

  if is_first_user then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  elsif is_self and auto_role is not null then
    insert into public.user_roles (user_id, role) values (new.id, auto_role)
    on conflict do nothing;
  end if;

  if is_self and not is_first_user then
    if auto_role is null then
      insert into public.notifications (user_id, title, body, priority, action_url)
      select ur.user_id,
             'New account pending approval',
             display_name || ' registered and needs a role.',
             'high',
             '/users/manage'
        from public.user_roles ur where ur.role = 'admin';
    else
      insert into public.notifications (user_id, title, body, priority, action_url)
      select ur.user_id,
             'New ' || auto_role::text || ' account',
             display_name || ' registered with the invite link and is active.',
             'low',
             '/users/manage'
        from public.user_roles ur where ur.role = 'admin';
    end if;
  end if;

  return new;
end;
$function$;

-- ================================================================
-- BLOCO 74
-- 20261006212000_when_one_drops_out_the_reserve_steps_in.sql
-- ================================================================

-- When one drops out, the reserve steps in.
--
-- The supervisor accepts four and marks one or two as reserve, because somebody always
-- rings in sick. Then somebody rings in sick, and the supervisor has to notice, open the
-- ask, find the reserve, and press Accept — on a phone, between two other problems. The
-- reserve exists so that this is not a decision; so the database makes it not one.
--
-- Recording an outcome goes through this function. When the outcome says an ACCEPTED
-- person will not be there (sick, no-show, cancelled either way) and the ask is still
-- open, the longest-waiting reserve is promoted to accepted, stamped with the recorder,
-- and returned — so the screen can tell that person their place opened. Attended, or a
-- drop-out on an ask already closed, promotes nobody. One promotion per outcome: a
-- second drop-out promotes the next reserve on its own call.
--
-- Idempotent.

create or replace function public.record_overtime_outcome(
  p_response_id uuid,
  p_outcome     text,
  p_note        text default null
)
returns table (promoted_response_id uuid, promoted_employee_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  v_req   public.overtime_requests;
  v_resp  public.overtime_responses;
  v_next  public.overtime_responses;
begin
  if not public.can_manage_overtime(auth.uid()) then
    raise exception 'Only somebody who manages overtime can record an outcome' using errcode = '42501';
  end if;
  if p_outcome not in ('attended', 'no_show', 'called_sick', 'cancelled_in_time', 'cancelled_late') then
    raise exception 'Unknown outcome %', p_outcome using errcode = 'P0001';
  end if;

  select * into v_resp from public.overtime_responses where id = p_response_id for update;
  if v_resp.id is null then
    raise exception 'No such response' using errcode = 'P0001';
  end if;
  select * into v_req from public.overtime_requests where id = v_resp.request_id for update;

  insert into public.overtime_outcomes (response_id, outcome, note, recorded_by, recorded_at)
  values (p_response_id, p_outcome, p_note, auth.uid(), now())
  on conflict (response_id) do update
    set outcome = excluded.outcome, note = excluded.note,
        recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at;

  -- Somebody who was in is now out, and there is still a shift to fill.
  if v_resp.decision = 'accepted'
     and p_outcome <> 'attended'
     and v_req.status = 'open'
  then
    select * into v_next
      from public.overtime_responses r
     where r.request_id = v_req.id
       and r.decision = 'reserve'
       and r.answer = 'yes'
       and not exists (select 1 from public.overtime_outcomes o where o.response_id = r.id)
     order by r.answered_at
     limit 1
     for update skip locked;

    if v_next.id is not null then
      update public.overtime_responses
         set decision = 'accepted', decided_at = now(), decided_by = auth.uid()
       where id = v_next.id;
      return query select v_next.id, v_next.employee_id;
      return;
    end if;
  end if;

  return;
end;
$$;

grant execute on function public.record_overtime_outcome(uuid, text, text) to authenticated;

-- ================================================================
-- BLOCO 75
-- 20261006220000_a_rule_the_floor_can_read.sql
-- ================================================================

-- A rule the floor can read.
--
-- The supervisor sees "2 sick · 1 absent" beside a name and decides. That is the right
-- default, and it stays the default. But two things the floor argues about should not
-- depend on who the supervisor is that week: whether a no-show keeps you out of the
-- next asks, and whether cancelling the night before is the same as cancelling with
-- a week's notice. Written down, they are a rule; left to judgement, they are a grudge.
--
-- One row of settings, both rules OFF until a manager turns them on:
--   no_show_block_days   0 = off. A no-show (and, if the switch says so, a late
--                        cancellation) blocks self-sign-up for this many days after the
--                        shift. The manager can still add the person at the desk.
--   late_cancel_hours    0 = off. "Cancelled" recorded fewer than this many hours before
--                        the shift starts is cancelled_late; otherwise cancelled_in_time.
--                        The manager records "cancelled"; the clock decides which.
--   late_cancel_blocks   whether cancelled_late counts toward the block above.
--
-- Idempotent.

create table if not exists public.overtime_rules (
  id                  boolean primary key default true check (id),
  no_show_block_days  integer not null default 0 check (no_show_block_days between 0 and 365),
  late_cancel_hours   integer not null default 0 check (late_cancel_hours between 0 and 168),
  late_cancel_blocks  boolean not null default false,
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id)
);
insert into public.overtime_rules (id) values (true) on conflict (id) do nothing;

alter table public.overtime_rules enable row level security;
drop policy if exists "overtime_rules_read"   on public.overtime_rules;
drop policy if exists "overtime_rules_manage" on public.overtime_rules;
create policy "overtime_rules_read" on public.overtime_rules
  for select to authenticated using (true);
create policy "overtime_rules_manage" on public.overtime_rules
  for update to authenticated
  using (public.can_manage_overtime(auth.uid()))
  with check (public.can_manage_overtime(auth.uid()));

-- ---------------------------------------------------------------------------
-- Until when is this person out, and why. Null when they are not.
-- ---------------------------------------------------------------------------
create or replace function public.overtime_block_for(p_employee_id uuid)
returns table (blocked_until date, reason text, on_date date)
language sql stable security definer set search_path = public
as $$
  with rules as (select * from public.overtime_rules where id),
  hits as (
    select q.on_date,
           o.outcome,
           (q.on_date + r.no_show_block_days)::date as until_date
      from public.overtime_outcomes o
      join public.overtime_responses rs on rs.id = o.response_id
      join public.overtime_requests q on q.id = rs.request_id
      cross join rules r
     where rs.employee_id = p_employee_id
       and r.no_show_block_days > 0
       and (o.outcome = 'no_show' or (r.late_cancel_blocks and o.outcome = 'cancelled_late'))
       and (q.on_date + r.no_show_block_days) > current_date
  )
  select until_date, outcome, on_date
    from hits
   order by until_date desc
   limit 1;
$$;
grant execute on function public.overtime_block_for(uuid) to authenticated;

-- The caller's own block, for the My Overtime screen.
create or replace function public.my_overtime_block()
returns table (blocked_until date, reason text, on_date date)
language sql stable security definer set search_path = public
as $$
  select * from public.overtime_block_for(public.my_employee_id());
$$;
grant execute on function public.my_overtime_block() to authenticated;

-- ---------------------------------------------------------------------------
-- answer_overtime refuses a blocked person, and says until when.
-- ---------------------------------------------------------------------------
create or replace function public.answer_overtime(p_request_id uuid, p_answer text)
returns public.overtime_responses
language plpgsql security definer set search_path = public
as $$
declare
  v_emp   uuid := public.my_employee_id();
  v_row   public.overtime_responses;
  v_block record;
begin
  if v_emp is null then
    raise exception 'No employee record is linked to this login' using errcode = 'P0001';
  end if;
  if p_answer not in ('yes', 'no') then
    raise exception 'Answer must be yes or no' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.overtime_requests where id = p_request_id and status = 'open') then
    raise exception 'This overtime is no longer open' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.overtime_responses
              where request_id = p_request_id and employee_id = v_emp and decision is not null) then
    raise exception 'The supervisor has already decided on your answer' using errcode = 'P0001';
  end if;
  -- A "no" is always allowed: it is information, not a request.
  if p_answer = 'yes' then
    select * into v_block from public.overtime_block_for(v_emp);
    if v_block.blocked_until is not null then
      raise exception 'You can''t sign up for overtime until %. (Missed overtime on %.)',
        to_char(v_block.blocked_until, 'DD/MM'), to_char(v_block.on_date, 'DD/MM')
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.overtime_responses (request_id, employee_id, answer)
  values (p_request_id, v_emp, p_answer)
  on conflict (request_id, employee_id)
  do update set answer = excluded.answer, answered_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- record_overtime_outcome accepts "cancelled" and lets the clock decide.
-- ---------------------------------------------------------------------------
create or replace function public.record_overtime_outcome(
  p_response_id uuid,
  p_outcome     text,
  p_note        text default null
)
returns table (promoted_response_id uuid, promoted_employee_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  v_req     public.overtime_requests;
  v_resp    public.overtime_responses;
  v_next    public.overtime_responses;
  v_outcome text := p_outcome;
  v_hours   integer := (select late_cancel_hours from public.overtime_rules where id);
  v_starts  timestamptz;
begin
  if not public.can_manage_overtime(auth.uid()) then
    raise exception 'Only somebody who manages overtime can record an outcome' using errcode = '42501';
  end if;
  if v_outcome not in ('attended', 'no_show', 'called_sick', 'cancelled', 'cancelled_in_time', 'cancelled_late') then
    raise exception 'Unknown outcome %', v_outcome using errcode = 'P0001';
  end if;

  select * into v_resp from public.overtime_responses where id = p_response_id for update;
  if v_resp.id is null then
    raise exception 'No such response' using errcode = 'P0001';
  end if;
  select * into v_req from public.overtime_requests where id = v_resp.request_id for update;

  -- "cancelled": in time or late, by the rule. With the rule off, in time.
  if v_outcome = 'cancelled' then
    v_starts := (v_req.on_date + v_req.starts_at)::timestamptz;
    v_outcome := case when v_hours > 0 and now() > v_starts - make_interval(hours => v_hours)
                      then 'cancelled_late' else 'cancelled_in_time' end;
  end if;

  insert into public.overtime_outcomes (response_id, outcome, note, recorded_by, recorded_at)
  values (p_response_id, v_outcome, p_note, auth.uid(), now())
  on conflict (response_id) do update
    set outcome = excluded.outcome, note = excluded.note,
        recorded_by = excluded.recorded_by, recorded_at = excluded.recorded_at;

  if v_resp.decision = 'accepted'
     and v_outcome <> 'attended'
     and v_req.status = 'open'
  then
    select * into v_next
      from public.overtime_responses r
     where r.request_id = v_req.id
       and r.decision = 'reserve'
       and r.answer = 'yes'
       and not exists (select 1 from public.overtime_outcomes o where o.response_id = r.id)
     order by r.answered_at
     limit 1
     for update skip locked;

    if v_next.id is not null then
      update public.overtime_responses
         set decision = 'accepted', decided_at = now(), decided_by = auth.uid()
       where id = v_next.id;
      return query select v_next.id, v_next.employee_id;
      return;
    end if;
  end if;

  return;
end;
$$;

-- ---------------------------------------------------------------------------
-- The manager's list shows the block beside the name.
-- ---------------------------------------------------------------------------
drop function if exists public.overtime_reliability(date);
create function public.overtime_reliability(p_month date default current_date)
returns table (
  employee_id        uuid,
  sick_this_month    integer,
  absent_this_month  integer,
  ot_accepted_60d    integer,
  ot_attended_60d    integer,
  blocked_until      date
)
language sql stable security definer set search_path = public
as $$
  with bounds as (
    select date_trunc('month', p_month)::date                       as m_from,
           (date_trunc('month', p_month) + interval '1 month')::date as m_to,
           (current_date - 60)                                        as d60
  ),
  board as (
    select a.employee_id,
           count(*) filter (where a.status = 'sick')                       as sick,
           count(*) filter (where a.status in ('unpaid', 'absent', 'awol')) as absent
      from public.employee_attendance a, bounds b
     where a.on_date >= b.m_from and a.on_date < b.m_to
     group by a.employee_id
  ),
  clocks as (
    select d.employee_id,
           count(*) filter (where d.absence_name ~* 'sick')                                 as sick,
           count(*) filter (where d.absence_name is not null
                              and d.absence_name !~* 'sick'
                              and d.absence_name !~* 'holiday|vacation|annual')               as absent
      from public.attendance_days d, bounds b
     where d.on_date >= b.m_from and d.on_date < b.m_to
     group by d.employee_id
  ),
  ot_month as (
    select r.employee_id,
           count(*) filter (where o.outcome = 'called_sick')                          as sick,
           count(*) filter (where o.outcome in ('no_show', 'cancelled_late'))          as absent
      from public.overtime_outcomes o
      join public.overtime_responses r on r.id = o.response_id
      join public.overtime_requests q on q.id = r.request_id, bounds b
     where q.on_date >= b.m_from and q.on_date < b.m_to
     group by r.employee_id
  ),
  ot_60 as (
    select r.employee_id,
           count(*)                                            as accepted,
           count(*) filter (where o.outcome = 'attended')      as attended
      from public.overtime_responses r
      join public.overtime_requests q on q.id = r.request_id
      left join public.overtime_outcomes o on o.response_id = r.id, bounds b
     where r.decision = 'accepted' and q.on_date >= b.d60 and q.on_date <= current_date
     group by r.employee_id
  ),
  ids as (
    select employee_id from board
    union select employee_id from clocks
    union select employee_id from ot_month
    union select employee_id from ot_60
  )
  select i.employee_id,
         coalesce(b.sick, 0) + coalesce(c.sick, 0) + coalesce(m.sick, 0),
         coalesce(b.absent, 0) + coalesce(c.absent, 0) + coalesce(m.absent, 0),
         coalesce(s.accepted, 0),
         coalesce(s.attended, 0),
         (select blocked_until from public.overtime_block_for(i.employee_id))
    from ids i
    left join board    b on b.employee_id = i.employee_id
    left join clocks   c on c.employee_id = i.employee_id
    left join ot_month m on m.employee_id = i.employee_id
    left join ot_60    s on s.employee_id = i.employee_id;
$$;
grant execute on function public.overtime_reliability(date) to authenticated;

-- ================================================================
-- BLOCO 76
-- 20261007090000_an_ask_checks_who_is_answering.sql
-- ================================================================

-- The eligibility rule had one reader, and it was the screen.
--
-- `requestIsForEmployee` in src/lib/overtimeRequests.ts narrows what a person sees: an
-- ask carrying a department is for that department, an ask carrying a shift group is
-- for that shift group, and a null on the ask means it was not narrowed. It runs in
-- MyOvertimePage and nowhere else.
--
-- Underneath it, `overtime_requests_read` is `using (true)` and `answer_overtime`
-- checked three things: that the login has an employee row, that the answer is yes or
-- no, and that the ask is open. Not the department. Not the shift group. So the rule
-- was a filter on a list rather than a rule — one `rpc('answer_overtime')` from a
-- console put a night packer into a day ask, and the supervisor's screen showed them
-- among the interested with nothing to say they should not be there.
--
-- The same two narrowings, in the same direction, now run where the row is written.
-- Null on the ask still means "not narrowed", and a person with no department set is
-- still not quietly included in one they were never put in — that asymmetry is the
-- screen's rule too, and it is deliberate: the ask reaches everybody only when nobody
-- said who it was for.
--
-- The read policy stays `using (true)` on purpose, and that is not an oversight. A
-- supervisor has to read every ask to run the board, and narrowing the select would
-- have to carve them out with `can_manage_overtime` — a second copy of the rule, in a
-- place where getting it wrong hides asks from the people who manage them. Seeing an
-- ask was never the thing that mattered; answering it is, and that is what this closes.
--
-- This replaces the whole function, so it carries the block from
-- 20261006220000_a_rule_the_floor_can_read.sql verbatim. The first draft was written
-- against the version before that one and would have dropped it: a person kept out for
-- a no-show could sign up again the moment this ran. Found by reading
-- pg_get_functiondef in production before applying, not by any test.

create or replace function public.answer_overtime(p_request_id uuid, p_answer text)
returns public.overtime_responses
language plpgsql security definer set search_path = public
as $$
declare
  v_emp     uuid := public.my_employee_id();
  v_req     public.overtime_requests;
  v_dept    text;
  v_shift   text;
  v_row     public.overtime_responses;
  v_block   record;
begin
  if v_emp is null then
    raise exception 'No employee record is linked to this login' using errcode = 'P0001';
  end if;
  if p_answer not in ('yes', 'no') then
    raise exception 'Answer must be yes or no' using errcode = 'P0001';
  end if;

  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null or v_req.status <> 'open' then
    raise exception 'This overtime is no longer open' using errcode = 'P0001';
  end if;

  -- Who the answerer is, as the ask measures them.
  select department, shift_group into v_dept, v_shift
    from public.employees where id = v_emp;

  if v_req.department is not null and v_req.department is distinct from v_dept then
    raise exception 'This overtime is for % and you are not in it', v_req.department
      using errcode = 'P0001';
  end if;
  if v_req.shift_group is not null and v_req.shift_group is distinct from v_shift then
    raise exception 'This overtime is for the % crew', v_req.shift_group
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.overtime_responses
              where request_id = p_request_id and employee_id = v_emp and decision is not null) then
    raise exception 'The supervisor has already decided on your answer' using errcode = 'P0001';
  end if;
  -- A "no" is always allowed: it is information, not a request.
  if p_answer = 'yes' then
    select * into v_block from public.overtime_block_for(v_emp);
    if v_block.blocked_until is not null then
      raise exception 'You can''t sign up for overtime until %. (Missed overtime on %.)',
        to_char(v_block.blocked_until, 'DD/MM'), to_char(v_block.on_date, 'DD/MM')
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.overtime_responses (request_id, employee_id, answer)
  values (p_request_id, v_emp, p_answer)
  on conflict (request_id, employee_id)
  do update set answer = excluded.answer, answered_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

grant execute on function public.answer_overtime(uuid, text) to authenticated;

-- ================================================================
-- BLOCO 77
-- 20261007120000_an_accepted_ask_reaches_the_board.sql
-- ================================================================

-- The board never heard that anybody had been accepted.
--
-- Overtime was offered, answered, decided and marked up, and `daily_allocations` —
-- the thing the factory actually reads at six in the morning — knew none of it. Zero
-- references to the board in the four October migrations, in useOvertimeRequests, in
-- overtimeRequests.ts and in the panel. It was never a stale cache; the wire was not
-- there.
--
-- WHAT GOES ON THE BOARD, AND WHEN. An employee answering yes says only that they are
-- available: `overtime_responses.answer`. A supervisor accepting says they are
-- working: `overtime_responses.decision = 'accepted'`. The board is the second one.
-- It has to be, or it stops being the list of who is in and becomes a list of who
-- offered — and the person reading it at handover cannot tell the difference.
--
-- WHY THIS IS A TRIGGER AND NOT CLIENT CODE. `record_overtime_outcome` promotes the
-- longest-waiting reserve inside the database when an accepted person drops out. A
-- bridge living in the React client would never see that write, so the promoted
-- person would be accepted and invisible — the exact failure this migration exists to
-- end, reintroduced by the fix for it. One rule, one place, and the place is here.
--
-- WHICH BOARD. From the ask's own hours, not from the person's crew: overtime is by
-- definition worked outside the pattern their crew keeps, so their crew cannot say
-- which board the hours belong to. `factory_shift_of` already draws that line at
-- 06:00 and 18:00 Europe/London and is used for quality actions; this reuses it
-- rather than writing the same two numbers down a second place to drift from.
--
-- WHAT IT WILL NEVER TOUCH. A row without this ask's id on it. A planner placing
-- somebody by hand, the sheet import, a day copied from last Tuesday — those are
-- somebody's work, and an ask being cancelled is not a reason to delete it. The
-- insert is `on conflict do nothing`, so when a row is already there the board simply
-- keeps the one it has, unstamped, and the delete below cannot see it. That is the
-- whole protection and it is structural rather than careful.

-- ── 1. The key the board rows carry home ───────────────────────────────────
alter table public.daily_allocations
  add column if not exists overtime_request_id uuid null
    references public.overtime_requests(id) on delete set null;

-- `set null` rather than cascade: a day somebody worked is history, and deleting the
-- ask it came from must not take the record of the shift with it.
create index if not exists daily_allocations_overtime_request_id_idx
  on public.daily_allocations (overtime_request_id)
  where overtime_request_id is not null;

comment on column public.daily_allocations.overtime_request_id is
  'The overtime ask that put this row here, or null for every ordinary allocation. '
  'Only a row carrying an id may be removed by the overtime flow.';

-- ── 2. Which board an ask''s hours belong to ────────────────────────────────
create or replace function public.overtime_board_shift(p_on_date date, p_starts_at time)
returns text
language sql immutable set search_path = public
as $$
  -- initcap because daily_allocations.shift is 'Day'/'Night' and factory_shift_of
  -- answers 'DAY'/'NIGHT'. The rule is the same rule; only the spelling differs.
  select initcap(public.factory_shift_of((p_on_date + p_starts_at) at time zone 'Europe/London'));
$$;

-- ── 3. The one place that writes the board on behalf of an ask ─────────────
create or replace function public.overtime_board_apply(
  p_request_id  uuid,
  p_employee_id uuid,
  p_accepted    boolean
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_req   public.overtime_requests;
  v_shift text;
begin
  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null then return; end if;

  if not p_accepted then
    -- Only ours. A row the planner made for the same person on the same day has no
    -- id on it and is invisible to this.
    delete from public.daily_allocations
     where overtime_request_id = p_request_id
       and employee_id = p_employee_id;
    return;
  end if;

  -- A cancelled ask accepts nobody onto the board, whatever its responses say.
  if v_req.status = 'cancelled' then return; end if;

  v_shift := public.overtime_board_shift(v_req.on_date, v_req.starts_at);

  insert into public.daily_allocations
    (on_date, shift, employee_id, status, area_id, is_leader, overtime_request_id)
  values
    (v_req.on_date, v_shift, p_employee_id, 'overtime', null, false, p_request_id)
  on conflict (on_date, shift, employee_id) do nothing;

  -- The payroll side of the same fact. The board and employee_attendance disagreeing
  -- is how thirteen days marked on the board reached no payroll record at all; eight
  -- of them were never counted. `do nothing` because an existing row is somebody
  -- else's statement about the day — a booked holiday is not this trigger's to
  -- overwrite, and a person who is both booked off and accepted for overtime is a
  -- question for a human.
  insert into public.employee_attendance (employee_id, on_date, status)
  values (p_employee_id, v_req.on_date, 'present')
  on conflict (employee_id, on_date) do nothing;
end;
$$;

-- ── 4. The decision ────────────────────────────────────────────────────────
create or replace function public.overtime_response_to_board()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- `coalesce(..., false)` and not the bare comparison. `decision` is null for every
  -- answer nobody has decided on yet, and `null = 'accepted'` is null, not false — so
  -- `if not p_accepted` inside `overtime_board_apply` was neither true nor false, the
  -- guard was skipped, and execution fell through to the insert. Every employee who
  -- said yes would have landed on the board untouched by a supervisor, and undoing a
  -- decision would have created the allocation instead of removing it.
  perform public.overtime_board_apply(
    new.request_id, new.employee_id, coalesce(new.decision = 'accepted', false));
  return new;
end;
$$;

drop trigger if exists overtime_response_to_board_t on public.overtime_responses;
create trigger overtime_response_to_board_t
  after insert or update of decision on public.overtime_responses
  for each row execute function public.overtime_response_to_board();

-- ── 5. The cancellation ────────────────────────────────────────────────────
create or replace function public.overtime_request_to_board()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- Cancelled only. A closed ask has run its course and the people who were accepted
  -- worked it; taking them off the board afterwards would erase the shift.
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    delete from public.daily_allocations where overtime_request_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists overtime_request_to_board_t on public.overtime_requests;
create trigger overtime_request_to_board_t
  after update of status on public.overtime_requests
  for each row execute function public.overtime_request_to_board();


-- ================================================================
-- BLOCO 78
-- 20261009090000_a_tablet_is_a_place_not_a_person.sql
-- ================================================================

-- A shared tablet made itself into one employee, and everyone else into him.
--
-- `tablet-signin` takes an `account_id`: a whole line signs in as the same auth user,
-- because a tablet is a place. Overtime asks who you are through
-- `my_overtime_identity()`, which reads `employees.user_id = auth.uid()`. The two met
-- on the My Overtime screen, which offers "Pick your name once" to any login with no
-- employee attached — and `link_me_to_employee` had nothing to say about it.
--
-- The first person to use Line 1's tablet picked themselves, and the shared account
-- became Eduardo Luz. From then on the day crew's tablet read "Signed in as Eduardo
-- Luz, Night crew", showing a Night ask already answered and already accepted, and the
-- second person to try got "This login is already linked to an employee". That is why
-- the floor reported that only one employee could ever confirm overtime: he was not
-- the only one who answered, he was the only one who existed.
--
-- The screen has stopped asking (see `isSharedTabletSession`), but a screen declining
-- to offer a mistake is not the same as the mistake being impossible. This is where it
-- becomes impossible.

-- ── 1. Undo the binding that is already there ──────────────────────────────
--
-- `user_id = null` and nothing else: the employee row, the person, their history and
-- every answer they have given stay exactly as they are. What is removed is the claim
-- that a tablet in a corridor is them. Eduardo signs in on his own phone afterwards
-- and links himself properly, like everybody else.
--
-- Scoped by the account table rather than by a name, so it also catches any other line
-- this has quietly happened to.
update public.employees e
   set user_id = null
 where e.user_id in (select o.user_id from public.operator_line_accounts o);

-- ── 2. Refuse to do it again ───────────────────────────────────────────────
--
-- Carried verbatim from 20261006180000 with one clause added. `create or replace`
-- rewrites the whole body, so every existing guard — already linked, already taken,
-- email must match — is reproduced here on purpose rather than assumed to survive.
create or replace function public.link_me_to_employee(p_employee_id uuid)
returns public.employees
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_row   public.employees;
begin
  -- The new one. A shared line account is a place and can never become a person; the
  -- message says where to go instead, because somebody is standing at the tablet
  -- reading it and "not allowed" would leave them there.
  if exists (select 1 from public.operator_line_accounts o where o.user_id = auth.uid()) then
    raise exception 'This is a shared line tablet, not a personal account. Register on your own phone.'
      using errcode = 'P0001';
  end if;

  if public.my_employee_id() is not null then
    raise exception 'This login is already linked to an employee' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = auth.uid();

  update public.employees
     set user_id = auth.uid()
   where id = p_employee_id
     and active
     and user_id is null
     and (email is null or lower(email) = lower(coalesce(v_email, '')))
  returning * into v_row;

  if v_row.id is null then
    raise exception 'That employee cannot be linked to this login' using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

grant execute on function public.link_me_to_employee(uuid) to authenticated;


-- ================================================================
-- BLOCO 79
-- 20261010080000_the_tablets_qr_may_carry_the_code.sql
-- ================================================================

-- The QR people actually scan is the one that could not carry the code.
--
-- `signupQrPayload` takes an invite code and puts it in the link, so the registration
-- form opens with the box already filled. Two screens draw that QR and only one passes
-- a code: the admin's card, which is already holding it on screen. The login screen
-- passes none, because `signup_config` is `REVOKE ALL ... FROM anon` with an
-- admin-only policy and a page served to anybody cannot read the code.
--
-- That is the right rule for the login screen and it must not change. The code is the
-- only gate on self-registration, `self_signup_role` is 'operator' — a new account is
-- an active operator immediately — and `overtime_unlinked_names()` hands any logged-in
-- caller the list of unclaimed names. Publishing the code on a public page would let a
-- stranger register and then pick a real employee out of that list.
--
-- But the screen the floor actually reads is the tablet's, and a tablet is inside the
-- building and signed in. This returns the code to that session and to no other: not
-- to anon, not to an ordinary staff login, not to a tablet when sign-up is switched
-- off or the code has expired. Everywhere else it returns null and the QR carries
-- nothing, exactly as today.
--
-- Same shape as `check_invite_code`, which has answered yes/no about this column to
-- anon since July: security definer over a table nobody else may read, with the whole
-- decision inside it.

create or replace function public.signup_invite_for_tablet()
returns text
language sql stable security definer set search_path = public
as $$
  select c.invite_code
    from public.signup_config c
   where c.id
     and c.enabled
     and c.invite_code is not null
     -- The same expiry `check_invite_code` enforces. A code this hands out that the
     -- validator would then reject is a QR that walks somebody into a refusal.
     and (c.invite_expires_at is null or now() < c.invite_expires_at)
     -- The whole guard: this caller is a shared line tablet.
     and exists (
       select 1 from public.operator_line_accounts o
        where o.user_id = auth.uid()
     );
$$;

revoke all on function public.signup_invite_for_tablet() from public;
-- `authenticated` only, and never `anon`: the guard above is what narrows it to
-- tablets, and an anon caller has no `auth.uid()` to match in the first place.
grant execute on function public.signup_invite_for_tablet() to authenticated;

comment on function public.signup_invite_for_tablet() is
  'The invite code, but only to a signed-in line tablet and only while sign-up is open '
  'and the code unexpired. Null for everybody else. Exists so the tablet QR can open '
  'registration with the code filled in without the code reaching a public page.';

-- ================================================================
-- BLOCO 80
-- 20261010090000_the_office_can_write_the_attendance_its_board_writes.sql
-- ================================================================

-- The office places people on the headcount board, and the board's second write was refused.
--
-- `employee_attendance` was created on 31/07, three days after the office role got its
-- additive "office_admin all" policies, and it only ever had the admin one. Since the
-- board started mirroring each placement into attendance (so the finance close sees the
-- same day the board shows), every placement by a production_office_admin writes
-- `daily_allocations` fine and then fails here:
--
--   new row violates row-level security policy for table "employee_attendance"
--
-- thirteen times on 09/10 between 21:26 and 21:49, all from /dashboard/headcount. The
-- board keeps the placement and payroll never hears about it.
--
-- Same additive policy the office has on the other operational tables: OR'd with the
-- admin one, so no other role changes.

drop policy if exists "office_admin all" on public.employee_attendance;
create policy "office_admin all" on public.employee_attendance
  for all to authenticated
  using (public.has_role(auth.uid(), 'production_office_admin'::app_role))
  with check (public.has_role(auth.uid(), 'production_office_admin'::app_role));


-- ================================================================
-- BLOCO 81
-- 20261010100000_you_say_who_you_are_with_the_number_on_your_badge.sql
-- ================================================================

-- Anybody with an account could become anybody who had not got one yet.
--
-- The floor's registration ends on a screen headed "Who are you?" that lists every
-- active employee nobody has claimed — name and department — and offers a button
-- saying "That's me". `link_me_to_employee` then binds the login to whichever row was
-- picked, and its only identity guard is
--
--     and (email is null or lower(email) = lower(coalesce(v_email, '')))
--
-- which does not bite: almost no row in `employees` carries an email. That is the
-- whole reason the badge door exists. So the check passes vacuously, and the person
-- holding a freshly created account chooses who they are from a dropdown.
--
-- What makes it worse than it sounds is what comes after. A linked account answers
-- overtime as that person, and `self_signup_role` is 'operator', so an account is
-- active the moment it is made. The invite code is the only thing between a stranger
-- and the list.
--
-- THE FIX IS THE MECHANISM THAT ALREADY EXISTS. `employee-signin` has never had this
-- problem: it takes the number on the badge, finds the one row that carries it, and
-- links that. No list, nothing to browse, nothing to choose. This gives the same rule
-- to the other door, so both ends of registration answer identity the same way.

-- ── 1. Enumeration has to cost something ───────────────────────────────────
--
-- A badge number is short, and without this the dropdown is merely replaced by a
-- guessing game with the same prize. Five wrong answers and this login is done
-- guessing; the person goes to a supervisor, which is where somebody who genuinely
-- does not know their own number was always going to end up.
--
-- Keyed by the login, not by the badge: the attacker controls which numbers they try,
-- but making another account costs them another invite code.
create table if not exists public.identity_link_attempts (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  fails      integer not null default 0,
  last_fail  timestamptz
);
alter table public.identity_link_attempts enable row level security;
-- No policy, deliberately: the counter is nobody's business but the function's, and a
-- security definer function reads it regardless of RLS. A caller who could read this
-- would learn how close somebody else is to being locked out.
revoke all on public.identity_link_attempts from anon, authenticated;

comment on table public.identity_link_attempts is
  'Failed attempts to claim an employee row by badge number, per login. Five and the '
  'login must go to a supervisor. Not readable by anybody; see link_me_by_employee_ref.';

-- ── 2. The badge says who you are ──────────────────────────────────────────
create or replace function public.link_me_by_employee_ref(p_ref text)
returns public.employees
language plpgsql security definer set search_path = public
as $$
declare
  v_ref   text := upper(trim(coalesce(p_ref, '')));
  v_fails   integer;
  v_matches integer;
  v_row   public.employees;
begin
  -- Sem sessão não se liga nada.
  --
  -- O `grant` só dá isto ao papel `authenticated`, por isso o anon nunca chega cá. Mas
  -- a linha fica: sem esta guarda, um `auth.uid()` nulo passa as três verificações
  -- seguintes, escreve `user_id = null` sobre uma linha que já o tinha, e DEVOLVE a
  -- ficha do funcionário a quem a pediu. Um grant acrescentado por distracção numa
  -- migração futura transformava um erro de permissões numa fuga de dados, e esta
  -- base já teve exactamente essa espécie de acidente.
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'P0001';
  end if;

  if v_ref = '' then
    raise exception 'Enter the number on your badge' using errcode = 'P0001';
  end if;

  -- A tablet is a place, not a person — the same refusal `link_me_to_employee` gained,
  -- repeated here because this is a second door into the same room.
  if exists (select 1 from public.operator_line_accounts o where o.user_id = auth.uid()) then
    raise exception 'This is a shared line tablet, not a personal account. Register on your own phone.'
      using errcode = 'P0001';
  end if;

  if public.my_employee_id() is not null then
    raise exception 'This login is already linked to an employee' using errcode = 'P0001';
  end if;

  -- Counted over a day, not for ever. Without the window this is a permanent lockout
  -- with no way out: the message sends people to a supervisor, and there is no screen
  -- where a supervisor can link an account or clear a counter. Telling somebody to do
  -- something nobody can do is worse than making them wait until tomorrow.
  select fails into v_fails
    from public.identity_link_attempts
   where user_id = auth.uid()
     and last_fail > now() - interval '24 hours';
  if coalesce(v_fails, 0) >= 5 then
    raise exception 'Too many wrong tries. Try again tomorrow, or ask your supervisor.'
      using errcode = 'P0001';
  end if;

  -- Resolved to ONE row before anything is written.
  --
  -- The first draft updated by the badge number directly, and `update ... returning *
  -- into v_row` does not complain when the WHERE matches more than one row: it writes
  -- to all of them and hands back the first. Two active unclaimed rows whose numbers
  -- differ only by case or a stray space — and normalising with upper(trim(...)) is
  -- exactly what makes those two equal here — would both have been linked to this one
  -- login. That is the failure this function exists to prevent, introduced by the
  -- function itself.
  --
  -- `into strict` raises on 0 or 2+ rather than guessing, and the count is taken
  -- before the write so nothing is half-done when it is wrong.
  select count(*) into v_matches
    from public.employees
   where upper(trim(employee_ref)) = v_ref and active and user_id is null;

  if v_matches = 1 then
    update public.employees
       set user_id = auth.uid()
     where upper(trim(employee_ref)) = v_ref
       and active
       and user_id is null
    returning * into v_row;
  elsif v_matches > 1 then
    -- Two people cannot both be you. Nobody is linked, and this needs a human.
    raise exception 'That badge number matches more than one record. Ask your supervisor.'
      using errcode = 'P0001';
  end if;

  if v_row.id is null then
    insert into public.identity_link_attempts (user_id, fails, last_fail)
    values (auth.uid(), 1, now())
    on conflict (user_id) do update
      -- A janela de 24 horas tem de valer na ESCRITA e não só na leitura.
      --
      -- Somando sempre, o contador nunca recomeçava: quem falhasse cinco vezes numa
      -- segunda-feira voltava na quarta, passava a porta (o `last_fail` já estava
      -- fora da janela), falhava uma vez — e a soma punha 6, com `last_fail` outra
      -- vez dentro da janela. A partir daí tinha UMA tentativa por dia em vez de
      -- cinco, para sempre, e nenhum ecrã onde alguém limpasse aquilo.
      set fails = case
            when public.identity_link_attempts.last_fail > now() - interval '24 hours'
              then public.identity_link_attempts.fails + 1
            else 1
          end,
          last_fail = now();
    -- One message for every miss. Saying "no such badge" and "already taken"
    -- separately would turn this into a tool for finding out who has registered.
    raise exception 'That badge number is not available. Check it, or ask your supervisor.'
      using errcode = 'P0001';
  end if;

  delete from public.identity_link_attempts where user_id = auth.uid();
  return v_row;
end;
$$;

revoke all on function public.link_me_by_employee_ref(text) from public;
grant execute on function public.link_me_by_employee_ref(text) to authenticated;

-- ── 3. Close the old door, not just the signpost to it ─────────────────────
--
-- Changing the screen is not enough while the functions behind it stay callable. Both
-- halves of the old flow have to go, and the first draft of this migration took only
-- the first — which would have left the hole open to anyone willing to call the RPC
-- directly instead of using the screen.
--
-- The list: the roster of unclaimed people, name and department, one `rpc()` away for
-- anybody with a login. Granted so a new login could find itself; nobody finds
-- themselves that way any more.
revoke execute on function public.overtime_unlinked_names() from authenticated;

-- The door itself: `link_me_to_employee` takes an employee **id** and links this login
-- to it, with no check that the id is yours. Without the list it is less convenient,
-- not less possible — `overtime_roster()` is granted to the same callers and carries
-- ids. Revoked, so the only way in is the badge.
--
-- `employee-signin` is unaffected: it runs with the service role, which grants do not
-- gate. Admins are unaffected for the same reason wherever they act through one.
revoke execute on function public.link_me_to_employee(uuid) from authenticated;

comment on function public.link_me_by_employee_ref(text) is
  'Link this login to the employee whose badge number this is, if that row is active '
  'and unclaimed. One identity, no list, five misses and the login is locked out of '
  'trying. Replaces picking a name from overtime_unlinked_names().';


-- ================================================================
-- BLOCO 82
-- 20261011090000_the_public_was_never_invited.sql
-- ================================================================

-- Two hundred and seven people's names, read without logging in.
--
-- Postgres grants EXECUTE on a new function to PUBLIC. Nothing in 20261006180000
-- takes that away: it ends with eight lines of
--
--     grant execute on function public.<name> to authenticated;
--
-- and a grant does not narrow what PUBLIC already holds. `check_invite_code` in
-- 20260723140000 gets this right — `REVOKE ALL ... FROM public` first, then the grant
-- — and these eight were written without it.
--
-- Measured against production on 11/10/2026 with the publishable key, which is in the
-- JavaScript every visitor downloads, and no session at all:
--
--     POST /rest/v1/rpc/overtime_unlinked_names   200   207 rows
--                                                       id, full_name, department, shift_group
--     POST /rest/v1/rpc/overtime_reliability      200   rows per employee, attendance among them
--     POST /rest/v1/rpc/overtime_roster           200   []
--     POST /rest/v1/rpc/my_employee_id            200   null
--
-- The last two are empty only because they read `auth.uid()`, which anonymous callers
-- do not have. That is luck, not a boundary: `overtime_reliability` takes a date and
-- answers for everybody, and it answered.
--
-- These functions are all SECURITY DEFINER, so the grant IS the boundary. There is no
-- RLS underneath to catch this — that is the point of definer rights, and the reason
-- the revoke is not optional.
--
-- NOT a fix for who among the signed-in may call them: 20261010100000 narrows
-- `overtime_unlinked_names` and `link_me_to_employee` away from `authenticated`, and
-- that stands. This closes the other door, which that migration left untouched —
-- revoking from `authenticated` while PUBLIC still holds EXECUTE changes nothing at
-- all, and both were written by the same hand on the same day.
--
-- Idempotent, and safe to run before or after 20261010100000.

revoke all on function public.answer_overtime(uuid, text)      from public;
revoke all on function public.link_me_to_employee(uuid)        from public;
revoke all on function public.overtime_reliability(date)       from public;
revoke all on function public.can_manage_overtime(uuid)        from public;
revoke all on function public.my_employee_id()                 from public;
revoke all on function public.overtime_roster()                from public;
revoke all on function public.my_overtime_identity()           from public;
revoke all on function public.overtime_unlinked_names()        from public;

-- Put back exactly what 20261006180000 meant to give, since REVOKE ... FROM public
-- also takes it from every role that only had it through PUBLIC. Named one by one so
-- this file says, on its own, who may call what.
--
-- `overtime_unlinked_names` and `link_me_to_employee` are deliberately absent: they
-- are revoked from `authenticated` by 20261010100000, and re-granting them here would
-- undo that migration from behind. If that one has not run yet, the screen that needs
-- them is the old "pick your name" one, which is the hole it exists to close.
grant execute on function public.answer_overtime(uuid, text)   to authenticated;
grant execute on function public.overtime_reliability(date)    to authenticated;
grant execute on function public.can_manage_overtime(uuid)     to authenticated;
grant execute on function public.my_employee_id()              to authenticated;
grant execute on function public.overtime_roster()             to authenticated;
grant execute on function public.my_overtime_identity()        to authenticated;

-- The two the floor's push needs, and the two the sign-up page calls before anybody
-- has a session. Listed here so the next person does not have to guess which of these
-- being anonymous is deliberate: these four are, the eight above were not.
revoke all on function public.overtime_push_targets(uuid, uuid[]) from public;
grant execute on function public.overtime_push_targets(uuid, uuid[]) to authenticated;


-- ================================================================
-- BLOCO 83
-- 20261011120000_an_employee_is_here_for_overtime.sql
-- ================================================================

-- An employee is here for overtime.
--
-- The invite link and the badge have been making `operator` accounts, because operator
-- was the narrowest role there was. It is not narrow: it logs production, raises
-- maintenance calls and sees line targets. Two hundred people whose only business in
-- the app is "yes, I'll do Saturday" were being handed all of that.
--
-- `employee` holds one action in src/lib/permissions.ts, `overtime.respond`, and lands
-- on /dashboard/my-overtime. No RLS policy needs it: everything My Overtime reads or
-- writes is open to `authenticated` and narrowed by `my_employee_id()`, not by role
-- (20261006180000), and every admin/manager/office policy stays as it is.
--
-- ALONE, ON PURPOSE. Postgres refuses to use an enum value in the same transaction
-- that adds it ("unsafe use of new value"), and the SQL editor runs a paste as one
-- transaction. 20261011120100 uses the value and must be run after this one, in a
-- separate run.
--
-- Idempotent.

alter type public.app_role add value if not exists 'employee';


-- ================================================================
-- BLOCO 84
-- 20261011120100_the_invite_link_makes_an_employee.sql
-- ================================================================

-- The invite link makes an employee.
--
-- Needs 20261011120000 to have been run first, in a run of its own: this file uses
-- the value that one adds.
--
-- `self_signup_role` was set to 'operator' because that was the narrowest role on
-- offer. Now there is one made for it. Only an 'operator' setting is moved: null (the
-- approval queue) is an admin's deliberate choice and stays. The badge door
-- (`employee-signin`) hard-codes its role and changes in the same commit; it needs a
-- redeploy from Lovable to take effect.
--
-- Accounts that already exist keep the role they have. Turning existing operators
-- into employees takes production logging away from people who may be using it, and
-- that is a decision for Users, one person at a time, not for a migration.
--
-- Idempotent.

update public.signup_config
   set self_signup_role = 'employee'
 where self_signup_role = 'operator';


-- ================================================================
-- BLOCO 85
-- 20261011220000_a_generated_column_only_follows.sql
-- ================================================================
--
-- CORRIGE UM APPROVE QUE FALHA. Cole este sozinho se so quiser isso: nao
-- depende de nenhum dos blocos acima e e idempotente.
--

-- A coluna que só segue, e a função que tentava escrevê-la.
--
-- O `admin_update_auth_email` existe desde 12/07/2026 e até 11/10/2026 não tinha um
-- único chamador — nem no `src/`, nem numa edge function, nem num trigger. Uma função
-- que ninguém chama nunca falha, por isso ninguém soube que ela estava partida.
--
-- No fim do corpo ela faz:
--
--     update auth.identities
--        set identity_data = ... , email = normalized, ...
--
-- e o `auth.identities.email` é, no GoTrue de hoje, uma coluna GERADA a partir de
-- `identity_data->>'email'`. O Postgres recusa a instrução inteira com
--
--     column "email" can only be updated to DEFAULT        (SQLSTATE 428C9)
--
-- Como o `update auth.users` que confirma o endereço vem ANTES, e tudo isto corre numa
-- transacção, a recusa desfaz também essa confirmação. O efeito visível era um Approve
-- que falhava por completo e uma pessoa que continuava sem conseguir entrar.
--
-- O QUE ESTA MIGRAÇÃO FAZ, E PORQUE NÃO SE LIMITA A APAGAR A LINHA. Não consegui ler o
-- `attgenerated` desta base a partir de onde trabalho — o esquema `auth` não é servido
-- pelo PostgREST. Apagar a linha é certo num esquema onde a coluna é gerada e deixa-a
-- desactualizada num esquema antigo onde ela seja uma coluna normal. Por isso a coluna
-- é escrita apenas quando for escrevível, e a pergunta é feita ao catálogo em vez de
-- ser adivinhada. O `execute` é o que importa: uma instrução estática seria planeada
-- mesmo no ramo que não corre, e voltava a rebentar.
--
-- O `identity_data` é actualizado nos dois casos, que é o que o GoTrue lê.

create or replace function public.admin_update_auth_email(_user_id uuid, _new_email text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized text := lower(trim(_new_email));
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')) then
    raise exception 'Only admins or managers may update operator emails';
  end if;

  if exists (select 1 from auth.users where lower(email) = normalized and id <> _user_id) then
    raise exception 'This email is already in use by another login';
  end if;

  update auth.users
  set email = normalized,
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('email', normalized),
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      confirmation_token = coalesce(confirmation_token, ''),
      email_change = '',
      email_change_token_new = '',
      email_change_token_current = '',
      recovery_token = coalesce(recovery_token, ''),
      reauthentication_token = coalesce(reauthentication_token, ''),
      updated_at = now()
  where id = _user_id;

  if not found then
    raise exception 'Auth user not found';
  end if;

  -- O que o GoTrue lê. A coluna gerada segue isto sozinha.
  update auth.identities
  set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', normalized),
      updated_at = now()
  where user_id = _user_id and provider = 'email';

  -- E só se a coluna for mesmo escrevível. `attgenerated = ''` quer dizer coluna
  -- normal; numa coluna gerada vale 's' e este ramo não corre.
  if exists (
    select 1 from pg_attribute
     where attrelid = 'auth.identities'::regclass
       and attname = 'email'
       and attgenerated = ''
       and not attisdropped
  ) then
    execute 'update auth.identities set email = $1 where user_id = $2 and provider = ''email'''
      using normalized, _user_id;
  end if;
end;
$$;

-- Os mesmos acessos de 20260726240000, reafirmados para o estado final não depender de
-- o CREATE OR REPLACE preservar ACLs.
revoke execute on function public.admin_update_auth_email(uuid, text) from public;
revoke execute on function public.admin_update_auth_email(uuid, text) from anon;
grant  execute on function public.admin_update_auth_email(uuid, text) to authenticated;


-- ================================================================
-- BLOCO 86
-- 20261011230000_the_invite_code_rides_the_link.sql
-- ================================================================
--
-- O botao "Create account" passa a levar o codigo. LEIA O CABECALHO: o codigo
-- deixa de ser segredo de proposito. O que trava o registo passa a ser o
-- interruptor "Allow new users to register" e o "New accounts start as".
--

-- O código de convite passa a viajar no link.
--
-- DECISÃO DELIBERADA, TOMADA A 11/10/2026, com a consequência dita em voz alta: a
-- partir daqui o código deixa de ser um segredo. Qualquer pessoa que abra o ecrã de
-- entrada pode lê-lo, porque é de lá que o botão "Create account" o vai buscar. Quem
-- quiser registar-se consegue.
--
-- Porque é que isso é aceitável aqui: o código nunca foi a fechadura. Era um papel
-- afixado ao pé do relógio de ponto, numa fábrica onde já se entra com crachá. Custava
-- uma chamada ao supervisor às seis da manhã e não impedia ninguém que lá estivesse.
--
-- AS DUAS FECHADURAS A SÉRIO FICAM, e são estas:
--
--   signup_config.enabled           desligado, esta função devolve null e não há registo
--   signup_config.invite_expires_at passado, idem
--   signup_config.self_signup_role  null  -> a conta nasce SEM papel e sem acesso,
--                                            à espera de um admin
--                                   'employee' -> nasce activa, só com My Overtime
--
-- Quem puser `self_signup_role` em 'employee' está a decidir que qualquer pessoa que
-- abra o site fica com uma conta activa. É uma escolha legítima numa rede de fábrica e
-- não é uma escolha que esta migração faça por ninguém.
--
-- SUBSTITUI o `signup_invite_for_tablet` (20261010080000), que dava o código só a uma
-- sessão de conta de linha. Essa restrição deixa de fazer sentido quando o ecrã público
-- passa a mostrá-lo, e uma função `security definer` sem chamadores é precisamente o
-- que esteve partido em silêncio durante três meses nesta base — por isso é removida em
-- vez de ficar.

create or replace function public.signup_invite_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select c.invite_code
    from public.signup_config c
   where c.id = true
     and c.enabled
     and coalesce(c.invite_code, '') <> ''
     and (c.invite_expires_at is null or c.invite_expires_at > now())
$$;

comment on function public.signup_invite_code() is
  'O codigo de convite em vigor, ou null se o registo estiver fechado ou o codigo '
  'expirado. E legivel por anon de proposito: o ecra de entrada poe-no no link do '
  '"Create account". Ver 20261011230000 para a decisao e para o que continua a travar.';

revoke all on function public.signup_invite_code() from public;
grant execute on function public.signup_invite_code() to anon, authenticated;

-- A versão anterior, que ninguém passa a chamar.
drop function if exists public.signup_invite_for_tablet();

-- ================================================================
-- BLOCO 87
-- 20261012080000_an_answer_remembers_the_shift_it_was_given_to.sql
-- ================================================================
--
-- PERMITE CORRIGIR A DATA E AS HORAS DE UM PEDIDO JA FEITO sem apagar os sins.
-- Independente dos blocos acima e idempotente: pode ser colado sozinho.
--

-- Uma resposta passa a lembrar-se do turno a que foi dada.
--
-- As horas de um pedido são escritas à mão em dois campos `type="time"`. Não há conta
-- nenhuma a derivá-las, por isso um engano fica lá: a 13/10/2026 havia um pedido para
-- as 18:00-14:00 -- vinte horas -- onde era 18:00-06:00. Corrigi-lo obrigava a cancelar
-- o pedido e a recomeçar, e com ele iam embora os sins verdadeiros.
--
-- A partir daqui corrigir é permitido e NAO apaga respostas. Quem ja tinha respondido
-- fica assinalado, para o supervisor saber a quem tem de ligar. Para isso a resposta
-- tem de saber a que turno foi dada, porque o pedido ja nao sabe -- foi ele que mudou.
--
-- TRES COLUNAS E NAO UMA FRASE. Guardar "13/10 18:00-06:00" como texto obrigava a base
-- e o ecra a escrever a hora da mesma maneira para sempre; na primeira vez que um
-- devolvesse 06:00:00 e o outro 06:00, TODA a gente aparecia como tendo respondido a
-- outro turno e o aviso deixava de querer dizer alguma coisa. Comparar campo a campo
-- nao tem esse problema.
--
-- As respostas que ja existem ficam com null, e null quer dizer "nao se sabe", nao
-- "igual". O ecra nao assinala nada nesse caso -- ver `answeredForDifferentHours`.
-- Nao e feito backfill: inventar que uma resposta antiga foi dada ao turno actual era
-- afirmar precisamente aquilo que estas colunas existem para nao ter de adivinhar.

alter table public.overtime_responses
  add column if not exists answered_for_date       date,
  add column if not exists answered_for_starts_at  time,
  add column if not exists answered_for_ends_at    time;

comment on column public.overtime_responses.answered_for_date is
  'O turno que a pessoa tinha a frente quando respondeu. Null nas respostas anteriores '
  'a 20261012080000, e null quer dizer "nao se sabe". Ver staleOvertimeAnswer.ts.';

-- O `answer_overtime` ja tem a linha do pedido carregada em v_req, por isso isto e so
-- dizer-lhe que a guarde. O resto da funcao fica como estava em 20261007090000.
create or replace function public.answer_overtime(p_request_id uuid, p_answer text)
returns public.overtime_responses
language plpgsql security definer set search_path = public
as $$
declare
  v_emp     uuid := public.my_employee_id();
  v_req     public.overtime_requests;
  v_dept    text;
  v_shift   text;
  v_row     public.overtime_responses;
  v_block   record;
begin
  if v_emp is null then
    raise exception 'No employee record is linked to this login' using errcode = 'P0001';
  end if;
  if p_answer not in ('yes', 'no') then
    raise exception 'Answer must be yes or no' using errcode = 'P0001';
  end if;

  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null or v_req.status <> 'open' then
    raise exception 'This overtime is no longer open' using errcode = 'P0001';
  end if;

  -- Who the answerer is, as the ask measures them.
  select department, shift_group into v_dept, v_shift
    from public.employees where id = v_emp;

  if v_req.department is not null and v_req.department is distinct from v_dept then
    raise exception 'This overtime is for % and you are not in it', v_req.department
      using errcode = 'P0001';
  end if;
  if v_req.shift_group is not null and v_req.shift_group is distinct from v_shift then
    raise exception 'This overtime is for the % crew', v_req.shift_group
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.overtime_responses
              where request_id = p_request_id and employee_id = v_emp and decision is not null) then
    raise exception 'The supervisor has already decided on your answer' using errcode = 'P0001';
  end if;
  -- A "no" is always allowed: it is information, not a request.
  if p_answer = 'yes' then
    select * into v_block from public.overtime_block_for(v_emp);
    if v_block.blocked_until is not null then
      raise exception 'You can''t sign up for overtime until %. (Missed overtime on %.)',
        to_char(v_block.blocked_until, 'DD/MM'), to_char(v_block.on_date, 'DD/MM')
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.overtime_responses (
    request_id, employee_id, answer,
    answered_for_date, answered_for_starts_at, answered_for_ends_at)
  values (
    p_request_id, v_emp, p_answer,
    v_req.on_date, v_req.starts_at, v_req.ends_at)
  on conflict (request_id, employee_id)
  do update set answer    = excluded.answer,
                answered_at = now(),
                -- Mudar de ideias e responder ao turno de AGORA, por isso o
                -- instantaneo anda com a resposta e nao fica no primeiro valor.
                answered_for_date      = excluded.answered_for_date,
                answered_for_starts_at = excluded.answered_for_starts_at,
                answered_for_ends_at   = excluded.answered_for_ends_at
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.answer_overtime(uuid, text) from public;
grant execute on function public.answer_overtime(uuid, text) to authenticated;


-- ================================================================
-- BLOCO 88
-- 20261012140000_the_email_you_signed_in_with_says_who_you_are.sql
-- ================================================================
--
-- LIGA A CONTA SOZINHA quando o email da sessao esta na ficha. Independente
-- e idempotente; pode ser colado sozinho.
--

-- O email com que entraste diz quem tu és.
--
-- Hoje um funcionário que acaba de criar conta tem de escrever o número do crachá.
-- Muitos não o sabem de cor, 51 fichas não têm número nenhum, e a mensagem manda
-- falar com um supervisor que até agora não tinha onde carregar.
--
-- A ficha do funcionário já tem `email`. Quando esse email é o MESMO com que a pessoa
-- iniciou sessão, não há nada a adivinhar: o GoTrue já verificou que ela controla
-- aquela caixa de correio, e é por isso que esta função não aceita um email como
-- argumento. Aceitar um transformava isto em "escreve o email do teu colega e ficas
-- com a ficha dele". Sem argumento, a única forma de reclamar uma ficha é ter entrado
-- com o email que está nela.
--
-- EXACTAMENTE UMA LINHA, ou nada. Dois funcionários com o mesmo email na ficha é um
-- erro de dados que ninguém deve resolver por sorteio, e a função recusa-se a
-- escolher — a pessoa cai no crachá, como antes.
--
-- NÃO MEXE NO CONTADOR DE TENTATIVAS. O `link_me_by_employee_ref` conta as falhas
-- porque ali a pessoa está a adivinhar um número. Aqui não escreveu nada: isto corre
-- sozinho quando a página abre. Gastar-lhe uma das cinco tentativas por uma coisa que
-- ela não fez era tirar-lhe o recurso de que vai precisar a seguir.

create or replace function public.link_me_by_email()
returns public.employees
language plpgsql security definer set search_path = public
as $$
declare
  v_email   text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_matches integer;
  v_row     public.employees;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'P0001';
  end if;

  -- Um tablet é um sítio, não uma pessoa. A mesma recusa das outras duas portas: um
  -- turno inteiro entra nesta conta, e ligá-la a alguém faz de toda a gente essa
  -- pessoa. Ver 20261009090000.
  if exists (select 1 from public.operator_line_accounts o where o.user_id = auth.uid()) then
    raise exception 'This is a shared line tablet, not a personal account.'
      using errcode = 'P0001';
  end if;

  if public.my_employee_id() is not null then
    raise exception 'This login is already linked to an employee' using errcode = 'P0001';
  end if;

  -- Contas de crachá vivem em `@employee.pmsystem.local`, um domínio onde ninguém
  -- recebe nada e que ninguém escolheu. Não é prova de identidade de pessoa nenhuma.
  if v_email = '' or v_email like '%@employee.pmsystem.local' then
    raise exception 'No work email on this login' using errcode = 'P0001';
  end if;

  select count(*) into v_matches
    from public.employees
   where lower(trim(email)) = v_email and active and user_id is null;

  if v_matches <> 1 then
    -- Zero: o email não está em ficha nenhuma, ou a ficha já foi reclamada.
    -- Dois ou mais: erro de dados, e ninguém escolhe por sorteio.
    raise exception 'No single employee record matches this email' using errcode = 'P0001';
  end if;

  update public.employees
     set user_id = auth.uid()
   where lower(trim(email)) = v_email
     and active
     and user_id is null
  returning * into v_row;

  if v_row.id is null then
    -- Outra sessão chegou primeiro entre a contagem e a escrita.
    raise exception 'No single employee record matches this email' using errcode = 'P0001';
  end if;

  -- A tentativa falhada do crachá, se a houve, deixa de interessar: a pessoa está
  -- ligada e o contador não serve para mais nada.
  delete from public.identity_link_attempts where user_id = auth.uid();
  return v_row;
end;
$$;

revoke all on function public.link_me_by_email() from public;
grant execute on function public.link_me_by_email() to authenticated;

comment on function public.link_me_by_email() is
  'Liga este login ao funcionario cujo email e o da SESSAO, se houver exactamente uma '
  'ficha activa e por reclamar com esse email. Nao aceita argumento de proposito: '
  'quem nao controla a caixa de correio nao reclama a ficha. Ver 20261012140000.';


-- ================================================================
-- BLOCO 89
-- 20261012150000_timemoto_is_where_the_number_comes_from.sql
-- ================================================================
--
-- SO O ESQUEMA. As colunas ficam vazias ate haver importacao do TimeMoto.
--

-- O TimeMoto passa a ser de onde vem o número.
--
-- Decidido a 12/10/2026: o relógio já é o sistema onde toda a gente desta fábrica tem
-- um identificador estável, e este tinha os seus — 51 fichas sem `employee_ref`
-- nenhum, nomes escritos de maneiras diferentes em três sítios, e uma lista de
-- `sheet_aliases` curada à mão porque emparelhar por nome nunca funcionou.
--
-- Isto é só o esquema. A IMPORTAÇÃO é um passo à parte e precisa do export do
-- TimeMoto; sem ele estas colunas ficam vazias e nada muda, que é o estado correcto
-- para uma coluna que ainda não tem dados.
--
-- DEPOIS DE IMPORTAR, e só então, as fichas sem número herdam o do relógio:
--
--     update public.employees
--        set employee_ref = timemoto_user_id
--      where employee_ref is null and timemoto_user_id is not null;
--
-- Não está aqui de propósito. Posta nesta migração corria uma vez, a zero linhas,
-- antes de os dados existirem — e depois nunca mais. Pertence ao passo da importação.
--
-- Levanta a instrução de 2026 de não preencher as 51 fichas sem `employee_ref`, que
-- foi levantada explicitamente ao tomar esta decisão. Quem já tem número MANTÉM o
-- seu: a linha acima só toca no que está vazio.

alter table public.employees
  add column if not exists timemoto_user_id  text,
  add column if not exists timemoto_username text;

-- Dois funcionários com o mesmo id de relógio é um erro de importação, e é melhor que
-- a importação falhe do que fique silenciosamente a apontar duas fichas ao mesmo
-- picar. Parcial, porque vazio é o estado normal enquanto não houver export.
create unique index if not exists employees_timemoto_user_id_key
  on public.employees (timemoto_user_id)
  where timemoto_user_id is not null;

comment on column public.employees.timemoto_user_id is
  'O identificador desta pessoa no TimeMoto. E a fonte do numero: as fichas sem '
  'employee_ref herdam-no na importacao. Ver 20261012150000.';
comment on column public.employees.timemoto_username is
  'O nome de utilizador no TimeMoto, para a importacao poder ser conferida por um '
  'humano sem abrir os dois sistemas lado a lado.';

-- ================================================================
-- BLOCO 90
-- 20261012160000_an_employee_sees_only_their_own.sql
-- ================================================================
--
-- UM EMPREGADO VE SO O QUE E SEU: tecto no has_action para o papel employee, os
-- numeros de fiabilidade so para quem gere horas extra, respostas e resultados de
-- horas extra so do proprio, e a funcao my_attendance para o ecra My Attendance.
-- Independente dos blocos acima e idempotente: pode ser colado sozinho.
-- Depois, correr supabase/tests/an_employee_sees_only_their_own_test.sql.
--

-- An employee sees their own records, and nobody else's.
--
-- The `employee` login is the one a badge or the invite link hands out: the whole floor,
-- on their own phones. Four things let that login read past itself, and this closes all
-- four. Nothing here changes what admin, manager or the office admin can read.
--
-- 1. `has_action` honoured any Permissions-screen grant for any role. One tick of
--    `workforce.view` for the employee role would have opened `employees`, the leave
--    screens and the finance close to every badge login, in the database as well as
--    the menu. The employee role now has a CEILING: outside `overtime.respond` and
--    `attendance.view_own` a grant to it does nothing. Mirrors EMPLOYEE_CEILING in
--    src/lib/permissions.ts.
--
-- 2. `overtime_reliability()` is SECURITY DEFINER with no check on who asks. Any
--    signed-in login got every person's sick and absent count for the month — health
--    data, one row per employee. It now answers only to whoever runs overtime.
--
-- 3. `overtime_responses` and `overtime_outcomes` were readable by every signed-in login
--    (`using (true)`, decided 06/10: "the floor already knows who put their hand up").
--    Reversed on 12/10 at the owner's request: every yes, no, no-show and called-sick
--    reached every employee's device, and My Overtime only ever used the caller's own.
--    A person now reads their own rows; whoever runs overtime reads all of them.
--    Every function that reads these tables for somebody else is SECURITY DEFINER
--    (answer_overtime, record_overtime_outcome, overtime_block_for, the board bridge),
--    so none of them is narrowed by this.
--
-- 4. My Attendance needs the caller's own clock, marks, plan and leave, and those
--    tables are readable by staff only. Rather than a self-read policy on each of five
--    tables — five more doors, two of them on tables no migration in this repository
--    creates — one function returns the caller's own rows and nothing else. It
--    calculates nothing: the screen runs the same TypeScript the finance close runs
--    (`countDaysAway`, `buildClose`, `leaveBalance`), so the two cannot disagree.
--
-- Idempotent and independent of BLOCOS 88–89. Paste after BLOCO 89.

-- ---------------------------------------------------------------------------
-- 1. The employee ceiling, in the one function every matrix check goes through
-- ---------------------------------------------------------------------------
create or replace function public.has_action(
  _uid uuid,
  _action text,
  _baseline app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    left join public.role_permission_overrides o
      on o.role = ur.role and o.action = _action
    where ur.user_id = _uid
      and case
            when ur.role = 'admin'::app_role then true
            -- The ceiling comes before the override on purpose: a grant beyond it
            -- must do nothing, not merely be outvoted by the baseline.
            when ur.role = 'employee'::app_role
             and _action <> all (array['overtime.respond', 'attendance.view_own'])
              then false
            else coalesce(o.allowed, ur.role = any (_baseline))
          end
  );
$$;

revoke all on function public.has_action(uuid, text, app_role[]) from public;
grant execute on function public.has_action(uuid, text, app_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The reliability numbers answer only to whoever runs overtime
-- ---------------------------------------------------------------------------
-- The body is 20261006220000's, the current one (with `blocked_until`), unchanged but
-- for the last line. Same signature and columns, so `create or replace` keeps grants.
create or replace function public.overtime_reliability(p_month date default current_date)
returns table (
  employee_id        uuid,
  sick_this_month    integer,
  absent_this_month  integer,
  ot_accepted_60d    integer,
  ot_attended_60d    integer,
  blocked_until      date
)
language sql stable security definer set search_path = public
as $$
  with bounds as (
    select date_trunc('month', p_month)::date                       as m_from,
           (date_trunc('month', p_month) + interval '1 month')::date as m_to,
           (current_date - 60)                                        as d60
  ),
  board as (
    select a.employee_id,
           count(*) filter (where a.status = 'sick')                       as sick,
           count(*) filter (where a.status in ('unpaid', 'absent', 'awol')) as absent
      from public.employee_attendance a, bounds b
     where a.on_date >= b.m_from and a.on_date < b.m_to
     group by a.employee_id
  ),
  clocks as (
    select d.employee_id,
           count(*) filter (where d.absence_name ~* 'sick')                                 as sick,
           count(*) filter (where d.absence_name is not null
                              and d.absence_name !~* 'sick'
                              and d.absence_name !~* 'holiday|vacation|annual')               as absent
      from public.attendance_days d, bounds b
     where d.on_date >= b.m_from and d.on_date < b.m_to
     group by d.employee_id
  ),
  ot_month as (
    select r.employee_id,
           count(*) filter (where o.outcome = 'called_sick')                          as sick,
           count(*) filter (where o.outcome in ('no_show', 'cancelled_late'))          as absent
      from public.overtime_outcomes o
      join public.overtime_responses r on r.id = o.response_id
      join public.overtime_requests q on q.id = r.request_id, bounds b
     where q.on_date >= b.m_from and q.on_date < b.m_to
     group by r.employee_id
  ),
  ot_60 as (
    select r.employee_id,
           count(*)                                            as accepted,
           count(*) filter (where o.outcome = 'attended')      as attended
      from public.overtime_responses r
      join public.overtime_requests q on q.id = r.request_id
      left join public.overtime_outcomes o on o.response_id = r.id, bounds b
     where r.decision = 'accepted' and q.on_date >= b.d60 and q.on_date <= current_date
     group by r.employee_id
  ),
  ids as (
    select employee_id from board
    union select employee_id from clocks
    union select employee_id from ot_month
    union select employee_id from ot_60
  )
  select i.employee_id,
         coalesce(b.sick, 0) + coalesce(c.sick, 0) + coalesce(m.sick, 0),
         coalesce(b.absent, 0) + coalesce(c.absent, 0) + coalesce(m.absent, 0),
         coalesce(s.accepted, 0),
         coalesce(s.attended, 0),
         (select blocked_until from public.overtime_block_for(i.employee_id))
    from ids i
    left join board    b on b.employee_id = i.employee_id
    left join clocks   c on c.employee_id = i.employee_id
    left join ot_month m on m.employee_id = i.employee_id
    left join ot_60    s on s.employee_id = i.employee_id
   -- Everybody else gets no rows: the same answer as "nobody was off this month",
   -- which is what an empty column beside a name already means on the manager's panel.
   where public.can_manage_overtime(auth.uid());
$$;

revoke all on function public.overtime_reliability(date) from public;
grant execute on function public.overtime_reliability(date) to authenticated;

-- ---------------------------------------------------------------------------
-- 3. Answers and outcomes: your own, or all of them if you run overtime
-- ---------------------------------------------------------------------------
drop policy if exists "overtime_responses_read" on public.overtime_responses;
create policy "overtime_responses_read" on public.overtime_responses
  for select to authenticated
  using (employee_id = public.my_employee_id() or public.can_manage_overtime(auth.uid()));

drop policy if exists "overtime_outcomes_read" on public.overtime_outcomes;
create policy "overtime_outcomes_read" on public.overtime_outcomes
  for select to authenticated
  using (
    public.can_manage_overtime(auth.uid())
    or exists (select 1 from public.overtime_responses r
                where r.id = response_id and r.employee_id = public.my_employee_id())
  );

-- ---------------------------------------------------------------------------
-- 4. My Attendance: the caller's own rows, from the records that already exist
-- ---------------------------------------------------------------------------
-- No employee id is taken from the caller. Whose rows these are is decided here, from
-- the session, by `my_employee_id()` — a URL or a request body cannot name somebody else.
--
-- `null` means the login is not linked to an employee yet; the screen says so rather
-- than drawing an empty month.
create or replace function public.my_attendance(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_emp        uuid;
  v_year_from  date;
begin
  if auth.uid() is null then
    raise exception 'Sign in to see your attendance' using errcode = '42501';
  end if;
  -- The baseline is `attendance.view_own` in src/lib/permissions.ts, and must stay so.
  if not public.has_action(auth.uid(), 'attendance.view_own',
           array['admin','manager','production_office_admin','engineer',
                 'maintenance_manager','warehouse','quality_supervisor','employee']::app_role[]) then
    raise exception 'Not allowed to see attendance' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'The range must start on or before the day it ends' using errcode = '22023';
  end if;
  if p_to - p_from > 400 then
    raise exception 'Pick a range of at most 400 days' using errcode = '22023';
  end if;

  v_emp := public.my_employee_id();
  if v_emp is null then
    return null;
  end if;

  -- Two leave years either side of today, so the balance can be counted whatever
  -- "today" the screen uses; `leaveBalance` keeps only the current one.
  v_year_from := make_date(extract(year from current_date)::int - 1, 8, 1);

  return jsonb_build_object(
    'me', (
      select jsonb_build_object(
        'id', e.id, 'full_name', e.full_name, 'employee_ref', e.employee_ref,
        'department', e.department, 'position', e.position,
        'shift_group', e.shift_group, 'started_on', e.started_on)
        from public.employees e where e.id = v_emp),
    'pattern', (
      select jsonb_build_object(
        'name', p.name, 'days', p.days, 'starts_at', p.starts_at, 'ends_at', p.ends_at,
        'break_minutes', p.break_minutes, 'annual_leave_days', p.annual_leave_days)
        from public.employees e join public.shift_patterns p on p.id = e.shift_pattern_id
       where e.id = v_emp),
    'clocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'on_date', d.on_date, 'start_time', d.start_time, 'end_time', d.end_time,
               'worked_minutes', d.worked_minutes, 'balance_minutes', d.balance_minutes,
               'scheduled_minutes', d.scheduled_minutes,
               'overtime_adj_minutes', d.overtime_adj_minutes,
               'absence_name', d.absence_name) order by d.on_date)
        from public.attendance_days d
       where d.employee_id = v_emp and d.on_date between p_from and p_to), '[]'::jsonb),
    -- How far the clock record reaches for this person. A rostered day after it is
    -- "no record yet", never "absent".
    'clocked_to', (select max(d.on_date) from public.attendance_days d where d.employee_id = v_emp),
    'clocks_imported_at', (select max(d.imported_at) from public.attendance_days d where d.employee_id = v_emp),
    'marks', coalesce((
      select jsonb_agg(jsonb_build_object('on_date', a.on_date, 'status', a.status) order by a.on_date)
        from public.employee_attendance a
       where a.employee_id = v_emp and a.on_date between p_from and p_to), '[]'::jsonb),
    'holiday_marks', coalesce((
      select jsonb_agg(a.on_date order by a.on_date)
        from public.employee_attendance a
       where a.employee_id = v_emp and a.status = 'holiday'
         and a.on_date between v_year_from and v_year_from + interval '3 years'), '[]'::jsonb),
    'board', coalesce((
      select jsonb_agg(jsonb_build_object(
               'on_date', b.on_date, 'shift', b.shift, 'status', b.status,
               'half_day', b.half_day) order by b.on_date)
        from public.daily_allocations b
       where b.employee_id = v_emp and b.on_date between p_from and p_to), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', r.kind, 'start_date', r.start_date, 'end_date', r.end_date,
               'status', r.status, 'working_days', r.working_days) order by r.start_date)
        from public.leave_requests r
       where r.employee_id = v_emp
         and r.start_date <= p_to and r.end_date >= p_from), '[]'::jsonb),
    -- Hours payroll recorded for this person, per period. The figure that is paid.
    'payroll', coalesce((
      select jsonb_agg(jsonb_build_object('period_id', o.period_id, 'hours', o.hours))
        from public.overtime_entries o
        join public.workforce_payroll_periods w on w.id = o.period_id
       where o.employee_id = v_emp
         and w.start_date <= p_to and w.end_date >= p_from), '[]'::jsonb),
    -- The calendar, not anybody's data: the selector needs it, and the table is
    -- readable by admin alone.
    'periods', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'name', w.name, 'start_date', w.start_date, 'end_date', w.end_date)
               order by w.start_date)
        from public.workforce_payroll_periods w
       where w.start_date <= current_date + 120), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.my_attendance(date, date) from public;
grant execute on function public.my_attendance(date, date) to authenticated;

-- ================================================================
-- BLOCO 91
-- 20261012170000_a_supervisor_links_a_login_to_its_person.sql
-- ================================================================
--
-- O SUPERVISOR LIGA UM LOGIN A PESSOA CERTA: o ecra Link accounts (admin e
-- manager). Precisa do BLOCO 90 antes (o tecto do papel employee no has_action).
-- Idempotente. Depois, correr supabase/tests/a_supervisor_links_a_login_test.sql.
--

-- A supervisor links a login to the person it belongs to.
--
-- "Which badge is yours?" ends with "your supervisor can link your account — they have
-- the list". There was no list. Nobody had a screen to set `employees.user_id`, so a
-- person who did not know their badge number, whose record has none (51 of them), or
-- whose email is not on their record had no way in at all.
--
-- Who may: `employees.link_login`, admin and manager — the people who already manage
-- accounts (`users.manage`). The office admin's role excludes Users by definition, and
-- the employee's ceiling (`has_action`, 20261012160000) excludes it by construction.
--
-- What it will not do, each for a reason already written down elsewhere:
--   - link a shared line tablet account (a place, not a person — 20261009090000);
--   - link a login that is already somebody, or a record already claimed — a second
--     link is a correction, and a correction is unlink then link, both audited;
--   - choose between two records: it takes ids, picked by a human, never a name.
--
-- The suggestion in `login_link_candidates()` is only that. It names a record when
-- exactly one active, unclaimed record carries the login's email, or failing that the
-- login's name; a person still presses Link.
--
-- Every link and unlink is written to `audit_logs`.
--
-- Idempotent. Paste after BLOCO 90, whose employee ceiling it relies on.

-- The list: logins that are nobody yet, records nobody has claimed, and who is linked.
create or replace function public.login_link_candidates()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null
     or not public.has_action(auth.uid(), 'employees.link_login', array['admin','manager']::app_role[]) then
    raise exception 'Not allowed to link accounts' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'logins', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', u.id,
               'email', u.email,
               'name', p.name,
               'roles', (select coalesce(jsonb_agg(ur.role order by ur.role), '[]'::jsonb)
                           from public.user_roles ur where ur.user_id = u.id),
               'created_at', u.created_at,
               'suggested_employee_id', (
                 select coalesce(
                   (select min(e.id::text)::uuid from public.employees e
                     where e.active and e.user_id is null
                       and lower(trim(e.email)) = lower(trim(u.email))
                    having count(*) = 1),
                   (select min(e.id::text)::uuid from public.employees e
                     where e.active and e.user_id is null and p.name is not null
                       and lower(trim(e.full_name)) = lower(trim(p.name))
                    having count(*) = 1)))
             ) order by u.created_at desc)
        from auth.users u
        left join public.profiles p on p.id = u.id
       where not exists (select 1 from public.employees e where e.user_id = u.id)
         and not exists (select 1 from public.operator_line_accounts o where o.user_id = u.id)
         and coalesce(p.active, true)), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'full_name', e.full_name, 'employee_ref', e.employee_ref,
               'department', e.department, 'shift_group', e.shift_group) order by e.full_name)
        from public.employees e
       where e.active and e.user_id is null), '[]'::jsonb),
    'linked', coalesce((
      select jsonb_agg(jsonb_build_object(
               'employee_id', e.id, 'full_name', e.full_name, 'employee_ref', e.employee_ref,
               'department', e.department, 'user_id', e.user_id, 'email', u.email) order by e.full_name)
        from public.employees e
        join auth.users u on u.id = e.user_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.link_login_to_employee(p_user_id uuid, p_employee_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_row     public.employees;
  v_already text;
  v_name    text;
begin
  if auth.uid() is null
     or not public.has_action(auth.uid(), 'employees.link_login', array['admin','manager']::app_role[]) then
    raise exception 'Not allowed to link accounts' using errcode = '42501';
  end if;
  if p_user_id is null or p_employee_id is null then
    raise exception 'Pick both the login and the person' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'That login no longer exists' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.operator_line_accounts o where o.user_id = p_user_id) then
    raise exception 'That is a shared line tablet, not a person. It cannot be linked to anybody.'
      using errcode = 'P0001';
  end if;

  -- Two supervisors linking the same login at once must not give it two people.
  perform pg_advisory_xact_lock(hashtext('link_login:' || p_user_id::text));

  select full_name into v_already from public.employees where user_id = p_user_id limit 1;
  if v_already is not null then
    raise exception 'That login is already linked to %. Unlink it first.', v_already
      using errcode = 'P0001';
  end if;

  update public.employees
     set user_id = p_user_id
   where id = p_employee_id and active and user_id is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'That person is already linked to a login, or is no longer active.'
      using errcode = 'P0001';
  end if;

  -- Wrong badge guesses no longer matter once the person is linked. The table comes
  -- with BLOCO 81, which may not have been pasted yet.
  if to_regclass('public.identity_link_attempts') is not null then
    execute 'delete from public.identity_link_attempts where user_id = $1' using p_user_id;
  end if;

  select coalesce(p.name, 'Unknown') into v_name from public.profiles p where p.id = auth.uid();
  insert into public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  values (auth.uid(), coalesce(v_name, 'Unknown'), 'employee.login_linked', 'employee', v_row.id::text,
          jsonb_build_object('employee', v_row.full_name, 'employee_ref', v_row.employee_ref,
                             'login', (select email from auth.users where id = p_user_id),
                             'user_id', p_user_id));
end;
$$;

create or replace function public.unlink_login_from_employee(p_employee_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_row  public.employees;
  v_was  uuid;
  v_name text;
begin
  if auth.uid() is null
     or not public.has_action(auth.uid(), 'employees.link_login', array['admin','manager']::app_role[]) then
    raise exception 'Not allowed to link accounts' using errcode = '42501';
  end if;

  select user_id into v_was from public.employees where id = p_employee_id for update;
  if v_was is null then
    raise exception 'That person is not linked to a login' using errcode = 'P0001';
  end if;

  update public.employees set user_id = null where id = p_employee_id returning * into v_row;

  select coalesce(p.name, 'Unknown') into v_name from public.profiles p where p.id = auth.uid();
  insert into public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  values (auth.uid(), coalesce(v_name, 'Unknown'), 'employee.login_unlinked', 'employee', v_row.id::text,
          jsonb_build_object('employee', v_row.full_name, 'employee_ref', v_row.employee_ref,
                             'login', (select email from auth.users where id = v_was),
                             'user_id', v_was));
end;
$$;

revoke all on function public.login_link_candidates() from public;
revoke all on function public.link_login_to_employee(uuid, uuid) from public;
revoke all on function public.unlink_login_from_employee(uuid) from public;
grant execute on function public.login_link_candidates() to authenticated;
grant execute on function public.link_login_to_employee(uuid, uuid) to authenticated;
grant execute on function public.unlink_login_from_employee(uuid) to authenticated;

-- ================================================================
-- BLOCO 92
-- 20261012180000_a_name_is_written_one_way.sql
-- ================================================================
--
-- NOMES ESCRITOS DE UMA SO MANEIRA: "JOAO SPINELLI" passa a "Joao Spinelli",
-- em cada insert e cada mudanca de nome, e corrige os que ja existem.
-- Independente dos outros blocos. Idempotente.
--

-- A name is written one way: first letter of each word capital, the rest small.
--
-- The employee list had "JOAO SPINELLI" and "KAMILLA ZAPELINI" beside "Juliano Santos".
-- The screens now write names in that form (src/lib/personName.ts), but the screens are
-- not the only writers — imports, the SQL editor, anything to come — so the rule lives
-- here, on every insert and every rename, and the screen's copy is a convenience.
--
-- The rule is `initcap` after trimming and collapsing spaces, the same rule the client
-- applies, so the two cannot disagree about a name.
--
-- The backfill skips a row whose corrected name would collide with another person's on
-- `employees_name_unique_idx` (lower(full_name)). Only a change of spacing can do that —
-- a change of case cannot — and one such pair would otherwise abort the whole update.
-- Those rows are left as they are for a human to settle; the query at the end lists them.
--
-- Idempotent.

create or replace function public.person_name_case(raw text)
returns text
language sql
immutable
set search_path = public
as $$
  select initcap(regexp_replace(btrim(raw), '\s+', ' ', 'g'))
$$;

create or replace function public.employees_name_case()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.full_name is not null then
    new.full_name := public.person_name_case(new.full_name);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_employees_name_case on public.employees;
create trigger trg_employees_name_case
  before insert or update of full_name on public.employees
  for each row execute function public.employees_name_case();

update public.employees e
   set full_name = public.person_name_case(e.full_name)
 where e.full_name is distinct from public.person_name_case(e.full_name)
   and not exists (
     select 1 from public.employees o
      where o.id <> e.id
        and lower(public.person_name_case(o.full_name)) = lower(public.person_name_case(e.full_name))
   );

-- Left behind, if any: rows whose corrected name is already somebody else's.
--   select id, full_name from public.employees
--    where full_name is distinct from public.person_name_case(full_name);

-- ================================================================
-- BLOCO 93
-- 20261012190000_accepted_overtime_is_planned_not_present.sql
-- ================================================================
--
-- A OVERTIME ACEITE CHEGA AO BOARD: a ponte do 20261007120000 nunca foi aplicada
-- (sem trigger, sem coluna). Este bloco traz a ponte inteira, sem escrever
-- "present" antes do dia, e poe no board as aceites de hoje em diante
-- (a 12/10: Rosana Cardozo, 17/10, Day). Sozinho e idempotente.
-- Depois, correr supabase/tests/overtime_board_bridge_test.sql.
--

-- Accepted overtime is a plan on the board, not a day already worked.
--
-- Rosana Cardozo, 17/10/2026, 06:00–18:00: answered yes, a supervisor accepted, and the
-- Day board for the 17th had nothing for her. Read on 12/10/2026 in the SQL editor:
-- `overtime_responses.decision = 'accepted'`, no `daily_allocations` row on any shift,
-- and `pg_trigger` with no `overtime_response_to_board_t`. The bridge written in
-- 20261007120000 never reached production — the column `daily_allocations
-- .overtime_request_id` and `overtime_board_shift()` both answer 404 to the REST probe.
-- It was never a bug in the bridge; the wire was in the repository and not in the base.
--
-- This file is that bridge, whole and self-contained, so it can be pasted on its own,
-- with one change: it no longer writes `employee_attendance` 'present' at the moment
-- of acceptance. An ask is accepted days ahead. Writing 'present' for the 17th on the
-- 12th says she was in before the day exists, and My Attendance and the finance close
-- both read that table as a record. The board row (`status = 'overtime'`) is the plan;
-- presence comes from the clock (TimeMoto → attendance_days) or from a supervisor's
-- mark on the day, as for everybody else.
--
-- Everything 20261007120000 promised about what it will never touch still holds: it
-- only deletes rows carrying its ask's id, and it inserts with `on conflict do
-- nothing`, so a person already on the board that day keeps the row they have and is
-- never drawn twice.
--
-- The backfill at the end puts on the board every accepted answer, on an ask that is
-- not cancelled, for today or later. Past days are left alone: what happened on them
-- is the board's record already, and adding to it now would rewrite history.
--
-- Idempotent.

-- ── 1. The key the board rows carry home ───────────────────────────────────
alter table public.daily_allocations
  add column if not exists overtime_request_id uuid null
    references public.overtime_requests(id) on delete set null;

create index if not exists daily_allocations_overtime_request_id_idx
  on public.daily_allocations (overtime_request_id)
  where overtime_request_id is not null;

comment on column public.daily_allocations.overtime_request_id is
  'The overtime ask that put this row here, or null for every ordinary allocation. '
  'Only a row carrying an id may be removed by the overtime flow.';

-- ── 2. Which board an ask's hours belong to ────────────────────────────────
create or replace function public.overtime_board_shift(p_on_date date, p_starts_at time)
returns text
language sql stable set search_path = public
as $$
  select initcap(public.factory_shift_of((p_on_date + p_starts_at) at time zone 'Europe/London'));
$$;

-- ── 3. The one place that writes the board on behalf of an ask ─────────────
create or replace function public.overtime_board_apply(
  p_request_id  uuid,
  p_employee_id uuid,
  p_accepted    boolean
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_req   public.overtime_requests;
  v_shift text;
begin
  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null then return; end if;

  if not p_accepted then
    -- Only ours. A row the planner made for the same person on the same day has no
    -- id on it and is invisible to this.
    delete from public.daily_allocations
     where overtime_request_id = p_request_id
       and employee_id = p_employee_id;
    return;
  end if;

  if v_req.status = 'cancelled' then return; end if;

  v_shift := public.overtime_board_shift(v_req.on_date, v_req.starts_at);

  -- Planned, not present: no employee_attendance here (see the header).
  insert into public.daily_allocations
    (on_date, shift, employee_id, status, area_id, is_leader, overtime_request_id)
  values
    (v_req.on_date, v_shift, p_employee_id, 'overtime', null, false, p_request_id)
  on conflict (on_date, shift, employee_id) do nothing;
end;
$$;

revoke all on function public.overtime_board_apply(uuid, uuid, boolean) from public, anon, authenticated;

-- ── 4. The decision ────────────────────────────────────────────────────────
create or replace function public.overtime_response_to_board()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  -- coalesce: `decision` is null until somebody decides, and null is not false.
  perform public.overtime_board_apply(
    new.request_id, new.employee_id, coalesce(new.decision = 'accepted', false));
  return new;
end;
$$;

drop trigger if exists overtime_response_to_board_t on public.overtime_responses;
create trigger overtime_response_to_board_t
  after insert or update of decision on public.overtime_responses
  for each row execute function public.overtime_response_to_board();

-- ── 5. The cancellation ────────────────────────────────────────────────────
create or replace function public.overtime_request_to_board()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    delete from public.daily_allocations where overtime_request_id = new.id;
  end if;
  return new;
end;
$$;

drop trigger if exists overtime_request_to_board_t on public.overtime_requests;
create trigger overtime_request_to_board_t
  after update of status on public.overtime_requests
  for each row execute function public.overtime_request_to_board();

-- ── 6. What was accepted before the wire existed ───────────────────────────
-- On 12/10/2026 this is one row: Rosana Cardozo, 17/10, Day.
select public.overtime_board_apply(r.request_id, r.employee_id, true)
  from public.overtime_responses r
  join public.overtime_requests q on q.id = r.request_id
 where r.decision = 'accepted'
   and q.status <> 'cancelled'
   and q.on_date >= current_date;

-- ================================================================
-- BLOCO 94
-- 20261012200000_my_attendance_says_where.sql
-- ================================================================
--
-- O MY ATTENDANCE DIZ ONDE: a coluna do board de cada dia e as horas da overtime
-- aceite. Precisa do BLOCO 90 (my_attendance). Independente do 93. Idempotente.
--

-- My Attendance says where: the board column for each day, and the hours of overtime.
--
-- The employee could see that they were due on the 14th and not where. The board
-- already knows — `daily_allocations.area_id`, one row per person per day and shift —
-- and `my_attendance` returned the row without it. Nothing new is stored: the same
-- rows the Headcount Board draws, with the column's name joined on, so the phone and
-- the board cannot disagree. A supervisor moving somebody on the board moves them on
-- the phone at the next load.
--
-- Two additions to the jsonb, both new keys, so the screen running before this is
-- pasted keeps working and the screen running after it before this is pasted shows
-- no work area rather than a wrong one:
--   board[].area / area_kind / is_leader   — the column, by the name the board uses
--   overtime[]                              — accepted overtime asks: date and hours
--
-- Still only the caller's own rows: `my_employee_id()` decides whose, as before.
-- Everything else in the function is 20261012160000 unchanged.
--
-- Idempotent.

create or replace function public.my_attendance(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_emp        uuid;
  v_year_from  date;
begin
  if auth.uid() is null then
    raise exception 'Sign in to see your attendance' using errcode = '42501';
  end if;
  -- The baseline is `attendance.view_own` in src/lib/permissions.ts, and must stay so.
  if not public.has_action(auth.uid(), 'attendance.view_own',
           array['admin','manager','production_office_admin','engineer',
                 'maintenance_manager','warehouse','quality_supervisor','employee']::app_role[]) then
    raise exception 'Not allowed to see attendance' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'The range must start on or before the day it ends' using errcode = '22023';
  end if;
  if p_to - p_from > 400 then
    raise exception 'Pick a range of at most 400 days' using errcode = '22023';
  end if;

  v_emp := public.my_employee_id();
  if v_emp is null then
    return null;
  end if;

  -- Two leave years either side of today, so the balance can be counted whatever
  -- "today" the screen uses; `leaveBalance` keeps only the current one.
  v_year_from := make_date(extract(year from current_date)::int - 1, 8, 1);

  return jsonb_build_object(
    'me', (
      select jsonb_build_object(
        'id', e.id, 'full_name', e.full_name, 'employee_ref', e.employee_ref,
        'department', e.department, 'position', e.position,
        'shift_group', e.shift_group, 'started_on', e.started_on)
        from public.employees e where e.id = v_emp),
    'pattern', (
      select jsonb_build_object(
        'name', p.name, 'days', p.days, 'starts_at', p.starts_at, 'ends_at', p.ends_at,
        'break_minutes', p.break_minutes, 'annual_leave_days', p.annual_leave_days)
        from public.employees e join public.shift_patterns p on p.id = e.shift_pattern_id
       where e.id = v_emp),
    'clocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'on_date', d.on_date, 'start_time', d.start_time, 'end_time', d.end_time,
               'worked_minutes', d.worked_minutes, 'balance_minutes', d.balance_minutes,
               'scheduled_minutes', d.scheduled_minutes,
               'overtime_adj_minutes', d.overtime_adj_minutes,
               'absence_name', d.absence_name) order by d.on_date)
        from public.attendance_days d
       where d.employee_id = v_emp and d.on_date between p_from and p_to), '[]'::jsonb),
    -- How far the clock record reaches for this person. A rostered day after it is
    -- "no record yet", never "absent".
    'clocked_to', (select max(d.on_date) from public.attendance_days d where d.employee_id = v_emp),
    'clocks_imported_at', (select max(d.imported_at) from public.attendance_days d where d.employee_id = v_emp),
    'marks', coalesce((
      select jsonb_agg(jsonb_build_object('on_date', a.on_date, 'status', a.status) order by a.on_date)
        from public.employee_attendance a
       where a.employee_id = v_emp and a.on_date between p_from and p_to), '[]'::jsonb),
    'holiday_marks', coalesce((
      select jsonb_agg(a.on_date order by a.on_date)
        from public.employee_attendance a
       where a.employee_id = v_emp and a.status = 'holiday'
         and a.on_date between v_year_from and v_year_from + interval '3 years'), '[]'::jsonb),
    -- Where: the board column the row is in, by the name the board heads it with.
    -- Null when the row has no column (an absence, or overtime nobody has placed yet)
    -- — the screen says "not yet assigned" rather than guessing from the department.
    'board', coalesce((
      select jsonb_agg(jsonb_build_object(
               'on_date', b.on_date, 'shift', b.shift, 'status', b.status,
               'half_day', b.half_day, 'area', h.name, 'area_kind', h.kind,
               'is_leader', b.is_leader) order by b.on_date, b.shift)
        from public.daily_allocations b
        left join public.headcount_areas h on h.id = b.area_id
       where b.employee_id = v_emp and b.on_date between p_from and p_to), '[]'::jsonb),
    -- The hours of each overtime shift a supervisor accepted this person for. The
    -- board row says which board; the ask says when it starts and ends, which for a
    -- Day person on Night overtime is not their rota's hours.
    'overtime', coalesce((
      select jsonb_agg(jsonb_build_object(
               'on_date', q.on_date, 'starts_at', q.starts_at, 'ends_at', q.ends_at)
               order by q.on_date, q.starts_at)
        from public.overtime_responses r
        join public.overtime_requests q on q.id = r.request_id
       where r.employee_id = v_emp and r.decision = 'accepted'
         and q.status <> 'cancelled'
         and q.on_date between p_from and p_to), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', r.kind, 'start_date', r.start_date, 'end_date', r.end_date,
               'status', r.status, 'working_days', r.working_days) order by r.start_date)
        from public.leave_requests r
       where r.employee_id = v_emp
         and r.start_date <= p_to and r.end_date >= p_from), '[]'::jsonb),
    -- Hours payroll recorded for this person, per period. The figure that is paid.
    'payroll', coalesce((
      select jsonb_agg(jsonb_build_object('period_id', o.period_id, 'hours', o.hours))
        from public.overtime_entries o
        join public.workforce_payroll_periods w on w.id = o.period_id
       where o.employee_id = v_emp
         and w.start_date <= p_to and w.end_date >= p_from), '[]'::jsonb),
    -- The calendar, not anybody's data: the selector needs it, and the table is
    -- readable by admin alone.
    'periods', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'name', w.name, 'start_date', w.start_date, 'end_date', w.end_date)
               order by w.start_date)
        from public.workforce_payroll_periods w
       where w.start_date <= current_date + 120), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.my_attendance(date, date) from public;
grant execute on function public.my_attendance(date, date) to authenticated;

-- ================================================================
-- BLOCO 95
-- 20261018090000_overtime_is_not_offered_on_hours_already_rostered.sql
-- ================================================================
--
-- A OVERTIME NAO E OFERECIDA EM HORAS QUE JA SAO DA PESSOA: o telemovel deixa de
-- mostrar, e um trigger recusa o sim, quando o board ou a escala dessa data ja a
-- poem a trabalhar essas horas (ou ja tem overtime aceite nelas). Nao toca no
-- answer_overtime, por isso a ordem face ao 78-a-89 nao importa. Precisa do
-- BLOCO 93; para com uma mensagem se faltar. Idempotente.
--

-- Overtime is not offered on hours the person is already rostered for.
--
-- A weekend-crew packer whose Saturday is 06:00–18:00 saw the Saturday 06:00–18:00
-- ask on their phone, with "Yes, I can" live. The screen narrowed asks by department
-- and crew label and nothing else; `answer_overtime` checked the same two labels. A
-- crew label says which board somebody is drawn on, not which days and hours they
-- work, so a person could say yes to overtime on top of their own shift — and the
-- board bridge, `on conflict do nothing`, would quietly keep the one row they had.
--
-- The question is asked of the date, not of the person: what is this employee
-- actually down to work on the day of the ask, and the days either side of it?
--
--   1. The board (`daily_allocations`), where it has been drawn for them that day.
--      `assigned` is their shift. `overtime` placed by hand (no ask id) is overtime
--      already given. A holiday, sickness, unpaid or training row says they are not
--      on their rota that day, and the rota is not consulted.
--   2. Otherwise the rota they held ON THAT DATE (`employee_shift_history`, falling
--      back to the employee row): the pattern's weekdays, or the Fri–Mon crews' own
--      days. No rota recorded is unknown, which is not working — the same rule the
--      board's roster uses — so nobody is hidden on a guess.
--   3. Overtime already accepted on another ask that was not cancelled and not
--      dropped out of.
--
-- Hours, not labels. The pattern's start and end for that weekday
-- (`shift_pattern_days` first, then the pattern), or else the factory's 06:00–18:00
-- day and 18:00–06:00 night. An ask clashes when its window overlaps one of these.
-- The day before and after are read too: Friday's night runs into Saturday morning,
-- and a night ask can run into Sunday's day shift. A Day person on a Night ask with no
-- overlap is not refused here; the cross-shift rules (rest, the supervisor's
-- choice) are where they always were.
--
-- What changes:
--   * `overtime_schedule_clash(employee, ask)` — the one rule. Returns why, or null.
--     Not callable from the client; the two functions below are.
--   * `my_overtime_clashes()` — the signed-in employee's open asks that clash, so the
--     phone stops offering them.
--   * `overtime_schedule_clashes(asks[])` — the same answer for the supervisor's
--     screen, for everybody active, behind `overtime.manage`.
--   * A "yes" that clashes is refused where it is written: a trigger on
--     `overtime_responses`, so `answer_overtime` itself is not redefined. The catch-up
--     paste (APLICAR-78-a-89) redefines that function; a second copy here would be
--     rolled back by it, or roll it back, depending on which was pasted last. A "no"
--     is always allowed. A supervisor answering at the desk is not stopped here —
--     their screen refuses the accept from the same rule — and neither is a write with
--     no session (the SQL editor, a backfill).
--
-- No check on acceptance itself: the reserve that steps in when somebody drops out is
-- promoted inside `record_overtime_outcome`, and a raise there would lose the outcome
-- being recorded. The supervisor's screen refuses the accept instead.
--
-- Needs BLOCO 93 (daily_allocations.overtime_request_id). Stops with a message if it
-- is missing. Independent of 78–89.
--
-- Idempotent.

do $$
begin
  if not exists (select 1 from information_schema.columns
                  where table_schema = 'public' and table_name = 'daily_allocations'
                    and column_name = 'overtime_request_id') then
    raise exception 'Paste APLICAR-93-overtime-no-board.sql first: daily_allocations.overtime_request_id is missing';
  end if;
end;
$$;

-- ── 1. The rule ─────────────────────────────────────────────────────────────
create or replace function public.overtime_schedule_clash(p_employee_id uuid, p_request_id uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_req      public.overtime_requests;
  v_ot_from  timestamp;
  v_ot_to    timestamp;
  v_day      date;
  v_crew     text;
  v_pattern  uuid;
  v_days     smallint[];
  v_p_start  time;
  v_p_end    time;
  v_board    text;
  v_drawn    boolean;
  v_start    time;
  v_end      time;
  v_from     timestamp;
  v_to       timestamp;
  b          record;
  o          record;
begin
  if p_employee_id is null then return null; end if;
  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null then return null; end if;

  -- Local wall time throughout: the ask, the rota and the board are all written in it.
  v_ot_from := v_req.on_date + v_req.starts_at;
  v_ot_to   := v_req.on_date + v_req.ends_at;
  if v_req.ends_at <= v_req.starts_at then v_ot_to := v_ot_to + interval '1 day'; end if;

  -- Overtime already given on another ask.
  for o in
    select q.on_date, q.starts_at, q.ends_at
      from public.overtime_responses r
      join public.overtime_requests q on q.id = r.request_id
     where r.employee_id = p_employee_id
       and r.decision = 'accepted'
       and q.id <> v_req.id
       and q.status <> 'cancelled'
       and q.on_date between v_req.on_date - 1 and v_req.on_date + 1
       and not exists (
         select 1 from public.overtime_outcomes x
          where x.response_id = r.id
            and x.outcome in ('no_show', 'called_sick', 'cancelled', 'cancelled_in_time', 'cancelled_late'))
  loop
    v_from := o.on_date + o.starts_at;
    v_to   := o.on_date + o.ends_at;
    if o.ends_at <= o.starts_at then v_to := v_to + interval '1 day'; end if;
    if v_from < v_ot_to and v_ot_from < v_to then
      return format('Already down for overtime on %s, %s–%s',
        to_char(o.on_date, 'Dy DD/MM'), to_char(o.starts_at, 'HH24:MI'), to_char(o.ends_at, 'HH24:MI'));
    end if;
  end loop;

  -- The normal schedule, the day before through the day after.
  for v_day in
    select d::date from generate_series(v_req.on_date - 1, v_req.on_date + 1, interval '1 day') d
  loop
    -- The crew and rota held on that date, not today's.
    v_crew := null; v_pattern := null;
    select h.shift_group, h.shift_pattern_id into v_crew, v_pattern
      from public.employee_shift_history h
     where h.employee_id = p_employee_id and h.effective_from <= v_day
     order by h.effective_from desc
     limit 1;
    if not found then
      select e.shift_group, e.shift_pattern_id into v_crew, v_pattern
        from public.employees e where e.id = p_employee_id;
    end if;

    v_days := null; v_p_start := null; v_p_end := null;
    if v_pattern is not null then
      select p.days, coalesce(pd.starts_at, p.starts_at), coalesce(pd.ends_at, p.ends_at)
        into v_days, v_p_start, v_p_end
        from public.shift_patterns p
        left join public.shift_pattern_days pd
          on pd.pattern_id = p.id and pd.weekday = extract(isodow from v_day)
       where p.id = v_pattern;
    elsif v_crew in ('Weekend', 'Warehouse Weekend') then
      v_days := array[5, 6, 7, 1]::smallint[];
    end if;
    -- The board a crew is drawn on: Night, or Day for every other crew.
    v_board := case when v_crew is null then null when v_crew = 'Night' then 'Night' else 'Day' end;

    -- The board, where it has been drawn for this person on this day.
    v_drawn := false;
    for b in
      select a.shift, a.status, a.sheet_start_time, a.overtime_request_id
        from public.daily_allocations a
       where a.employee_id = p_employee_id and a.on_date = v_day
    loop
      v_drawn := true;
      -- Rows an ask wrote are the accepted answers above, read with their own hours.
      continue when b.overtime_request_id is not null;
      continue when b.status not in ('assigned', 'overtime');

      if b.shift = v_board and v_p_start is not null and v_p_end is not null then
        v_start := v_p_start; v_end := v_p_end;
      elsif b.shift = 'Night' then
        v_start := '18:00'; v_end := '06:00';
      else
        v_start := '06:00'; v_end := '18:00';
      end if;
      -- The sheet's own start, when it wrote one ("09:00").
      if b.sheet_start_time ~ '^\s*([01]?\d|2[0-3]):[0-5]\d\s*$' then
        v_start := trim(b.sheet_start_time)::time;
      end if;

      v_from := v_day + v_start;
      v_to   := v_day + v_end;
      if v_end <= v_start then v_to := v_to + interval '1 day'; end if;
      if v_from < v_ot_to and v_ot_from < v_to then
        return format('%s on the %s shift on %s, %s–%s',
          case when b.status = 'overtime' then 'Already down for overtime' else 'Rostered' end,
          lower(b.shift), to_char(v_day, 'Dy DD/MM'),
          to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI'));
      end if;
    end loop;

    -- Not drawn yet: the rota says whether they are due.
    if not v_drawn and v_board is not null and v_days is not null
       and extract(isodow from v_day)::smallint = any (v_days) then
      v_start := coalesce(v_p_start, case v_board when 'Night' then '18:00'::time else '06:00'::time end);
      v_end   := coalesce(v_p_end,   case v_board when 'Night' then '06:00'::time else '18:00'::time end);
      v_from := v_day + v_start;
      v_to   := v_day + v_end;
      if v_end <= v_start then v_to := v_to + interval '1 day'; end if;
      if v_from < v_ot_to and v_ot_from < v_to then
        return format('Your rota has you on the %s shift on %s, %s–%s',
          lower(v_board), to_char(v_day, 'Dy DD/MM'),
          to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI'));
      end if;
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.overtime_schedule_clash(uuid, uuid) from public, anon, authenticated;

-- ── 2. The employee's phone ─────────────────────────────────────────────────
create or replace function public.my_overtime_clashes()
returns table (request_id uuid, reason text)
language sql stable security definer set search_path = public
as $$
  with me as (select public.my_employee_id() as id)
  select c.request_id, c.reason
    from (
      select q.id as request_id, public.overtime_schedule_clash(me.id, q.id) as reason
        from public.overtime_requests q, me
       where me.id is not null
         and q.status = 'open'
         and q.on_date >= current_date - 1
    ) c
   where c.reason is not null;
$$;

revoke all on function public.my_overtime_clashes() from public, anon;
grant execute on function public.my_overtime_clashes() to authenticated;

-- ── 3. The supervisor's screen ──────────────────────────────────────────────
create or replace function public.overtime_schedule_clashes(p_request_ids uuid[])
returns table (request_id uuid, employee_id uuid, reason text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.can_manage_overtime(auth.uid()) then
    raise exception 'Not allowed to manage overtime' using errcode = '42501';
  end if;
  if coalesce(array_length(p_request_ids, 1), 0) > 100 then
    raise exception 'Ask for at most 100 overtime asks at a time' using errcode = '22023';
  end if;

  return query
    select c.request_id, c.employee_id, c.reason
      from (
        select q.id as request_id, e.id as employee_id,
               public.overtime_schedule_clash(e.id, q.id) as reason
          from public.overtime_requests q
          cross join public.employees e
         where q.id = any (p_request_ids)
           and q.status <> 'cancelled'
           and (e.active
                or exists (select 1 from public.overtime_responses r
                            where r.request_id = q.id and r.employee_id = e.id))
      ) c
     where c.reason is not null;
end;
$$;

revoke all on function public.overtime_schedule_clashes(uuid[]) from public, anon;
grant execute on function public.overtime_schedule_clashes(uuid[]) to authenticated;

-- ── 4. A yes on top of the person's own hours is refused where it is written ──
create or replace function public.overtime_response_schedule_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_clash text;
begin
  -- Only a new yes nobody has decided on yet, from a signed-in person who does not
  -- manage overtime: the employee answering on their own phone.
  if new.answer is distinct from 'yes' or new.decision is not null then return new; end if;
  if tg_op = 'UPDATE' and old.answer = 'yes' then return new; end if;
  if auth.uid() is null or public.can_manage_overtime(auth.uid()) then return new; end if;

  -- Overtime on top of your own shift is the same hours twice, not overtime.
  v_clash := public.overtime_schedule_clash(new.employee_id, new.request_id);
  if v_clash is not null then
    raise exception 'These hours are already yours: %', v_clash using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.overtime_response_schedule_guard() from public, anon, authenticated;

drop trigger if exists overtime_response_schedule_guard_t on public.overtime_responses;
create trigger overtime_response_schedule_guard_t
  before insert or update of answer on public.overtime_responses
  for each row execute function public.overtime_response_schedule_guard();

-- ================================================================
-- BLOCO 96
-- 20261018100000_one_login_is_one_person.sql
-- ================================================================
--
-- UM LOGIN É UMA PESSOA: user_id único e com FK, crachá único sem olhar a maiúsculas,
-- e quem muda o turno pode gravar desde quando. Independente dos outros. Idempotente.
-- Se parar com "A login is linked to more than one person" ou "same badge number",
-- a mensagem diz quem: corrigir esses registos e colar outra vez.
--

-- One login is one person, one badge is one person, and a crew change keeps its date.
--
-- `employees.user_id` is the only link between somebody who signs in and the record
-- they are paid from. `my_employee_id()`, `my_overtime_identity`, `my_attendance` and
-- `has_action`'s employee ceiling all read it. It had no constraint at all:
--
--   * No uniqueness. The Users screen linked by a plain UPDATE that never asked whether
--     the login already had a person, so one login could hold two. `my_employee_id()`
--     then answers with `limit 1` — whichever of the two the planner reaches first —
--     and the person's overtime answers and attendance can belong to either.
--   * No foreign key. Deleting a login (the `delete-user` function) left its id on the
--     employee row, pointing at nobody. `login_link_candidates` drops such a row from
--     both of its lists — not unclaimed (`user_id is null` fails), not linked (the join
--     to auth.users finds nothing) — so nobody can see it to fix it.
--
-- `employee_ref` was unique byte for byte and looked up case-blind everywhere
-- (`upper(trim())` in SQL, `ilike` in `employee-signin`), so "e045" and "E045 " could
-- both be stored and every lookup of either would find two people.
--
-- And `employee_shift_history`, the dated record of a crew change that every
-- date-aware read goes through, could only be written by admin, while the crew
-- columns on `employees` are written by anybody with `workforce.manage`. For the five
-- production office admin accounts the board changed the crew and then failed to
-- record when — the current column and the history disagreeing from that day on.
--
-- Nothing here adds a column or a table. It constrains the ones that already are the
-- source of truth. The two checks that could find bad data REFUSE and name it rather
-- than choosing for anybody: which of two records a login really is, or which of two
-- spellings of a badge is right, is a fact the office has and this file does not.
--
-- Idempotent. Independent of the blocks still waiting (81, 90, 94).

-- ── 1. Links to logins that no longer exist ──────────────────────────────────
-- The login is gone, so there is nothing to keep: the record goes back to unclaimed,
-- where `login_link_candidates` shows it again. Named in the output, so the paste
-- says who it touched.
do $$
declare v_names text;
begin
  select string_agg(e.full_name, ', ' order by e.full_name) into v_names
    from public.employees e
   where e.user_id is not null
     and not exists (select 1 from auth.users u where u.id = e.user_id);
  if v_names is not null then
    raise notice 'Unlinked from a login that no longer exists: %', v_names;
  end if;
end $$;

update public.employees e
   set user_id = null
 where e.user_id is not null
   and not exists (select 1 from auth.users u where u.id = e.user_id);

-- ── 2. One login, one person ────────────────────────────────────────────────
do $$
declare v_dupes text;
begin
  select string_agg(format('%s (%s)', x.email, x.names), '; ') into v_dupes
    from (select coalesce(u.email, e.user_id::text) as email,
                 string_agg(e.full_name, ' + ' order by e.full_name) as names
            from public.employees e
            left join auth.users u on u.id = e.user_id
           where e.user_id is not null
           group by e.user_id, u.email
          having count(*) > 1) x;
  if v_dupes is not null then
    raise exception 'A login is linked to more than one person. Unlink the wrong one on Users → Link accounts, then paste this again: %', v_dupes;
  end if;
end $$;

create unique index if not exists employees_user_id_key
  on public.employees (user_id) where user_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'employees_user_id_fkey' and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete set null;
  end if;
end $$;

-- ── 3. One badge, one person, whatever the case ─────────────────────────────
do $$
declare v_dupes text;
begin
  select string_agg(format('%s (%s)', x.ref, x.names), '; ') into v_dupes
    from (select upper(btrim(employee_ref)) as ref,
                 string_agg(format('%s "%s"', full_name, employee_ref), ' + ' order by full_name) as names
            from public.employees
           where nullif(btrim(employee_ref), '') is not null
           group by upper(btrim(employee_ref))
          having count(*) > 1) x;
  if v_dupes is not null then
    raise exception 'Two records carry the same badge number in different spellings. Correct one of them, then paste this again: %', v_dupes;
  end if;
end $$;

create unique index if not exists employees_employee_ref_norm_key
  on public.employees (upper(btrim(employee_ref)))
  where nullif(btrim(employee_ref), '') is not null;

-- ── 4. Whoever may change a crew may record when ────────────────────────────
-- The same rule as "employees update by matrix", so the two writes `useChangeShift`
-- makes are allowed to the same people or refused to the same people. `esh_write`
-- (admin, everything) stays; DELETE stays admin-only, because the history is a record.
drop policy if exists "employee_shift_history insert by matrix" on public.employee_shift_history;
create policy "employee_shift_history insert by matrix"
  on public.employee_shift_history
  for insert to authenticated
  with check (public.has_action((select auth.uid()), 'workforce.manage', array['admin']::app_role[]));

drop policy if exists "employee_shift_history update by matrix" on public.employee_shift_history;
create policy "employee_shift_history update by matrix"
  on public.employee_shift_history
  for update to authenticated
  using (public.has_action((select auth.uid()), 'workforce.manage', array['admin']::app_role[]))
  with check (public.has_action((select auth.uid()), 'workforce.manage', array['admin']::app_role[]));

-- ================================================================
-- BLOCO 97
-- 20261018103000_an_edited_ask_moves_its_board_rows.sql
-- ================================================================
--
-- UM PEDIDO DE OVERTIME EDITADO LEVA AS FILAS DO BOARD COM ELE. Precisa do BLOCO 93.
-- Idempotente.
--

-- An overtime ask that is edited takes its board rows with it.
--
-- The bridge (20261012190000, BLOCO 93) puts an accepted answer on the board as a row
-- carrying the ask's id, and takes it off when the answer or the ask is withdrawn. It
-- listens to `overtime_responses.decision` and to `overtime_requests.status` — and to
-- nothing else. The ask's date and start time can be edited after people have said
-- yes (`editRequest`, useOvertimeRequests.ts), and when they were, the board kept the
-- rows on the OLD day, or on the old board when 06:00 became 18:00. The people who
-- accepted were drawn on a day nobody asked them for and missing from the one they
-- were.
--
-- The board is the record of the plan, and the ask is where the plan comes from, so
-- the fix is to redraw from the ask: remove only this ask's own rows, then put every
-- accepted answer back through `overtime_board_apply`, the one function that writes
-- the board on an ask's behalf. Rows a planner made by hand carry no ask id and are
-- not touched, exactly as before.
--
-- Needs BLOCO 93 (`overtime_board_apply`). Idempotent.

create or replace function public.overtime_request_moved_to_board()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare r record;
begin
  if new.status = 'cancelled' then return new; end if;
  delete from public.daily_allocations where overtime_request_id = new.id;
  for r in
    select employee_id from public.overtime_responses
     where request_id = new.id and decision = 'accepted'
  loop
    perform public.overtime_board_apply(new.id, r.employee_id, true);
  end loop;
  return new;
end;
$$;

revoke all on function public.overtime_request_moved_to_board() from public, anon, authenticated;

drop trigger if exists overtime_request_moved_to_board_t on public.overtime_requests;
create trigger overtime_request_moved_to_board_t
  after update of on_date, starts_at on public.overtime_requests
  for each row
  when (old.on_date is distinct from new.on_date or old.starts_at is distinct from new.starts_at)
  execute function public.overtime_request_moved_to_board();

-- ================================================================
-- BLOCO 98
-- 20261018110000_overtime_keeps_its_own_record.sql
-- ================================================================
--
-- A OVERTIME GUARDA O SEU PRÓPRIO REGISTO: tabela overtime_audit, só de acrescentar,
-- escrita por triggers nas tabelas de overtime, no board e nas regras. Não precisa
-- dos blocos 78–89. Idempotente; o histórico é preenchido uma vez, com a tabela vazia.
--

-- Overtime keeps its own record of what happened, and nobody can rewrite it.
--
-- The three overtime tables hold the CURRENT state. A changed answer is an UPDATE, a
-- corrected outcome is an upsert, a cancelled ask keeps only its last status, and a
-- deleted ask takes its answers with it (`on delete cascade`). So "who said yes first",
-- "who moved me to reserve" and "what were the hours before they were changed" are
-- gone the moment they stop being true. That is the argument the floor keeps having.
--
-- WHY NOT `audit_logs`. It exists and was looked at first. It is the whole app's log:
-- admin and manager read every row of it, any signed-in user can write any text into
-- it through `log_audit_event`, and it has no employee column. Giving an employee
-- their own rows there means a policy over somebody else's general log, and its
-- content is only as true as whatever the screen chose to send. This table is
-- narrower on purpose: overtime and the employee things that touch it, written only
-- by triggers on the tables themselves, so a screen cannot forget to log and cannot
-- log something that did not happen.
--
-- WHAT IS RECORDED, one row per event:
--   asks       created, edited (date, hours, headcount, audience, note), closed,
--              reopened, cancelled, deleted
--   answers    yes / no, and a changed mind
--   decisions  assigned, put on reserve, declined, removed, reserve promoted, cleared
--   outcomes   attended, no-show, called sick, cancelled (in time / late)
--   the board  a sick / holiday / unpaid day on a date the person has accepted overtime
--   rules      the no-show block and late-cancellation rule
--   access     a Permissions Matrix override on any `overtime.*` action
--
-- PRIVACY. Never a password, token or invite code: nothing here reads them. The note
-- on a `called_sick` outcome is NOT copied — the row says a note exists, not what it
-- says; the original stays where it is, behind its own policy. A board sick day is
-- recorded as the word "sick" and nothing more, which is all the board holds.
--
-- WHO READS IT. Somebody who runs overtime (`can_manage_overtime`, which is
-- `has_action('overtime.manage')`, so the Permissions Matrix decides) reads all of it.
-- Everybody else reads only the rows about themselves (`my_employee_id()`), and never
-- the rules or access rows, which are about nobody in particular.
--
-- APPEND-ONLY. No role gets insert, update or delete; the trigger functions write as
-- the owner. A guard trigger refuses UPDATE, DELETE and TRUNCATE for everyone else.
--
-- Depends on nothing from blocks 78–89 (in particular not on
-- `overtime_responses.answered_for_*`, which production does not have yet).
-- Idempotent: the history is backfilled once, only while the table is empty.

create table if not exists public.overtime_audit (
  id             bigint generated always as identity primary key,
  occurred_at    timestamptz not null default now(),
  event_type     text not null check (event_type in (
                   'opportunity_created', 'opportunity_edited', 'opportunity_closed',
                   'opportunity_reopened', 'opportunity_cancelled', 'opportunity_deleted',
                   'answered_yes', 'answered_no',
                   'assigned', 'placed_on_reserve', 'declined_by_supervisor',
                   'removed_from_overtime', 'reserve_promoted', 'decision_cleared',
                   'reassigned', 'response_deleted',
                   'attended', 'no_show', 'called_sick', 'employee_cancelled', 'outcome_removed',
                   'absence_affects_overtime',
                   'rules_changed', 'permission_override_changed')),
  -- Plain ids, no foreign keys: the record has to outlive the row it is about.
  request_id     uuid,
  response_id    uuid,
  employee_id    uuid,
  employee_name  text,
  actor_id       uuid,
  actor_name     text,
  actor_role     text,
  actor_kind     text not null check (actor_kind in ('employee', 'supervisor', 'administrator', 'system', 'other')),
  source         text not null check (source in ('employee_app', 'supervisor_interface', 'system', 'backfill', 'other')),
  on_date        date,
  shift          text,
  starts_at      time,
  ends_at        time,
  old_value      jsonb,
  new_value      jsonb,
  note           text
);

create index if not exists overtime_audit_occurred_idx on public.overtime_audit (occurred_at desc);
create index if not exists overtime_audit_employee_idx on public.overtime_audit (employee_id, occurred_at desc);
create index if not exists overtime_audit_request_idx  on public.overtime_audit (request_id, occurred_at desc);

comment on table public.overtime_audit is
  'Append-only history of overtime and the employee events that affect it. Written only '
  'by triggers. See 20261018110000.';

-- ---------------------------------------------------------------------------
-- 1. Who did it, from the session — never from anything the caller sends
-- ---------------------------------------------------------------------------
create or replace function public.overtime_audit_actor(p_uid uuid, p_employee_id uuid)
returns table (actor_name text, actor_role text, actor_kind text, source text)
language plpgsql stable security definer set search_path = public
as $$
declare
  v_role    text;
  v_self    boolean;
  v_manages boolean;
begin
  if p_uid is null then
    -- No session: a cron job, the service role, or SQL pasted in the editor.
    return query select null::text, null::text, 'system'::text, 'system'::text;
    return;
  end if;

  -- The highest role the login holds, so an admin who is also an employee reads as admin.
  select ur.role::text into v_role
    from public.user_roles ur
   where ur.user_id = p_uid
   order by case ur.role::text
              when 'admin' then 0
              when 'production_office_admin' then 1
              when 'manager' then 2
              when 'supervisor' then 3
              else 9 end
   limit 1;

  v_self := p_employee_id is not null and exists (
    select 1 from public.employees e where e.id = p_employee_id and e.user_id = p_uid);
  v_manages := public.can_manage_overtime(p_uid);

  return query select
    (select p.name from public.profiles p where p.id = p_uid),
    v_role,
    case
      when v_role = 'admin' then 'administrator'
      when v_role in ('production_office_admin', 'manager', 'supervisor') or v_manages then 'supervisor'
      when v_role = 'employee' or v_self then 'employee'
      else 'other'
    end,
    case
      when v_self then 'employee_app'
      when v_manages then 'supervisor_interface'
      else 'other'
    end;
end;
$$;

revoke all on function public.overtime_audit_actor(uuid, uuid) from public, anon, authenticated;

-- ---------------------------------------------------------------------------
-- 2. The one writer
-- ---------------------------------------------------------------------------
create or replace function public.overtime_audit_write(
  p_event       text,
  p_request_id  uuid,
  p_response_id uuid,
  p_employee_id uuid,
  p_old         jsonb,
  p_new         jsonb,
  p_note        text,
  p_actor       uuid default auth.uid(),
  p_at          timestamptz default now(),
  p_source      text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_req   public.overtime_requests;
  v_actor record;
begin
  select * into v_req from public.overtime_requests where id = p_request_id;
  select * into v_actor from public.overtime_audit_actor(p_actor, p_employee_id);

  insert into public.overtime_audit (
    occurred_at, event_type, request_id, response_id, employee_id, employee_name,
    actor_id, actor_name, actor_role, actor_kind, source,
    on_date, shift, starts_at, ends_at, old_value, new_value, note)
  values (
    p_at, p_event, p_request_id, p_response_id, p_employee_id,
    (select e.full_name from public.employees e where e.id = p_employee_id),
    p_actor, v_actor.actor_name, v_actor.actor_role, v_actor.actor_kind,
    coalesce(p_source, v_actor.source),
    -- A deleted ask is no longer in its table; its date and hours ride in the value.
    coalesce(v_req.on_date, (p_old ->> 'on_date')::date),
    coalesce(public.overtime_board_shift(v_req.on_date, v_req.starts_at), p_old ->> 'shift'),
    coalesce(v_req.starts_at, (p_old ->> 'starts_at')::time),
    coalesce(v_req.ends_at, (p_old ->> 'ends_at')::time),
    nullif(p_old, '{}'::jsonb), nullif(p_new, '{}'::jsonb), p_note);
end;
$$;

revoke all on function public.overtime_audit_write(text, uuid, uuid, uuid, jsonb, jsonb, text, uuid, timestamptz, text)
  from public, anon, authenticated;

-- Only the keys that changed, old and new side by side.
create or replace function public.overtime_audit_diff(p_old jsonb, p_new jsonb, p_keys text[])
returns table (old_value jsonb, new_value jsonb)
language sql immutable set search_path = public
as $$
  select coalesce(jsonb_object_agg(k, p_old -> k), '{}'::jsonb),
         coalesce(jsonb_object_agg(k, p_new -> k), '{}'::jsonb)
    from unnest(p_keys) k
   where (p_old -> k) is distinct from (p_new -> k);
$$;

-- ---------------------------------------------------------------------------
-- 3. The ask
-- ---------------------------------------------------------------------------
create or replace function public.overtime_audit_requests()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_fields constant text[] := array['on_date', 'starts_at', 'ends_at', 'headcount', 'department', 'shift_group', 'note'];
  v_old    jsonb;
  v_new    jsonb;
  d        record;
begin
  if tg_op = 'INSERT' then
    perform public.overtime_audit_write('opportunity_created', new.id, null, null, null,
      jsonb_build_object('on_date', new.on_date, 'starts_at', new.starts_at, 'ends_at', new.ends_at,
        'headcount', new.headcount, 'department', new.department, 'shift_group', new.shift_group,
        'status', new.status),
      new.note);
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- The ask is already gone from the table, so the date and hours go in the value.
    perform public.overtime_audit_write('opportunity_deleted', old.id, null, null,
      jsonb_build_object('on_date', old.on_date, 'starts_at', old.starts_at, 'ends_at', old.ends_at,
        'shift', public.overtime_board_shift(old.on_date, old.starts_at),
        'headcount', old.headcount, 'status', old.status),
      null, null);
    return old;
  end if;

  v_old := to_jsonb(old); v_new := to_jsonb(new);
  v_old := v_old || jsonb_build_object('shift', public.overtime_board_shift(old.on_date, old.starts_at));
  v_new := v_new || jsonb_build_object('shift', public.overtime_board_shift(new.on_date, new.starts_at));

  select * into d from public.overtime_audit_diff(v_old, v_new, v_fields || array['shift']);
  if d.new_value <> '{}'::jsonb then
    perform public.overtime_audit_write('opportunity_edited', new.id, null, null, d.old_value, d.new_value, null);
  end if;

  if new.status is distinct from old.status then
    perform public.overtime_audit_write(
      case new.status when 'cancelled' then 'opportunity_cancelled'
                      when 'closed'    then 'opportunity_closed'
                      else 'opportunity_reopened' end,
      new.id, null, null,
      jsonb_build_object('status', old.status), jsonb_build_object('status', new.status), null);
  end if;
  return new;
end;
$$;

drop trigger if exists overtime_audit_requests_t on public.overtime_requests;
create trigger overtime_audit_requests_t
  after insert or update or delete on public.overtime_requests
  for each row execute function public.overtime_audit_requests();

-- ---------------------------------------------------------------------------
-- 4. The answer and the decision
-- ---------------------------------------------------------------------------
create or replace function public.overtime_audit_decision_event(p_old text, p_new text)
returns text
language sql immutable set search_path = public
as $$
  select case
    when p_new = 'accepted' and p_old = 'reserve'  then 'reserve_promoted'
    when p_new = 'accepted'                         then 'assigned'
    when p_new = 'reserve'                          then 'placed_on_reserve'
    when p_old = 'accepted'                         then 'removed_from_overtime'
    when p_new = 'declined'                         then 'declined_by_supervisor'
    else 'decision_cleared'
  end;
$$;

create or replace function public.overtime_audit_responses()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if tg_op = 'INSERT' then
    perform public.overtime_audit_write(
      case new.answer when 'yes' then 'answered_yes' else 'answered_no' end,
      new.request_id, new.id, new.employee_id, null, jsonb_build_object('answer', new.answer), null);
    if new.decision is not null then
      perform public.overtime_audit_write(public.overtime_audit_decision_event(null, new.decision),
        new.request_id, new.id, new.employee_id, null, jsonb_build_object('decision', new.decision), null);
    end if;
    return new;
  end if;

  if tg_op = 'DELETE' then
    -- A cascade from a deleted ask lands here too; that ask is logged separately.
    perform public.overtime_audit_write(
      case when old.decision = 'accepted' then 'removed_from_overtime' else 'response_deleted' end,
      old.request_id, old.id, old.employee_id,
      jsonb_build_object('answer', old.answer, 'decision', old.decision, 'deleted', true), null, null);
    return old;
  end if;

  if new.employee_id is distinct from old.employee_id or new.request_id is distinct from old.request_id then
    perform public.overtime_audit_write('reassigned', new.request_id, new.id, new.employee_id,
      jsonb_build_object('employee_id', old.employee_id, 'request_id', old.request_id,
        'employee_name', (select full_name from public.employees where id = old.employee_id)),
      jsonb_build_object('employee_id', new.employee_id, 'request_id', new.request_id), null);
  end if;

  if new.answer is distinct from old.answer then
    perform public.overtime_audit_write(
      case new.answer when 'yes' then 'answered_yes' else 'answered_no' end,
      new.request_id, new.id, new.employee_id,
      jsonb_build_object('answer', old.answer), jsonb_build_object('answer', new.answer), null);
  end if;

  if new.decision is distinct from old.decision then
    perform public.overtime_audit_write(public.overtime_audit_decision_event(old.decision, new.decision),
      new.request_id, new.id, new.employee_id,
      jsonb_build_object('decision', old.decision), jsonb_build_object('decision', new.decision), null);
  end if;
  return new;
end;
$$;

drop trigger if exists overtime_audit_responses_t on public.overtime_responses;
create trigger overtime_audit_responses_t
  after insert or update or delete on public.overtime_responses
  for each row execute function public.overtime_audit_responses();

-- ---------------------------------------------------------------------------
-- 5. What happened on the day
-- ---------------------------------------------------------------------------
create or replace function public.overtime_audit_outcome_event(p_outcome text)
returns text
language sql immutable set search_path = public
as $$
  select case p_outcome
    when 'attended'          then 'attended'
    when 'no_show'           then 'no_show'
    when 'called_sick'       then 'called_sick'
    when 'cancelled_in_time' then 'employee_cancelled'
    when 'cancelled_late'    then 'employee_cancelled'
  end;
$$;

create or replace function public.overtime_audit_outcomes()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_resp  public.overtime_responses;
  v_row   public.overtime_outcomes := case when tg_op = 'DELETE' then old else new end;
  v_sick  boolean;
  v_old   jsonb;
  v_new   jsonb;
begin
  select * into v_resp from public.overtime_responses where id = v_row.response_id;
  if v_resp.id is null then return v_row; end if;  -- the response is being deleted too

  -- A sickness note is the person's business: say that one exists, never what it says.
  v_sick := v_row.outcome = 'called_sick' or (tg_op = 'UPDATE' and old.outcome = 'called_sick');

  if tg_op = 'DELETE' then
    perform public.overtime_audit_write('outcome_removed', v_resp.request_id, v_resp.id, v_resp.employee_id,
      jsonb_build_object('outcome', old.outcome), null, null);
    return old;
  end if;

  if tg_op = 'UPDATE' and new.outcome is not distinct from old.outcome
     and new.note is not distinct from old.note then
    return new;
  end if;

  v_new := jsonb_build_object('outcome', new.outcome)
        || case when v_sick then jsonb_build_object('note_recorded', new.note is not null) else '{}'::jsonb end;
  v_old := case when tg_op = 'UPDATE' then jsonb_build_object('outcome', old.outcome) end;

  perform public.overtime_audit_write(public.overtime_audit_outcome_event(new.outcome),
    v_resp.request_id, v_resp.id, v_resp.employee_id, v_old, v_new,
    case when v_sick then null else new.note end);
  return new;
end;
$$;

drop trigger if exists overtime_audit_outcomes_t on public.overtime_outcomes;
create trigger overtime_audit_outcomes_t
  after insert or update or delete on public.overtime_outcomes
  for each row execute function public.overtime_audit_outcomes();

-- ---------------------------------------------------------------------------
-- 6. A day off on the board, on a date with accepted overtime
-- ---------------------------------------------------------------------------
-- Only when it touches overtime: a sick day on a date with no accepted ask is the
-- board's business and is not copied here. The board row carries a status word and
-- nothing else, so nothing more than the word can leak.
create or replace function public.overtime_audit_board()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r record;
begin
  if new.status not in ('sick', 'holiday', 'unpaid') then return new; end if;
  if tg_op = 'UPDATE' and new.status is not distinct from old.status
     and new.on_date is not distinct from old.on_date then
    return new;
  end if;

  for r in
    select s.id as response_id, s.request_id
      from public.overtime_responses s
      join public.overtime_requests q on q.id = s.request_id
     where s.employee_id = new.employee_id
       and s.decision = 'accepted'
       and q.on_date = new.on_date
       and q.status <> 'cancelled'
  loop
    perform public.overtime_audit_write('absence_affects_overtime', r.request_id, r.response_id, new.employee_id,
      case when tg_op = 'UPDATE' then jsonb_build_object('board_status', old.status) end,
      jsonb_build_object('board_status', new.status, 'board_shift', new.shift), null);
  end loop;
  return new;
end;
$$;

drop trigger if exists overtime_audit_board_t on public.daily_allocations;
create trigger overtime_audit_board_t
  after insert or update of status, on_date on public.daily_allocations
  for each row execute function public.overtime_audit_board();

-- ---------------------------------------------------------------------------
-- 7. The rules and the access that decide who may have overtime
-- ---------------------------------------------------------------------------
create or replace function public.overtime_audit_rules()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare d record;
begin
  select * into d from public.overtime_audit_diff(to_jsonb(old), to_jsonb(new),
    array['no_show_block_days', 'late_cancel_hours', 'late_cancel_blocks']);
  if d.new_value <> '{}'::jsonb then
    perform public.overtime_audit_write('rules_changed', null, null, null, d.old_value, d.new_value, null);
  end if;
  return new;
end;
$$;

drop trigger if exists overtime_audit_rules_t on public.overtime_rules;
create trigger overtime_audit_rules_t
  after update on public.overtime_rules
  for each row execute function public.overtime_audit_rules();

create or replace function public.overtime_audit_permissions()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if coalesce(new.action, old.action) not like 'overtime.%' then
    return coalesce(new, old);
  end if;
  if tg_op = 'UPDATE' and new.allowed is not distinct from old.allowed
     and new.role is not distinct from old.role and new.action is not distinct from old.action then
    return new;
  end if;
  perform public.overtime_audit_write('permission_override_changed', null, null, null,
    case when tg_op <> 'INSERT' then jsonb_build_object('role', old.role, 'action', old.action, 'allowed', old.allowed) end,
    case when tg_op <> 'DELETE' then jsonb_build_object('role', new.role, 'action', new.action, 'allowed', new.allowed)
         else jsonb_build_object('deleted', true) end,
    null);
  return coalesce(new, old);
end;
$$;

drop trigger if exists overtime_audit_permissions_t on public.role_permission_overrides;
create trigger overtime_audit_permissions_t
  after insert or update or delete on public.role_permission_overrides
  for each row execute function public.overtime_audit_permissions();

-- ---------------------------------------------------------------------------
-- 8. Append-only
-- ---------------------------------------------------------------------------
create or replace function public.overtime_audit_is_append_only()
returns trigger
language plpgsql set search_path = public
as $$
begin
  raise exception 'The overtime audit is append-only' using errcode = '42501';
end;
$$;

drop trigger if exists overtime_audit_no_rewrite_t on public.overtime_audit;
create trigger overtime_audit_no_rewrite_t
  before update or delete on public.overtime_audit
  for each row execute function public.overtime_audit_is_append_only();

drop trigger if exists overtime_audit_no_truncate_t on public.overtime_audit;
create trigger overtime_audit_no_truncate_t
  before truncate on public.overtime_audit
  for each statement execute function public.overtime_audit_is_append_only();

-- ---------------------------------------------------------------------------
-- 9. Who reads it
-- ---------------------------------------------------------------------------
alter table public.overtime_audit enable row level security;
revoke all on public.overtime_audit from public, anon, authenticated;
grant select on public.overtime_audit to authenticated;

drop policy if exists "overtime_audit_read" on public.overtime_audit;
create policy "overtime_audit_read" on public.overtime_audit
  for select to authenticated
  using (
    public.can_manage_overtime(auth.uid())
    or (employee_id is not null and employee_id = public.my_employee_id())
  );

-- ---------------------------------------------------------------------------
-- 10. What already happened, once
-- ---------------------------------------------------------------------------
-- From the rows as they stand today, so the record does not start empty. Only the
-- last state of each row survives in those tables, so this is marked `backfill`:
-- an answer changed three times before today appears once, as it is now.
do $$
begin
  if exists (select 1 from public.overtime_audit) then return; end if;

  perform public.overtime_audit_write('opportunity_created', q.id, null, null, null,
            jsonb_build_object('on_date', q.on_date, 'starts_at', q.starts_at, 'ends_at', q.ends_at,
              'headcount', q.headcount, 'department', q.department, 'shift_group', q.shift_group),
            q.note, q.created_by, q.created_at, 'backfill')
     from public.overtime_requests q;

  perform public.overtime_audit_write(
            case q.status when 'cancelled' then 'opportunity_cancelled' else 'opportunity_closed' end,
            q.id, null, null, jsonb_build_object('status', 'open'), jsonb_build_object('status', q.status),
            null, null, coalesce(q.closed_at, q.created_at), 'backfill')
     from public.overtime_requests q
    where q.status <> 'open';

  perform public.overtime_audit_write(
            case r.answer when 'yes' then 'answered_yes' else 'answered_no' end,
            r.request_id, r.id, r.employee_id, null, jsonb_build_object('answer', r.answer),
            null, (select e.user_id from public.employees e where e.id = r.employee_id),
            r.answered_at, 'backfill')
     from public.overtime_responses r;

  perform public.overtime_audit_write(public.overtime_audit_decision_event(null, r.decision),
            r.request_id, r.id, r.employee_id, null, jsonb_build_object('decision', r.decision),
            null, r.decided_by, coalesce(r.decided_at, r.answered_at), 'backfill')
     from public.overtime_responses r
    where r.decision is not null;

  perform public.overtime_audit_write(public.overtime_audit_outcome_event(o.outcome),
            r.request_id, r.id, r.employee_id, null,
            jsonb_build_object('outcome', o.outcome)
              || case when o.outcome = 'called_sick' then jsonb_build_object('note_recorded', o.note is not null) else '{}'::jsonb end,
            case when o.outcome = 'called_sick' then null else o.note end,
            o.recorded_by, o.recorded_at, 'backfill')
     from public.overtime_outcomes o
     join public.overtime_responses r on r.id = o.response_id;
end;
$$;

-- ================================================================
-- BLOCO 99
-- 20261018120000_anon_was_granted_on_its_own.sql
-- ================================================================
--
-- O ANÓNIMO TINHA A SUA PRÓPRIA CHAVE: o BLOCO 82 revoga do PUBLIC, mas este
-- esquema concede EXECUTE ao anon directamente. Este bloco revoga do anon também,
-- e impede um employee de escrever a sua própria decisão (accepted) na resposta.
-- Depois: supabase/tests/anon_was_granted_on_its_own_test.sql -> ALL TESTS PASSED.

-- Nobody without a session reads the roster, and nobody accepts their own overtime.
--
-- ONE. 20261011090000_the_public_was_never_invited revokes EXECUTE from PUBLIC on the
-- overtime functions. That is not enough here. This project's `public` schema has
-- ALTER DEFAULT PRIVILEGES that grant EXECUTE to anon, authenticated and service_role
-- on every new function (measured in the database, written down in
-- 20260911120000_o_lider_e_quem_abriu_a_linha_naquele_turno.sql): a function created
-- after the 27/06 sweep carries `anon=X` of its own, which revoking from PUBLIC does
-- not touch. Its test asks `has_function_privilege('public', ...)`, so it would print
-- ALL TESTS PASSED with the door still open.
--
-- Measured 18/10/2026 with the publishable key and no session:
--   overtime_unlinked_names  200, 192 rows: id, full name, department, crew
-- and my_employee_id, my_overtime_identity, my_overtime_block, overtime_roster and
-- overtime_reliability all answered 200 (empty only because auth.uid() is null).
--
-- Nothing on the login screen calls any of these: they are all signed-in screens, and
-- no policy written for anon or PUBLIC uses them. `overtime_unlinked_names` is not
-- called by the app at all any more.
--
-- Written as a loop over to_regprocedure so a function this database does not have
-- (a block not pasted yet) is skipped instead of failing the whole paste.
--
-- TWO. "overtime_responses_own" let an employee INSERT their own row while the ask is
-- open — and checked nothing else. `insert ... (answer, decision) values ('yes',
-- 'accepted')` went in: the bridge trigger drew them on the board as overtime, past the
-- department and crew audience, the no-show block, the schedule-clash guard (which
-- skips any row that already carries a decision) and the supervisor. The app answers
-- through `answer_overtime` (security definer, not subject to this policy); the policy
-- now admits only an undecided answer, which is all an employee may write.
-- Supervisors are unaffected: they write through "overtime_responses_decide".

do $$
declare
  fn text;
begin
  foreach fn in array array[
    'public.overtime_unlinked_names()',
    'public.overtime_roster()',
    'public.overtime_reliability(date)',
    'public.my_employee_id()',
    'public.my_overtime_identity()',
    'public.my_overtime_block()',
    'public.can_manage_overtime(uuid)',
    'public.answer_overtime(uuid, text)',
    'public.link_me_to_employee(uuid)',
    'public.overtime_push_targets(uuid, uuid[])'
  ] loop
    if to_regprocedure(fn) is not null then
      execute format('revoke all on function %s from public, anon', fn);
    end if;
  end loop;
end $$;

drop policy if exists "overtime_responses_own" on public.overtime_responses;
create policy "overtime_responses_own" on public.overtime_responses
  for insert to authenticated
  with check (
    employee_id = public.my_employee_id()
    and decision is null
    and decided_at is null
    and decided_by is null
    and exists (select 1 from public.overtime_requests r
                 where r.id = request_id and r.status = 'open')
  );

-- ================================================================
-- BLOCO 100
-- 20261018130000_an_ask_rings_the_bell_of_who_can_take_it.sql
-- ================================================================
--
-- O PEDIDO TOCA A CAMPAINHA DE QUEM O PODE ACEITAR: a base escreve as notificacoes
-- quando o pedido e gravado, so para quem e elegivel (departamento, crew, sem bloqueio,
-- sem resposta, fora das suas horas), uma vez por pessoa. Depende do BLOCO 95.
-- Depois: supabase/tests/overtime_notifications_test.sql -> ALL TESTS PASSED.

-- An ask rings the bell of the people who can take it — written by the database, once.
--
-- WHAT WAS THERE. Publishing an ask called `overtime_push_targets` and then the
-- `send-push` function FROM THE SUPERVISOR'S BROWSER, after the insert. So:
--   * the notification existed only if that tab stayed open and the call succeeded;
--   * a retry wrote a second one (nothing tied a notification to an ask);
--   * the targets were department + crew only — somebody rostered on those very
--     hours, blocked for a no-show, or who had already answered, was told anyway;
--   * an edit that widened the ask told nobody new.
-- And the `notifications` rows were never read: the header bell only kept an
-- in-memory list of live events. Six functions wrote to a table no screen opened.
--
-- WHAT THIS DOES.
--   1. `notifications` learns what a row is about: `kind` and `overtime_request_id`,
--      unique per (person, kind, ask) — a second write for the same event is a no-op.
--   2. `overtime_notify_targets(ask)` — who may take it, by the rules that already
--      decide whether their yes is accepted: open, not started yet (factory clock),
--      active with a login, inside the ask's department and crew (`answer_overtime`
--      refuses anyone else), not blocked (`overtime_block_for`), not already
--      answered, and no clash with their own hours (`overtime_schedule_clash`,
--      BLOCO 95 — the board and the rota, nights across midnight included).
--   3. A trigger on `overtime_requests` writes the bell rows after an ask is created,
--      reopened, or has its date, hours, department or crew changed. Newly eligible
--      people get one; people already told are skipped by the unique key.
--      It cannot fail the ask: any error is a WARNING and the ask stands.
--   4. `overtime_ask_notified(ask)` — for the supervisor: the logins the database
--      actually told, so the confirmation is a count of rows, not a guess.
--   5. An employee may change only `read_at` on their own rows (the policy allowed
--      rewriting the title and body), and the table joins the realtime publication.
--   6. A yes to an ask that has already started is refused (only the screen hid it).
--      Supervisors recording after the fact are not affected.
--
-- DEPENDS ON BLOCO 95 (`overtime_schedule_clash`). Pasted out of order, the trigger
-- warns and writes nothing — the ask is still saved.

-- ── 1. What a notification is about ─────────────────────────────────────────
alter table public.notifications
  add column if not exists kind text,
  add column if not exists overtime_request_id uuid
    references public.overtime_requests(id) on delete cascade;

create unique index if not exists notifications_one_per_event_key
  on public.notifications (user_id, kind, overtime_request_id);
create index if not exists notifications_overtime_request_idx
  on public.notifications (overtime_request_id) where overtime_request_id is not null;
create index if not exists notifications_user_created_idx
  on public.notifications (user_id, created_at desc);

-- ── 2. Who may take it ──────────────────────────────────────────────────────
create or replace function public.overtime_notify_targets(p_request_id uuid)
returns table (employee_id uuid, user_id uuid)
-- plpgsql, not sql: a sql body is checked when it is created, and this one names
-- BLOCO 95's function. Out of order, the paste must not stop here.
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  select e.id, e.user_id
    from public.overtime_requests q
    join public.employees e
      on e.active
     and e.user_id is not null
     and (q.department  is null or q.department  is not distinct from e.department)
     and (q.shift_group is null or q.shift_group is not distinct from e.shift_group)
   where q.id = p_request_id
     and q.status = 'open'
     and (q.on_date + q.starts_at) > (now() at time zone 'Europe/London')
     and not exists (select 1 from public.overtime_responses r
                      where r.request_id = q.id and r.employee_id = e.id)
     and not exists (select 1 from public.overtime_block_for(e.id))
     and public.overtime_schedule_clash(e.id, q.id) is null;
end;
$$;

revoke all on function public.overtime_notify_targets(uuid) from public, anon, authenticated;

-- ── 3. The bell rows, written where the ask is written ──────────────────────
create or replace function public.overtime_request_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_title text := 'New overtime available';
  v_body  text;
begin
  if new.status <> 'open' then return null; end if;
  if tg_op = 'UPDATE'
     and old.status = new.status
     and old.on_date = new.on_date and old.starts_at = new.starts_at
     and old.ends_at = new.ends_at
     and old.department is not distinct from new.department
     and old.shift_group is not distinct from new.shift_group then
    return null;
  end if;

  v_body := to_char(new.on_date, 'Dy DD/MM') || ' · '
         || (case when extract(hour from new.starts_at) >= 6 and extract(hour from new.starts_at) < 18
                  then 'Day' else 'Night' end) || ' · '
         || left(new.starts_at::text, 5) || '–' || left(new.ends_at::text, 5)
         || coalesce(' · ' || new.department, '')
         || ' · need ' || new.headcount;

  begin
    insert into public.notifications
      (user_id, kind, overtime_request_id, title, body, priority, action_url)
    select t.user_id, 'overtime_new', new.id, v_title, v_body, 'medium',
           '/dashboard/my-overtime?ask=' || new.id
      from public.overtime_notify_targets(new.id) t
    on conflict (user_id, kind, overtime_request_id) do nothing;
  exception when others then
    -- The ask is the record; the bell is a courtesy. Never roll the ask back for it.
    raise warning 'overtime_request_notify(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.overtime_request_notify() from public, anon, authenticated;

drop trigger if exists overtime_request_notify_t on public.overtime_requests;
create trigger overtime_request_notify_t
  after insert or update of status, on_date, starts_at, ends_at, department, shift_group
  on public.overtime_requests
  for each row execute function public.overtime_request_notify();

-- ── 4. What the supervisor is told ──────────────────────────────────────────
create or replace function public.overtime_ask_notified(p_request_id uuid)
returns setof uuid
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.can_manage_overtime(auth.uid()) then
    raise exception 'Not allowed to manage overtime' using errcode = '42501';
  end if;
  return query
    select n.user_id from public.notifications n
     where n.overtime_request_id = p_request_id and n.kind = 'overtime_new';
end;
$$;

revoke all on function public.overtime_ask_notified(uuid) from public, anon;
grant execute on function public.overtime_ask_notified(uuid) to authenticated;

-- ── 5. Your own bell: read it, mark it read, nothing else ───────────────────
revoke update on public.notifications from anon, authenticated;
grant update (read_at) on public.notifications to authenticated;

do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime'
                        and schemaname = 'public' and tablename = 'notifications') then
    alter publication supabase_realtime add table public.notifications;
  end if;
end $$;

-- ── 6. No yes to an ask that has already started ────────────────────────────
create or replace function public.overtime_response_not_started_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  if new.answer is distinct from 'yes' then return new; end if;
  if tg_op = 'UPDATE' and old.answer is not distinct from new.answer then return new; end if;
  -- A row that already carries a decision is the supervisor's record of what happened
  -- (an employee cannot write one — BLOCO 99), not somebody signing up now.
  if new.decision is not null then return new; end if;
  -- The supervisor writes after the fact (a yes given at the desk, a correction);
  -- the service role has no uid. Only somebody answering for themselves is held.
  if auth.uid() is null or public.can_manage_overtime(auth.uid()) then return new; end if;
  if exists (select 1 from public.overtime_requests q
              where q.id = new.request_id
                and (q.on_date + q.starts_at) <= (now() at time zone 'Europe/London')) then
    raise exception 'This overtime has already started' using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.overtime_response_not_started_guard() from public, anon, authenticated;

drop trigger if exists overtime_response_not_started_guard_t on public.overtime_responses;
create trigger overtime_response_not_started_guard_t
  before insert or update of answer on public.overtime_responses
  for each row execute function public.overtime_response_not_started_guard();

-- ================================================================
-- BLOCO 101
-- 20261018140000_an_ask_holds_only_the_places_it_has.sql
-- ================================================================
--
-- UM PEDIDO SO DA OS LUGARES QUE TEM: a base recusa aceitar alem do headcount e
-- baixar o headcount abaixo de quem ja foi aceite; overtime_places() da ao chao a
-- contagem de lugares (nunca nomes). Nao depende de nenhum bloco recente.
-- Depois: supabase/tests/overtime_capacity_test.sql -> ALL TESTS PASSED.

-- An ask holds only the places it has.
--
-- WHAT WAS THERE. `overtime_requests.headcount` was a number on a card and nothing
-- else. Accepting is the supervisor's `decision = 'accepted'` on `overtime_responses`,
-- a plain update, and nothing — not the database, not the screen — counted it against
-- the headcount. Two supervisors on two screens, or one on a stale one, could accept a
-- fifth person onto an ask for four, and the board then carried five overtime rows for
-- four places. Lowering the headcount below the people already accepted did the same
-- from the other side: the card said "4 of 2 picked" and nobody was told.
--
-- And the floor could not see how many places were left: the read policy on
-- `overtime_responses` shows an employee only their own row, so their phone could
-- say "4 people needed" but never "1 place left".
--
-- WHAT THIS DOES.
--   1. `overtime_places_taken(ask)` — the one count: accepted and still coming. Somebody
--      accepted who then dropped out (an outcome other than 'attended') no longer holds
--      a place, which is the same rule `record_overtime_outcome` uses when it promotes
--      the reserve into the gap.
--   2. A trigger on `overtime_responses` refuses an accept that would go past the
--      headcount. It locks the ask row first, so two accepts racing for the last place
--      are served one after the other and the second is refused. It applies to everyone,
--      the supervisor included: the way to take a sixth person is to raise the headcount,
--      which the card shows, not to overfill it, which nothing showed.
--   3. A trigger on `overtime_requests` refuses lowering the headcount below the people
--      already accepted. Nobody's place is taken away by an edit; the supervisor moves
--      someone to reserve first, and then they are the one who tells them.
--   4. `overtime_places(ids[])` — taken and headcount per ask, for any signed-in person.
--      Counts only, never names: an employee learns "1 place left", not who has the rest.
--
-- No column, no change to who may read or write what.

create or replace function public.overtime_places_taken(p_request_id uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::int
    from public.overtime_responses r
   where r.request_id = p_request_id
     and r.decision = 'accepted'
     and not exists (select 1 from public.overtime_outcomes o
                      where o.response_id = r.id and o.outcome <> 'attended');
$$;

revoke all on function public.overtime_places_taken(uuid) from public, anon;
grant execute on function public.overtime_places_taken(uuid) to authenticated;

-- 2. An accept past the headcount is refused.
create or replace function public.overtime_response_capacity_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_headcount integer;
  v_taken     integer;
begin
  if new.decision is distinct from 'accepted' then return new; end if;
  if tg_op = 'UPDATE' and old.decision = 'accepted' and old.request_id = new.request_id then
    return new;
  end if;

  -- One accept at a time per ask: the second waits here for the first to commit.
  select headcount into v_headcount
    from public.overtime_requests where id = new.request_id for update;
  if v_headcount is null then return new; end if;  -- the FK reports a missing ask

  select count(*)::int into v_taken
    from public.overtime_responses r
   where r.request_id = new.request_id
     and r.decision = 'accepted'
     and r.id <> new.id
     and not exists (select 1 from public.overtime_outcomes o
                      where o.response_id = r.id and o.outcome <> 'attended');

  if v_taken >= v_headcount then
    raise exception 'All % places on this overtime are filled. Put them on reserve, or raise the number of people needed first.',
      v_headcount using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.overtime_response_capacity_guard() from public, anon, authenticated;

drop trigger if exists overtime_response_capacity_guard_t on public.overtime_responses;
create trigger overtime_response_capacity_guard_t
  before insert or update of decision, request_id on public.overtime_responses
  for each row execute function public.overtime_response_capacity_guard();

-- 3. The headcount cannot drop below the people already in.
create or replace function public.overtime_request_headcount_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_taken integer;
begin
  if new.headcount >= old.headcount then return new; end if;
  v_taken := public.overtime_places_taken(new.id);
  if new.headcount < v_taken then
    raise exception '% people are already accepted on this overtime, so it can''t need fewer than %. Move someone to reserve first.',
      v_taken, v_taken using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.overtime_request_headcount_guard() from public, anon, authenticated;

drop trigger if exists overtime_request_headcount_guard_t on public.overtime_requests;
create trigger overtime_request_headcount_guard_t
  before update of headcount on public.overtime_requests
  for each row execute function public.overtime_request_headcount_guard();

-- 4. Places per ask, for the floor.
create or replace function public.overtime_places(p_request_ids uuid[])
returns table (request_id uuid, taken integer, headcount integer)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if coalesce(array_length(p_request_ids, 1), 0) > 200 then
    raise exception 'At most 200 asks a call' using errcode = 'P0001';
  end if;
  return query
    select q.id, public.overtime_places_taken(q.id), q.headcount
      from public.overtime_requests q
     where q.id = any(p_request_ids);
end;
$$;

revoke all on function public.overtime_places(uuid[]) from public, anon;
grant execute on function public.overtime_places(uuid[]) to authenticated;

-- ================================================================
-- BLOCO 102
-- 20261018160000_a_yes_is_a_booking.sql
-- ================================================================
--
-- UM SIM E UMA MARCACAO: o numero de pessoas passa a opcional; o sim do proprio
-- empregado fica logo aceite (ou reserva, se o pedido tem numero e esta cheio); o
-- empregado e quem publicou o pedido recebem um alerta; o empregado pode escrever
-- ao supervisor no chat (message_overtime_supervisor) e o supervisor pode responder.
-- Nao depende do BLOCO 101 nem do 87. COLAR ANTES de fazer merge do PR.
-- Depois: supabase/tests/overtime_yes_is_a_booking_test.sql -> ALL TESTS PASSED.

-- A yes is a booking. The ask says when, not how many.
--
-- WHAT WAS THERE. An ask carried a number ("10 people needed"), every yes waited for a
-- supervisor to press Accept, and only an accepted yes reached the board. On the floor
-- that is not how overtime is run: the supervisor asks, whoever says yes comes in, and
-- the supervisor wants to KNOW who said yes, not to approve each of them. The number
-- was a guess typed into a box, and the Accept press was a second step that left
-- people who had said yes unsure whether they were coming.
--
-- WHAT THIS DOES.
--   1. `overtime_requests.headcount` is optional. Empty: everybody who says yes is
--      booked. A number: the first that many are booked and the rest go on reserve.
--   2. A person's own yes is booked as it is written (a trigger, so it holds whatever
--      body of `answer_overtime` the database runs). Everything that already refused
--      a yes — audience, block, clash, started — still refuses it first. Booked is
--      `accepted`, which is what draws it on the board (the bridge trigger). After
--      that the phone cannot take it back (`answer_overtime` refuses a decided row):
--      a booked shift is changed by talking to the supervisor (4).
--   3. Two bell rows: the person ("You're booked") and whoever posted the ask
--      ("Ana is coming in").
--   4. `message_overtime_supervisor(ask, text)`: the employee writes to whoever posted
--      the ask, in the app's chat (`direct_messages`). The chat's routing policy only
--      lets operators and staff write, so this goes through a function that checks the
--      one case it allows: a linked employee, about an ask they can see, to the person
--      who posted it. The supervisor gets a bell row too.
--   5. "dm_insert_reply": anybody may answer somebody who wrote to them. Without it
--      the supervisor could read the employee in Messages and not reply. Added beside
--      the routing policy, not in place of it (permissive policies OR together).
--
-- No row is rewritten: answers already given keep their decision, or lack of one.

-- ── 1. No number needed ─────────────────────────────────────────────────────
alter table public.overtime_requests alter column headcount drop not null;

-- The bell text for a new ask read "need " || headcount, which is NULL for an ask
-- with no number — and a NULL body is a failed insert, swallowed by the warning.
create or replace function public.overtime_request_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_title text := 'New overtime available';
  v_body  text;
begin
  if new.status <> 'open' then return null; end if;
  if tg_op = 'UPDATE'
     and old.status = new.status
     and old.on_date = new.on_date and old.starts_at = new.starts_at
     and old.ends_at = new.ends_at
     and old.department is not distinct from new.department
     and old.shift_group is not distinct from new.shift_group then
    return null;
  end if;

  v_body := to_char(new.on_date, 'Dy DD/MM') || ' · '
         || (case when extract(hour from new.starts_at) >= 6 and extract(hour from new.starts_at) < 18
                  then 'Day' else 'Night' end) || ' · '
         || left(new.starts_at::text, 5) || '–' || left(new.ends_at::text, 5)
         || coalesce(' · ' || new.department, '')
         -- An ask with no number (BLOCO 102) says nothing about one.
         || coalesce(' · need ' || new.headcount, '');

  begin
    insert into public.notifications
      (user_id, kind, overtime_request_id, title, body, priority, action_url)
    select t.user_id, 'overtime_new', new.id, v_title, v_body, 'medium',
           '/dashboard/my-overtime?ask=' || new.id
      from public.overtime_notify_targets(new.id) t
    on conflict (user_id, kind, overtime_request_id) do nothing;
  exception when others then
    -- The ask is the record; the bell is a courtesy. Never roll the ask back for it.
    raise warning 'overtime_request_notify(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

-- ── 2. A yes is a booking ───────────────────────────────────────────────────
-- A trigger, not a new `answer_overtime`. Production runs an older body of that
-- function than the repository's newest (BLOCO 87 is not in), and the catch-up paste
-- would put 87's body back over any later one. A trigger on the row is the same in
-- either state: whatever writes the person's own yes, the row comes out booked.
--
-- Named so it runs LAST among the BEFORE triggers (they fire in name order): the
-- schedule-clash and not-started guards read the row while it is still a fresh,
-- undecided yes, and refuse it before it is booked. The capacity guard (BLOCO 101)
-- has already passed an undecided row by then, so the number is counted here.
create or replace function public.overtime_response_book_on_yes()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_req   public.overtime_requests;
  v_user  uuid;
  v_name  text;
  v_taken integer := 0;
  v_when  text;
begin
  if new.answer is distinct from 'yes' or new.decision is not null then return new; end if;
  if tg_op = 'UPDATE' and old.answer = 'yes' then return new; end if;

  -- Only the person's own yes, from their own login. A yes typed in at the desk by a
  -- supervisor stays undecided: the supervisor accepts it, as before.
  select user_id, full_name into v_user, v_name from public.employees where id = new.employee_id;
  if auth.uid() is null or v_user is distinct from auth.uid() then return new; end if;

  -- Locked: two yeses racing for the last numbered place are served in turn.
  select * into v_req from public.overtime_requests where id = new.request_id for update;
  if v_req.id is null or v_req.status <> 'open' then return new; end if;

  if v_req.headcount is not null then
    select count(*)::int into v_taken
      from public.overtime_responses r
     where r.request_id = new.request_id and r.decision = 'accepted' and r.id <> new.id
       and not exists (select 1 from public.overtime_outcomes o
                        where o.response_id = r.id and o.outcome <> 'attended');
  end if;

  new.decision   := case when v_req.headcount is not null and v_taken >= v_req.headcount
                         then 'reserve' else 'accepted' end;
  new.decided_at := now();
  new.decided_by := auth.uid();

  -- 3. Tell the person and whoever posted the ask. A courtesy: never undo the booking.
  v_when := to_char(v_req.on_date, 'Dy DD/MM') || ' · ' || left(v_req.starts_at::text, 5)
            || '–' || left(v_req.ends_at::text, 5) || coalesce(' · ' || v_req.department, '');
  begin
    insert into public.notifications (user_id, kind, title, body, priority, action_url)
    values (v_user, 'overtime_booked',
            case when new.decision = 'accepted' then 'You''re booked for overtime'
                 else 'You''re on the overtime reserve list' end,
            v_when, 'medium', '/dashboard/my-overtime?ask=' || v_req.id);
    if v_req.created_by is not null and v_req.created_by <> v_user then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (v_req.created_by, 'overtime_yes',
              coalesce(v_name, 'Somebody') ||
                case when new.decision = 'accepted' then ' is coming in' else ' said yes (on reserve)' end,
              v_when, 'medium', '/dashboard/overtime');
    end if;
  exception when others then
    raise warning 'overtime_response_book_on_yes notify(%): %', new.request_id, sqlerrm;
  end;
  return new;
end;
$$;

revoke all on function public.overtime_response_book_on_yes() from public, anon, authenticated;

drop trigger if exists overtime_response_zz_book_on_yes_t on public.overtime_responses;
create trigger overtime_response_zz_book_on_yes_t
  before insert or update of answer on public.overtime_responses
  for each row execute function public.overtime_response_book_on_yes();

-- ── 4. A word to the supervisor ─────────────────────────────────────────────
create or replace function public.message_overtime_supervisor(p_request_id uuid, p_message text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_emp   uuid := public.my_employee_id();
  v_req   public.overtime_requests;
  v_dept  text;
  v_shift text;
  v_name  text;
  v_text  text := btrim(coalesce(p_message, ''));
  v_id    uuid;
begin
  if v_emp is null then
    raise exception 'No employee record is linked to this login' using errcode = 'P0001';
  end if;
  if length(v_text) = 0 then
    raise exception 'Write a message first' using errcode = 'P0001';
  end if;
  if length(v_text) > 1000 then
    raise exception 'Keep it under 1000 characters' using errcode = 'P0001';
  end if;

  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'No such overtime' using errcode = 'P0001';
  end if;
  select department, shift_group, full_name into v_dept, v_shift, v_name
    from public.employees where id = v_emp;
  -- Only about an ask this person answered, or one that was put to them.
  if not exists (select 1 from public.overtime_responses where request_id = p_request_id and employee_id = v_emp)
     and ((v_req.department is not null and v_req.department is distinct from v_dept)
       or (v_req.shift_group is not null and v_req.shift_group is distinct from v_shift)) then
    raise exception 'This overtime was not asked of you' using errcode = 'P0001';
  end if;
  if v_req.created_by is null or v_req.created_by = auth.uid() then
    raise exception 'Nobody to send it to: this overtime has no supervisor on file' using errcode = 'P0001';
  end if;

  insert into public.direct_messages (sender_id, sender_name, recipient_id, message)
  values (
    auth.uid(), coalesce(v_name, 'Employee'), v_req.created_by,
    'Overtime ' || to_char(v_req.on_date, 'Dy DD/MM') || ' ' || left(v_req.starts_at::text, 5)
      || '–' || left(v_req.ends_at::text, 5) || ': ' || v_text)
  returning id into v_id;

  begin
    insert into public.notifications (user_id, kind, title, body, priority, action_url)
    values (v_req.created_by, 'overtime_message',
            coalesce(v_name, 'An employee') || ' sent you a message',
            left(v_text, 200), 'medium', '/dashboard/messages');
  exception when others then
    raise warning 'message_overtime_supervisor notify(%): %', p_request_id, sqlerrm;
  end;
  return v_id;
end;
$$;

revoke all on function public.message_overtime_supervisor(uuid, text) from public, anon;
grant execute on function public.message_overtime_supervisor(uuid, text) to authenticated;

-- ── 5. Anybody may answer somebody who wrote to them ────────────────────────
drop policy if exists "dm_insert_reply" on public.direct_messages;
create policy "dm_insert_reply" on public.direct_messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and sender_id <> recipient_id
    and exists (select 1 from public.direct_messages d
                 where d.sender_id = direct_messages.recipient_id
                   and d.recipient_id = auth.uid())
  );

-- ================================================================
-- BLOCO 103
-- 20261019090000_a_cancelled_ask_is_nobodys_fault.sql
-- ================================================================
--
-- UM PEDIDO CANCELADO NAO E CULPA DE NINGUEM: reabrir um pedido cancelado devolve
-- os aceites ao board; a fiabilidade deixa de contar pedidos cancelados como
-- "aceite e nao veio"; sai a policy que deixava escrever uma resposta sem passar
-- pelo answer_overtime. Depois do 102. Pode colar-se duas vezes.
-- Three overtime defects found in the 18/10 stabilisation pass, each read against
-- production first. Idempotent; nothing here deletes or rewrites a stored answer.
--
-- ONE. "overtime_responses_own" let an employee INSERT their own undecided answer
-- straight through PostgREST, past the department/crew audience and the no-show block
-- that only answer_overtime checks. Since block 102 a "yes" from the person's own
-- login is decided by the BEFORE trigger, so WITH CHECK (decision is null) now refuses
-- it — tested locally, with and without that trigger — and what is left is a "no"
-- written around the RPC. The app never used the policy: employees answer through
-- answer_overtime (security definer), supervisors through "overtime_responses_decide".
-- Dropped, so the RPC is the only way an employee writes an answer.
--
-- TWO. Reopening a cancelled ask left its accepted people off the board. Cancelling
-- deletes the ask's daily_allocations rows (overtime_request_to_board); nothing put
-- them back on cancelled -> open/closed, while the answers still said accepted and
-- the card showed them as picked. The board rows come back through the same
-- overtime_board_apply the decision uses, which already refuses a cancelled ask and
-- never overwrites a row the planner made.
--
-- THREE. overtime_reliability's 60-day "x of y worked" counted every accepted answer,
-- including those on asks the supervisor cancelled — read as accepted and not
-- attended, lowering the ratio and the order sortCandidates offers people in. The
-- body is 20261012160000's unchanged but for the cancelled filter in ot_60. Same
-- signature and columns, so create or replace keeps the grants.

-- ── ONE ─────────────────────────────────────────────────────────────────────
drop policy if exists "overtime_responses_own" on public.overtime_responses;

-- ── TWO ─────────────────────────────────────────────────────────────────────
create or replace function public.overtime_request_to_board()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r record;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    delete from public.daily_allocations where overtime_request_id = new.id;
  elsif old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    for r in select employee_id from public.overtime_responses
              where request_id = new.id and decision = 'accepted'
    loop
      perform public.overtime_board_apply(new.id, r.employee_id, true);
    end loop;
  end if;
  return new;
end;
$$;

-- ── THREE ───────────────────────────────────────────────────────────────────
create or replace function public.overtime_reliability(p_month date default current_date)
returns table (
  employee_id        uuid,
  sick_this_month    integer,
  absent_this_month  integer,
  ot_accepted_60d    integer,
  ot_attended_60d    integer,
  blocked_until      date
)
language sql stable security definer set search_path = public
as $$
  with bounds as (
    select date_trunc('month', p_month)::date                       as m_from,
           (date_trunc('month', p_month) + interval '1 month')::date as m_to,
           (current_date - 60)                                        as d60
  ),
  board as (
    select a.employee_id,
           count(*) filter (where a.status = 'sick')                       as sick,
           count(*) filter (where a.status in ('unpaid', 'absent', 'awol')) as absent
      from public.employee_attendance a, bounds b
     where a.on_date >= b.m_from and a.on_date < b.m_to
     group by a.employee_id
  ),
  clocks as (
    select d.employee_id,
           count(*) filter (where d.absence_name ~* 'sick')                                 as sick,
           count(*) filter (where d.absence_name is not null
                              and d.absence_name !~* 'sick'
                              and d.absence_name !~* 'holiday|vacation|annual')               as absent
      from public.attendance_days d, bounds b
     where d.on_date >= b.m_from and d.on_date < b.m_to
     group by d.employee_id
  ),
  ot_month as (
    select r.employee_id,
           count(*) filter (where o.outcome = 'called_sick')                          as sick,
           count(*) filter (where o.outcome in ('no_show', 'cancelled_late'))          as absent
      from public.overtime_outcomes o
      join public.overtime_responses r on r.id = o.response_id
      join public.overtime_requests q on q.id = r.request_id, bounds b
     where q.on_date >= b.m_from and q.on_date < b.m_to
     group by r.employee_id
  ),
  ot_60 as (
    select r.employee_id,
           count(*)                                            as accepted,
           count(*) filter (where o.outcome = 'attended')      as attended
      from public.overtime_responses r
      join public.overtime_requests q on q.id = r.request_id
      left join public.overtime_outcomes o on o.response_id = r.id, bounds b
     where r.decision = 'accepted' and q.status <> 'cancelled'
       and q.on_date >= b.d60 and q.on_date <= current_date
     group by r.employee_id
  ),
  ids as (
    select employee_id from board
    union select employee_id from clocks
    union select employee_id from ot_month
    union select employee_id from ot_60
  )
  select i.employee_id,
         coalesce(b.sick, 0) + coalesce(c.sick, 0) + coalesce(m.sick, 0),
         coalesce(b.absent, 0) + coalesce(c.absent, 0) + coalesce(m.absent, 0),
         coalesce(s.accepted, 0),
         coalesce(s.attended, 0),
         (select blocked_until from public.overtime_block_for(i.employee_id))
    from ids i
    left join board    b on b.employee_id = i.employee_id
    left join clocks   c on c.employee_id = i.employee_id
    left join ot_month m on m.employee_id = i.employee_id
    left join ot_60    s on s.employee_id = i.employee_id
   -- Everybody else gets no rows: the same answer as "nobody was off this month",
   -- which is what an empty column beside a name already means on the manager's panel.
   where public.can_manage_overtime(auth.uid());
$$;

revoke all on function public.overtime_reliability(date) from public;
grant execute on function public.overtime_reliability(date) to authenticated;

-- ================================================================
-- BLOCO 103b
-- 20261019095000_a_reply_rule_cannot_read_its_own_table.sql
-- ================================================================
--
-- CORRIGE O BLOCO 102: a regra dm_insert_reply lia a propria tabela e o Postgres
-- recusava TODAS as mensagens do chat (42P17). Ja colado a mao a 19/10
-- (COLAR-102b-corrige-chat.sql); colar de novo nao faz mal.

-- A reply rule cannot read its own table.
--
-- WHAT WAS THERE. BLOCO 102 added "dm_insert_reply" — anybody may answer somebody who
-- wrote to them — as a policy on `direct_messages` whose check asked
-- `exists (select 1 from public.direct_messages ...)`. A policy that reads its own
-- table makes Postgres expand that table's policies inside themselves, and production
-- refused it: `42P17 infinite recursion detected in policy for relation
-- "direct_messages"`. Every INSERT evaluates every permissive INSERT policy, so it was
-- not only replies that failed but every message sent in the app's chat, from the
-- paste of 102 (18/10 evening) until this one (19/10). The local test database did
-- not reproduce it; production did, on the first run of the 102 test.
--
-- WHAT THIS DOES. The question "has this person written to me?" moves into a SECURITY
-- DEFINER function, which reads the table without applying its policies — so nothing
-- recurses. It answers only about messages addressed to whoever asks, so nobody can
-- use it to learn who wrote to somebody else. Same rule, same name.
--
-- Pasted by hand on 19/10 before this file existed (COLAR-102b-corrige-chat.sql),
-- verified by probe: dm_wrote_to_me answers 401 to anon.
--
-- Guarded since: src/__tests__/aPolicyNeverReadsItsOwnTable.test.ts.

create or replace function public.dm_wrote_to_me(p_from uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  -- So responde sobre mensagens dirigidas a quem pergunta: ninguem descobre quem
  -- escreveu a outra pessoa.
  select exists (select 1 from public.direct_messages
                  where sender_id = p_from and recipient_id = auth.uid());
$$;
revoke all on function public.dm_wrote_to_me(uuid) from public, anon;
grant execute on function public.dm_wrote_to_me(uuid) to authenticated;

drop policy if exists "dm_insert_reply" on public.direct_messages;
create policy "dm_insert_reply" on public.direct_messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and sender_id <> recipient_id
    and public.dm_wrote_to_me(recipient_id)
  );

-- ================================================================
-- BLOCO 104
-- 20261019100000_login_only_functions_shut_out_anon.sql
-- ================================================================
--
-- O ANONIMO FORA DAS FUNCOES DE QUEM TEM LOGIN: my_attendance, login_link_candidates,
-- link/unlink_login, overtime_block_for e record_overtime_outcome deixam de responder
-- a chave publicavel. Faz o teste an_employee_sees_only_their_own passar. Independente.
-- Functions for signed-in people only stop answering the anonymous key.
--
-- Same hole as 20261018120000: these were revoked from PUBLIC and granted to
-- authenticated, but this schema's default privileges grant anon EXECUTE by name, so
-- the publishable key could still call them. Measured 19/10/2026 in production with
-- has_function_privilege('anon', ...): true for all six. None leaked data on that day —
-- each refuses a null auth.uid() inside ("Sign in to see your attendance", "Not
-- allowed to link accounts"), and overtime_block_for answered an empty set — but the
-- body is then the only wall, and supabase/tests/an_employee_sees_only_their_own_test.sql
-- fails on my_attendance until the grant is gone.
--
-- Left open on purpose: the login screen's own functions (check_invite_code,
-- get_login_branding, list_tablet_accounts_public, signup_invite_code) and trigger
-- functions, which cannot be called as RPCs.
--
-- Idempotent. Guarded by to_regprocedure, so a function a later migration drops does
-- not stop the paste.

do $$
declare fn text;
begin
  foreach fn in array array[
    'public.my_attendance(date, date)',
    'public.login_link_candidates()',
    'public.link_login_to_employee(uuid, uuid)',
    'public.unlink_login_from_employee(uuid)',
    'public.overtime_block_for(uuid)',
    'public.record_overtime_outcome(uuid, text, text)'
  ] loop
    if to_regprocedure(fn) is not null then
      execute format('revoke execute on function %s from anon', fn);
    end if;
  end loop;
end $$;

-- ================================================================
-- BLOCO 105
-- 20261019110000_a_yes_already_given_is_booked_too.sql
-- ================================================================
--
-- O SIM JA DADO TAMBEM FICA MARCADO: os SIM que estavam a espera do supervisor antes
-- do BLOCO 102 ficam marcados (os primeiros N num pedido com numero; o resto em
-- reserva), e um SIM escrito pelo supervisor tambem marca. Quem tem choque de horario
-- ou bloqueio fica para o supervisor decidir. Um "nao" mudado para "sim" passa a
-- chegar ao board, e o sino toca uma vez por marcacao. Precisa dos BLOCOS 95, 101, 102.
-- No fim aparece: BLOCO 105: N booked, N on reserve, N left for the supervisor.
--
-- A yes already given is booked too, and so is a yes the supervisor types in.
--
-- WHAT WAS THERE. BLOCO 102 books a person's own yes as it is written — and rewrote
-- no row. Every yes given before it was pasted still sat at "Awaiting decision" on the
-- supervisor's card, waiting for an Accept the floor no longer expects to need. And a
-- yes the supervisor typed in at the desk (somebody who said yes on the phone, or who
-- has no login) stayed undecided by design, so the card asked the same person who had
-- just recorded the yes to accept it as a second step.
--
-- And 102 wrote its bell rows from the BEFORE trigger. The desk writes with an upsert
-- (INSERT … ON CONFLICT DO UPDATE): the BEFORE INSERT trigger runs on the proposed row
-- even when the conflict turns it into an update, so a yes over an earlier answer rang
-- the bell twice, and a yes over a yes rang it for nothing.
--
-- The rule the user gave on 19/10: when an employee says yes, it is confirmed. The
-- supervisor is told, not asked.
--
-- WHAT THIS DOES.
--   1. `overtime_response_book_on_yes` (BEFORE) only decides. It books a desk yes as
--      well: when somebody who runs overtime (`can_manage_overtime`) writes a yes for a
--      person. Not past what the ask can hold, and NOT when the person is blocked or
--      their own hours clash: the phone refuses those (BLOCO 95 guard), the desk does
--      not, so the yes stays undecided with the clash on the card for the supervisor.
--   2. `overtime_response_booked_notify` (AFTER, only on a real change of decision to
--      accepted or reserve): the person is told ("You're booked" / reserve), and whoever
--      posted the ask is told ("Ana is coming in") unless they are the one who did it.
--      One row per change, whichever way it was made — own yes, desk yes, Accept.
--      The board bridge (BLOCO 93) is widened the same way: a "no" later changed to a
--      "yes" was booked by 102 but never drawn on the board.
--   3. Once, now: every undecided yes on an ask that is open and has not started is
--      booked by the same rule — oldest answer first, one ask at a time, `reserve` once
--      a numbered ask is full (the BLOCO 101 capacity guard would refuse an `accepted`),
--      skipped when blocked or clashing. Each person is told by (2); the poster is not
--      flooded with the backlog. The board bridge (BLOCO 93) draws each booking.
--      Asks already started, closed or cancelled are left exactly as they are.
--
-- No policy is created or changed. Depends on BLOCOS 95 (overtime_schedule_clash),
-- 101 (overtime_places_taken) and 102. Idempotent: a second paste books nobody.

-- ── 1. Deciding: an own yes, or a desk yes ──────────────────────────────────
create or replace function public.overtime_response_book_on_yes()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_req   public.overtime_requests;
  v_user  uuid;
  v_taken integer := 0;
  v_desk  boolean;
begin
  if new.answer is distinct from 'yes' or new.decision is not null then return new; end if;
  if tg_op = 'UPDATE' and old.answer = 'yes' then return new; end if;
  if auth.uid() is null then return new; end if;

  select user_id into v_user from public.employees where id = new.employee_id;
  -- The person's own yes, or a supervisor writing it for them. Nobody else.
  v_desk := v_user is distinct from auth.uid();
  if v_desk and not public.can_manage_overtime(auth.uid()) then return new; end if;

  -- The phone's yes already passed the block and clash guards. The desk's did not:
  -- left undecided, the card shows the clash and the supervisor decides.
  if v_desk and (exists (select 1 from public.overtime_block_for(new.employee_id))
                 or public.overtime_schedule_clash(new.employee_id, new.request_id) is not null) then
    return new;
  end if;

  -- Locked: two yeses racing for the last numbered place are served in turn.
  select * into v_req from public.overtime_requests where id = new.request_id for update;
  if v_req.id is null or v_req.status <> 'open' then return new; end if;

  if v_req.headcount is not null then
    select count(*)::int into v_taken
      from public.overtime_responses r
     where r.request_id = new.request_id and r.decision = 'accepted' and r.id <> new.id
       and not exists (select 1 from public.overtime_outcomes o
                        where o.response_id = r.id and o.outcome <> 'attended');
  end if;

  new.decision   := case when v_req.headcount is not null and v_taken >= v_req.headcount
                         then 'reserve' else 'accepted' end;
  new.decided_at := now();
  new.decided_by := auth.uid();
  return new;
end;
$$;

revoke all on function public.overtime_response_book_on_yes() from public, anon, authenticated;

-- ── 2. Telling: after the row really changed ────────────────────────────────
create or replace function public.overtime_response_booked_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_req  public.overtime_requests;
  v_user uuid;
  v_name text;
  v_when text;
begin
  if new.decision is null or new.decision not in ('accepted', 'reserve') then return null; end if;
  if tg_op = 'UPDATE' and old.decision is not distinct from new.decision then return null; end if;

  begin
    select * into v_req from public.overtime_requests where id = new.request_id;
    select user_id, full_name into v_user, v_name from public.employees where id = new.employee_id;
    v_when := to_char(v_req.on_date, 'Dy DD/MM') || ' · ' || left(v_req.starts_at::text, 5)
              || '–' || left(v_req.ends_at::text, 5) || coalesce(' · ' || v_req.department, '');

    if v_user is not null then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (v_user, 'overtime_booked',
              case when new.decision = 'accepted' then 'You''re booked for overtime'
                   else 'You''re on the overtime reserve list' end,
              v_when, 'medium', '/dashboard/my-overtime?ask=' || v_req.id);
    end if;
    -- The poster, unless they did it themselves, or nobody did (the one-off backlog).
    if auth.uid() is not null and v_req.created_by is not null
       and v_req.created_by <> auth.uid() and v_req.created_by is distinct from v_user then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (v_req.created_by, 'overtime_yes',
              coalesce(v_name, 'Somebody') ||
                case when new.decision = 'accepted' then ' is coming in' else ' said yes (on reserve)' end,
              v_when, 'medium', '/dashboard/overtime');
    end if;
  exception when others then
    -- The booking is the record; the bell is a courtesy. Never undo it for the bell.
    raise warning 'overtime_response_booked_notify(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;

revoke all on function public.overtime_response_booked_notify() from public, anon, authenticated;

drop trigger if exists overtime_response_booked_notify_t on public.overtime_responses;
-- `update of decision, answer`, not `of decision`: an UPDATE OF trigger fires on the
-- columns the statement SETS, and the yes that books arrives as `set answer = 'yes'`
-- (the upsert of answer_overtime and of the desk) — the decision is changed by the
-- BEFORE trigger, which an `of decision` trigger never sees.
create trigger overtime_response_booked_notify_t
  after insert or update of decision, answer on public.overtime_responses
  for each row execute function public.overtime_response_booked_notify();

-- The board bridge (BLOCO 93) had the same blind spot: a "no" changed to "yes" was
-- booked by 102 and never reached the board. Same function, wider trigger. It is
-- idempotent (overtime_board_apply draws or clears to match the row).
drop trigger if exists overtime_response_to_board_t on public.overtime_responses;
create trigger overtime_response_to_board_t
  after insert or update of decision, answer on public.overtime_responses
  for each row execute function public.overtime_response_to_board();

-- ── 3. The yeses already waiting, booked once ───────────────────────────────
-- A function, so the SQL test can run exactly what the paste ran. Nobody may call it
-- but the owner: it is run once, below.
create or replace function public.overtime_book_waiting_yeses(
  out booked integer, out reserved integer, out left_for_supervisor integer)
language plpgsql security definer set search_path = public
as $$
declare
  q       record;
  r       record;
  v_taken integer;
  v_dec   text;
begin
  booked := 0; reserved := 0; left_for_supervisor := 0;
  for q in
    select * from public.overtime_requests
     where status = 'open'
       and (on_date + starts_at) > (now() at time zone 'Europe/London')
     order by on_date, starts_at, created_at
     for update
  loop
    v_taken := public.overtime_places_taken(q.id);

    for r in
      select rs.id, rs.employee_id, e.user_id
        from public.overtime_responses rs
        join public.employees e on e.id = rs.employee_id
       where rs.request_id = q.id and rs.answer = 'yes' and rs.decision is null
       order by rs.answered_at, rs.id
    loop
      if exists (select 1 from public.overtime_block_for(r.employee_id))
         or public.overtime_schedule_clash(r.employee_id, q.id) is not null then
        left_for_supervisor := left_for_supervisor + 1;
        continue;
      end if;

      v_dec := case when q.headcount is not null and v_taken >= q.headcount
                    then 'reserve' else 'accepted' end;
      update public.overtime_responses
         set decision = v_dec, decided_at = now(), decided_by = r.user_id
       where id = r.id and decision is null;
      if v_dec = 'accepted' then v_taken := v_taken + 1; booked := booked + 1;
      else reserved := reserved + 1; end if;
    end loop;
  end loop;
end;
$$;

revoke all on function public.overtime_book_waiting_yeses() from public, anon, authenticated;

do $$
declare v record;
begin
  select * into v from public.overtime_book_waiting_yeses();
  raise notice 'BLOCO 105: % booked, % on reserve, % left for the supervisor (blocked or clashing)',
    v.booked, v.reserved, v.left_for_supervisor;
end $$;

-- ================================================================
-- BLOCO 106
-- 20261019120000_the_board_hears_a_yes.sql
-- ================================================================
--
-- O BOARD OUVE O SIM: overtime_responses e daily_allocations entram no realtime, para o
-- board de Headcount mudar as horas assim que alguem confirma overtime, sem recarregar.
-- So acrescenta tabelas a publicacao; nao mexe em dados nem em permissoes. Independente.
--
-- The board hears a yes.
--
-- An employee's yes books the overtime (BLOCO 102/105) and the board lays the confirmed
-- hours over their placement (src/lib/boardOvertime.ts). The board learned of it only
-- when it refetched: neither `overtime_responses` nor `daily_allocations` was in the
-- realtime publication, so a supervisor looking at the board saw the old hours until
-- they reloaded or the 30-second refresh came round.
--
-- This puts both tables in `supabase_realtime`. Realtime delivers a change only to a
-- subscriber whose RLS lets them read that row, so nobody sees an answer or a placement
-- through this that they could not already select.
--
-- Idempotent; skips a table already in the publication.

do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'No supabase_realtime publication here; nothing to do.';
    return;
  end if;
  foreach t in array array['overtime_responses', 'daily_allocations'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

-- ================================================================
-- BLOCO 107
-- 20261019140000_the_supervisor_on_file_is_told.sql
-- ================================================================
--
-- O SUPERVISOR DA FICHA: a confirmacao de overtime ("Ana is coming in") passa a ir ao
-- supervisor da ficha do funcionario (campo Manager, employees.manager_id) E a quem
-- publicou o pedido, uma vez a cada um. O chat do funcionario passa a escrever ao
-- supervisor da ficha (ou, sem ficha, a quem publicou o pedido), e ganha uma conversa
-- sem pedido ("Message <nome>" no My Overtime). A resposta do supervisor passa a tocar
-- o sino do funcionario. Uma mensagem repetida em 2 minutos nao e duplicada. Quem
-- recebe uma mensagem so pode marca-la como lida, nao reescreve-la.
-- Precisa dos BLOCOS 100, 102 e 105. Nao reescreve linha nenhuma. Pode colar-se duas vezes.
-- Teste depois: supabase/tests/supervisor_on_file_test.sql (acaba em ALL TESTS PASSED, com ROLLBACK).
--
-- The supervisor on file is told, and is the one the employee writes to.
--
-- WHAT WAS THERE. Since BLOCO 102 an employee's yes books the shift, and whoever
-- POSTED the ask is told ("Ana is coming in") and is the one `message_overtime_supervisor`
-- writes to. The person's own supervisor — `employees.manager_id`, the "Manager" field
-- on the employee's record — was never read by overtime at all. An employee with no
-- ask in front of them had no way to write to anybody: the chat's routing policy lets
-- only operators and staff start a conversation. And a reply from the supervisor
-- reached the employee only as a live toast: nothing in `notifications`, so a phone
-- that was closed when it arrived never heard of it.
--
-- The rule asked for on 19/10: confirmation and chat go to the employee's assigned
-- supervisor, resolved from the application's own relationship.
--
-- WHAT THIS DOES.
--   1. `supervisor_login_of(employee)`: the login of the employee's manager on file
--      (`employees.manager_id` → that record's `user_id`, active). Internal only.
--   2. `my_supervisor()`: the same, for the signed-in employee, with a name — so the
--      screen can say who the conversation is with.
--   3. `overtime_response_booked_notify` (BLOCO 105's body, one change): the "is coming
--      in" row goes to the supervisor on file AND to whoever posted the ask, once each
--      per person per ask — only when the answer is first decided, so a retry or a
--      reserve later accepted does not ring again, and one login holding both roles is
--      rung once. Nobody is told about their own action.
--   4. `message_overtime_supervisor(ask, text)`: written to the supervisor on file,
--      or to whoever posted the ask when nobody is on file (the old behaviour). The
--      same text from the same person to the same person within two minutes is a
--      retry and returns the message already written instead of a second one.
--   5. `message_my_supervisor(text)`: the same, with no ask — for "My supervisor" on
--      My Overtime. Only ever to the supervisor on file; the function picks the
--      recipient, so no request can aim it at anybody else.
--   6. Bell rows from a trigger on `direct_messages`: a message through the
--      employee's door rings the supervisor (as before), and a message to a floor login
--      linked to an employee — the supervisor's reply from Messages — rings the
--      employee, which nothing did. The two functions above stop writing their own, so
--      each message rings once. Staff-to-staff and operator chat are untouched.
--   7. `direct_messages` UPDATE: the recipient's policy ("dm_update_mark_read") let
--      them change ANY column of a message sent to them, text included. A trigger now
--      allows only `read_at` to change. No policy is created or changed.
--
-- Nothing is rewritten: no message, notification or overtime row is updated. Needs
-- BLOCOS 100 (notifications.kind), 102 and 105.

-- ── 1. Who supervises a person ──────────────────────────────────────────────
-- The column is in production (the "Manager" field, probed 19/10: 200, and in
-- types.ts with employees_manager_id_fkey) but no migration in this repository
-- creates it. Declared here so the repository builds the schema it runs on; a no-op
-- where it already exists.
alter table public.employees
  add column if not exists manager_id uuid references public.employees(id) on delete set null;

create or replace function public.supervisor_login_of(p_employee uuid)
returns uuid
language sql stable security definer set search_path = public
as $$
  select m.user_id
    from public.employees e
    join public.employees m on m.id = e.manager_id
   where e.id = p_employee
     and m.active
     and m.user_id is not null
     and m.user_id is distinct from e.user_id;
$$;
revoke all on function public.supervisor_login_of(uuid) from public, anon, authenticated;

-- ── 2. Mine ─────────────────────────────────────────────────────────────────
create or replace function public.my_supervisor()
returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = public
as $$
  select m.user_id, m.full_name
    from public.employees e
    join public.employees m on m.id = e.manager_id
   where e.id = public.my_employee_id()
     and m.active
     and m.user_id is not null
     and m.user_id is distinct from auth.uid();
$$;
revoke all on function public.my_supervisor() from public, anon;
grant execute on function public.my_supervisor() to authenticated;

-- ── 3. Telling: the supervisor on file, and the poster, once each ───────────
create or replace function public.overtime_response_booked_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_req  public.overtime_requests;
  v_user uuid;
  v_name text;
  v_when text;
  v_to   uuid;
begin
  if new.decision is null or new.decision not in ('accepted', 'reserve') then return null; end if;
  if tg_op = 'UPDATE' and old.decision is not distinct from new.decision then return null; end if;

  begin
    select * into v_req from public.overtime_requests where id = new.request_id;
    select user_id, full_name into v_user, v_name from public.employees where id = new.employee_id;
    v_when := to_char(v_req.on_date, 'Dy DD/MM') || ' · ' || left(v_req.starts_at::text, 5)
              || '–' || left(v_req.ends_at::text, 5) || coalesce(' · ' || v_req.department, '');

    if v_user is not null then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (v_user, 'overtime_booked',
              case when new.decision = 'accepted' then 'You''re booked for overtime'
                   else 'You''re on the overtime reserve list' end,
              v_when, 'medium', '/dashboard/my-overtime?ask=' || v_req.id);
    end if;

    -- The supervisor on file and the poster, unless they did it themselves, or nobody
    -- did (the one-off backlog of BLOCO 105). Once per person per ask: only when the
    -- answer is first decided, so a reserve later accepted, or a retried yes, does not
    -- ring again — and `distinct`, so one login holding both roles is rung once.
    -- (Not BLOCO 100's unique key: that is one row per ask, and an ask has many people.)
    if auth.uid() is not null and (tg_op = 'INSERT' or old.decision is null) then
      for v_to in
        select distinct t from unnest(array[public.supervisor_login_of(new.employee_id), v_req.created_by]) t
         where t is not null and t <> auth.uid() and t is distinct from v_user
      loop
        insert into public.notifications (user_id, kind, title, body, priority, action_url)
        values (v_to, 'overtime_yes',
                coalesce(v_name, 'Somebody') ||
                  case when new.decision = 'accepted' then ' is coming in' else ' said yes (on reserve)' end,
                v_when, 'medium', '/dashboard/overtime');
      end loop;
    end if;
  exception when others then
    -- The booking is the record; the bell is a courtesy. Never undo it for the bell.
    raise warning 'overtime_response_booked_notify(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.overtime_response_booked_notify() from public, anon, authenticated;

-- ── 4 and 5. Writing to the supervisor ──────────────────────────────────────
-- One place that writes the message, so the two doors cannot drift apart.
create or replace function public.dm_from_employee(p_to uuid, p_name text, p_text text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_id uuid;
begin
  -- A retry is not a second message: the same words, to the same person, just now.
  select id into v_id from public.direct_messages
   where sender_id = auth.uid() and recipient_id = p_to and message = p_text
     and created_at > now() - interval '2 minutes'
   order by created_at desc limit 1;
  if v_id is not null then return v_id; end if;

  -- Tells the bell trigger (6) this came through the employee's door.
  perform set_config('app.dm_door', 'employee', true);
  insert into public.direct_messages (sender_id, sender_name, recipient_id, message)
  values (auth.uid(), coalesce(p_name, 'Employee'), p_to, p_text)
  returning id into v_id;
  perform set_config('app.dm_door', '', true);
  return v_id;
end;
$$;
revoke all on function public.dm_from_employee(uuid, text, text) from public, anon, authenticated;

create or replace function public.message_overtime_supervisor(p_request_id uuid, p_message text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_emp   uuid := public.my_employee_id();
  v_req   public.overtime_requests;
  v_dept  text;
  v_shift text;
  v_name  text;
  v_text  text := btrim(coalesce(p_message, ''));
  v_to    uuid;
begin
  if v_emp is null then
    raise exception 'No employee record is linked to this login' using errcode = 'P0001';
  end if;
  if length(v_text) = 0 then
    raise exception 'Write a message first' using errcode = 'P0001';
  end if;
  if length(v_text) > 1000 then
    raise exception 'Keep it under 1000 characters' using errcode = 'P0001';
  end if;

  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null then
    raise exception 'No such overtime' using errcode = 'P0001';
  end if;
  select department, shift_group, full_name into v_dept, v_shift, v_name
    from public.employees where id = v_emp;
  -- Only about an ask this person answered, or one that was put to them.
  if not exists (select 1 from public.overtime_responses where request_id = p_request_id and employee_id = v_emp)
     and ((v_req.department is not null and v_req.department is distinct from v_dept)
       or (v_req.shift_group is not null and v_req.shift_group is distinct from v_shift)) then
    raise exception 'This overtime was not asked of you' using errcode = 'P0001';
  end if;

  v_to := coalesce(public.supervisor_login_of(v_emp), v_req.created_by);
  if v_to is null or v_to = auth.uid() then
    raise exception 'Nobody to send it to: no supervisor is on file for you or this overtime' using errcode = 'P0001';
  end if;

  return public.dm_from_employee(v_to, v_name,
    'Overtime ' || to_char(v_req.on_date, 'Dy DD/MM') || ' ' || left(v_req.starts_at::text, 5)
      || '–' || left(v_req.ends_at::text, 5) || ': ' || v_text);
end;
$$;
revoke all on function public.message_overtime_supervisor(uuid, text) from public, anon;
grant execute on function public.message_overtime_supervisor(uuid, text) to authenticated;

create or replace function public.message_my_supervisor(p_message text)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_emp  uuid := public.my_employee_id();
  v_name text;
  v_text text := btrim(coalesce(p_message, ''));
  v_to   uuid;
begin
  if v_emp is null then
    raise exception 'No employee record is linked to this login' using errcode = 'P0001';
  end if;
  if length(v_text) = 0 then
    raise exception 'Write a message first' using errcode = 'P0001';
  end if;
  if length(v_text) > 1000 then
    raise exception 'Keep it under 1000 characters' using errcode = 'P0001';
  end if;
  v_to := public.supervisor_login_of(v_emp);
  if v_to is null or v_to = auth.uid() then
    raise exception 'No supervisor is on file for you yet. Ask the office to set your manager.' using errcode = 'P0001';
  end if;
  select full_name into v_name from public.employees where id = v_emp;
  return public.dm_from_employee(v_to, v_name, v_text);
end;
$$;
revoke all on function public.message_my_supervisor(text) from public, anon;
grant execute on function public.message_my_supervisor(text) to authenticated;

-- ── 6. A message to the supervisor, and the reply to the employee, ring once ─
-- Two cases, and nothing else, so staff-to-staff and operator-to-supervisor chat ring
-- exactly as they did:
--   * written through the employee's door (`dm_from_employee` sets `app.dm_door` for
--     the one insert): the supervisor is rung, kind `overtime_message` as before;
--   * written TO a floor login linked to an employee record (role employee or
--     operator) — the supervisor's reply from Messages: the employee is rung, and the
--     link opens their conversation on My Overtime.
create or replace function public.dm_employee_bell()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  begin
    if coalesce(current_setting('app.dm_door', true), '') = 'employee' then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (new.recipient_id, 'overtime_message',
              coalesce(nullif(new.sender_name, ''), 'An employee') || ' sent you a message',
              left(new.message, 200), 'medium', '/dashboard/messages');
    elsif (public.has_role(new.recipient_id, 'employee'::app_role)
           or public.has_role(new.recipient_id, 'operator'::app_role))
          and exists (select 1 from public.employees e where e.user_id = new.recipient_id and e.active) then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (new.recipient_id, 'chat_message',
              coalesce(nullif(new.sender_name, ''), 'Your supervisor') || ' replied',
              left(new.message, 200), 'medium', '/dashboard/my-overtime?chat=supervisor');
    end if;
  exception when others then
    raise warning 'dm_employee_bell(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.dm_employee_bell() from public, anon, authenticated;

drop trigger if exists dm_employee_bell_t on public.direct_messages;
create trigger dm_employee_bell_t
  after insert on public.direct_messages
  for each row execute function public.dm_employee_bell();

-- ── 7. Reading a message is the only change its recipient may make ─────────
create or replace function public.dm_only_read_at_changes()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.sender_id   is distinct from old.sender_id
  or new.recipient_id is distinct from old.recipient_id
  or new.sender_name is distinct from old.sender_name
  or new.message     is distinct from old.message
  or new.audio_url   is distinct from old.audio_url
  or new.image_url   is distinct from old.image_url
  or new.created_at  is distinct from old.created_at then
    raise exception 'A message can only be marked as read' using errcode = '42501';
  end if;
  return new;
end;
$$;

drop trigger if exists dm_only_read_at_changes_t on public.direct_messages;
create trigger dm_only_read_at_changes_t
  before update on public.direct_messages
  for each row execute function public.dm_only_read_at_changes();

notify pgrst, 'reload schema';

-- ================================================================
-- BLOCO 108
-- 20261019160000_conversations_have_groups_photos_and_files.sql
-- ================================================================
--
-- MESSAGES GANHA GRUPOS, FOTOS E FICHEIROS: grupos de departamento e de equipa (turno),
-- criados so por supervisores e administradores, para os departamentos que gerem; foto
-- de perfil (bucket privado avatars, 2 MB); anexos (bucket privado chat-files, 10 MB,
-- imagens/PDF/Office/texto); o sino toca uma vez por grupo, sem o texto da mensagem.
-- As conversas privadas continuam em direct_messages, com as regras de sempre; o admin
-- NAO passa a ler mensagens privadas de ninguem.
-- Precisa dos BLOCOS 100 (notifications.kind) e 107. Nao reescreve linha nenhuma e nao
-- muda nenhuma politica existente. Pode colar-se duas vezes.
-- Teste depois: supabase/tests/chat_groups_and_files_test.sql (acaba em ALL TESTS PASSED, com ROLLBACK).
--
-- Conversations get groups, photos and files.
--
-- WHAT WAS THERE. Messages is one-to-one only: `direct_messages` (sender, recipient,
-- read_at), routed by role in `dm_insert_routing`, `dm_insert_reply` (BLOCO 103b) and
-- the employee's two doors, `message_my_supervisor` / `message_overtime_supervisor`
-- (BLOCO 107). A private conversation is the PAIR of logins, so there is no
-- conversation row that could be created twice — that stays. Nobody in the system has
-- a photo (no avatar column anywhere), the chat cannot carry a file
-- (`direct_messages.image_url` has no writer), and there are no groups.
--
-- WHAT THIS ADDS. Nothing here rewrites a row or changes an existing policy.
--   1. Profile photos: `profiles.avatar_path`, a PRIVATE `avatars` bucket (2 MB,
--      jpeg/png/webp, enforced by the bucket itself), written only under the owner's
--      own folder, set only through `set_avatar()` — a person sets their own; an admin
--      may set anybody's.
--   2. Department and team groups: `chat_groups`, `chat_group_members`,
--      `chat_group_messages`, and `chat_group_events` (who created, added, removed,
--      promoted, renamed — the audit trail of membership). Every write goes through a
--      SECURITY DEFINER function that checks the caller against the database:
--        * create / manage: `has_action(uid, 'chat.groups.manage', {admin, supervisor,
--          production_office_admin})` — so the Permissions screen governs it, and the
--          employee ceiling in `has_action` keeps employees out whatever it says;
--        * scope: an admin, any department; everybody else, only the departments they
--          run — their own record's department and those of the people whose
--          `manager_id` points at them. A supervisor adds only active people of that
--          department (and that crew, for a team group);
--        * only an admin makes or unmakes a group manager. Nobody promotes themselves.
--      Reading is for current members only. A removed member loses the whole history
--      (and gets it back if re-added); messages are never edited or deleted.
--   3. Files: a PRIVATE `chat-files` bucket (10 MB; images, PDF, Office, text/CSV,
--      enforced by the bucket) under `g/<group>/…` or `dm/<low uid>_<high uid>/…`.
--      Storage policies let only the group's members, or the two people of the pair,
--      read or upload there. `chat_attachments` records each file against its message;
--      the size and type recorded are the ones storage measured, not what the browser
--      said.
--   4. The bell: a group message rings each other member once — while a group's
--      notification is unread it is refreshed, not duplicated — and says who wrote in
--      which group, never what.
--   5. Realtime on the group tables and on attachments (a file is recorded just after
--      its message, so the screen hears about both). RLS applies to what each
--      subscriber receives.
--
-- Admins do NOT gain read access to anybody's private messages: `dm_select_own` is
-- untouched, and no function here returns a direct message that is not the caller's.

-- ── 0. Who runs which department ────────────────────────────────────────────
create or replace function public.chat_can_manage_groups(p_uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_action(p_uid, 'chat.groups.manage',
                           array['admin', 'supervisor', 'production_office_admin']::app_role[]);
$$;
revoke all on function public.chat_can_manage_groups(uuid) from public, anon, authenticated;

create or replace function public.chat_is_admin(p_uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.has_role(p_uid, 'admin'::app_role);
$$;
revoke all on function public.chat_is_admin(uuid) from public, anon, authenticated;

-- The departments a person runs: their own record's, and their reports'.
create or replace function public.chat_departments_of(p_uid uuid)
returns setof text
language sql stable security definer set search_path = public
as $$
  select distinct d from (
    select e.department as d
      from public.employees e
     where e.user_id = p_uid and e.active
    union
    select r.department
      from public.employees me
      join public.employees r on r.manager_id = me.id and r.active
     where me.user_id = p_uid and me.active
  ) x
  where d is not null and btrim(d) <> '';
$$;
revoke all on function public.chat_departments_of(uuid) from public, anon, authenticated;

create or replace function public.chat_runs_department(p_uid uuid, p_department text)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.chat_can_manage_groups(p_uid)
     and (public.chat_is_admin(p_uid)
          or exists (select 1 from public.chat_departments_of(p_uid) d where d = p_department));
$$;
revoke all on function public.chat_runs_department(uuid, text) from public, anon, authenticated;

-- ── 1. Profile photos ───────────────────────────────────────────────────────
alter table public.profiles add column if not exists avatar_path text;
comment on column public.profiles.avatar_path is
  'Caminho no bucket PRIVADO avatars (<user_id>/<ficheiro>), nunca um URL. Assinar na leitura. '
  'So muda por set_avatar(). Ver 20261019160000.';

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('avatars', 'avatars', false, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- A path's first folder is the login it belongs to, or `groups/<id>` for a group photo.
create or replace function public.chat_may_write_avatar(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
  v_group uuid;
begin
  if auth.uid() is null or array_length(v_parts, 1) is null then return false; end if;
  if v_parts[1] = auth.uid()::text then return true; end if;
  if v_parts[1] = 'groups' and array_length(v_parts, 1) >= 3 then
    begin v_group := v_parts[2]::uuid; exception when others then return false; end;
    return public.chat_manages_group(auth.uid(), v_group);
  end if;
  -- An admin may put a photo in anybody's folder (and then set it with set_avatar).
  return public.chat_is_admin(auth.uid())
     and v_parts[1] ~ '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
end;
$$;

-- ── 2. Groups ───────────────────────────────────────────────────────────────
create table if not exists public.chat_groups (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('department', 'team')),
  name        text not null check (length(btrim(name)) between 2 and 80),
  description text check (description is null or length(description) <= 500),
  department  text not null check (length(btrim(department)) > 0),
  -- The crew (`employees.shift_group`) a team group is for; only a team group has one.
  team        text,
  avatar_path text,
  created_by  uuid not null references auth.users(id),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  constraint chat_groups_team_only_for_teams check ((kind = 'team') = (team is not null))
);

create table if not exists public.chat_group_members (
  group_id     uuid not null references public.chat_groups(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         text not null default 'member' check (role in ('manager', 'member')),
  added_by     uuid references auth.users(id),
  -- clock_timestamp, not now(): unread is "after I last read", and a transaction's
  -- now() is one instant for everything in it.
  joined_at    timestamptz not null default clock_timestamp(),
  -- Removal keeps the row (who, when, by whom); `left_at` set = no access at all.
  left_at      timestamptz,
  removed_by   uuid references auth.users(id),
  last_read_at timestamptz,
  primary key (group_id, user_id)
);
create index if not exists chat_group_members_user_idx
  on public.chat_group_members (user_id) where left_at is null;

create table if not exists public.chat_group_messages (
  -- The client chooses the id, so a retried send is the same message, not a second one.
  id          uuid primary key default gen_random_uuid(),
  group_id    uuid not null references public.chat_groups(id) on delete cascade,
  sender_id   uuid not null references auth.users(id),
  body        text not null check (length(body) <= 4000),
  reply_to_id uuid references public.chat_group_messages(id) on delete set null,
  created_at  timestamptz not null default clock_timestamp()
);
create index if not exists chat_group_messages_group_time_idx
  on public.chat_group_messages (group_id, created_at desc, id desc);

create table if not exists public.chat_group_events (
  id             uuid primary key default gen_random_uuid(),
  group_id       uuid not null references public.chat_groups(id) on delete cascade,
  actor_id       uuid references auth.users(id),
  action         text not null check (action in ('created', 'member_added', 'member_removed',
                                                 'role_changed', 'details_changed')),
  target_user_id uuid references auth.users(id),
  detail         jsonb,
  at             timestamptz not null default now()
);
create index if not exists chat_group_events_group_idx on public.chat_group_events (group_id, at desc);

create or replace function public.chat_is_member(p_uid uuid, p_group uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select exists (select 1 from public.chat_group_members m
                  where m.group_id = p_group and m.user_id = p_uid and m.left_at is null);
$$;
revoke all on function public.chat_is_member(uuid, uuid) from public, anon, authenticated;

-- The policies' question, only ever about whoever asks: nobody can use it to learn
-- who else is in a group.
create or replace function public.chat_i_am_in(p_group uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.chat_is_member(auth.uid(), p_group);
$$;
revoke all on function public.chat_i_am_in(uuid) from public, anon;
grant execute on function public.chat_i_am_in(uuid) to authenticated;

-- Manages a group: an admin, or a current member holding the manager role.
create or replace function public.chat_manages_group(p_uid uuid, p_group uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select public.chat_is_admin(p_uid)
      or exists (select 1 from public.chat_group_members m
                  where m.group_id = p_group and m.user_id = p_uid
                    and m.left_at is null and m.role = 'manager');
$$;
revoke all on function public.chat_manages_group(uuid, uuid) from public, anon, authenticated;
revoke all on function public.chat_may_write_avatar(text) from public, anon;
grant execute on function public.chat_may_write_avatar(text) to authenticated;

alter table public.chat_groups         enable row level security;
alter table public.chat_group_members  enable row level security;
alter table public.chat_group_messages enable row level security;
alter table public.chat_group_events   enable row level security;

-- Reading only. Every write is a function below; no INSERT/UPDATE/DELETE policy exists.
drop policy if exists "chat_groups_members_read" on public.chat_groups;
create policy "chat_groups_members_read" on public.chat_groups
  for select to authenticated using (public.chat_i_am_in(id));

drop policy if exists "chat_group_members_members_read" on public.chat_group_members;
create policy "chat_group_members_members_read" on public.chat_group_members
  for select to authenticated using (public.chat_i_am_in(group_id));

drop policy if exists "chat_group_messages_members_read" on public.chat_group_messages;
create policy "chat_group_messages_members_read" on public.chat_group_messages
  for select to authenticated using (public.chat_i_am_in(group_id));

drop policy if exists "chat_group_events_members_read" on public.chat_group_events;
create policy "chat_group_events_members_read" on public.chat_group_events
  for select to authenticated using (public.chat_i_am_in(group_id));

revoke all on public.chat_groups, public.chat_group_members, public.chat_group_messages,
              public.chat_group_events from anon;
revoke insert, update, delete on public.chat_groups, public.chat_group_members,
              public.chat_group_messages, public.chat_group_events from authenticated;
grant select on public.chat_groups, public.chat_group_members, public.chat_group_messages,
              public.chat_group_events to authenticated;

-- Who a supervisor may put in a group of this department (and crew).
create or replace function public.chat_eligible_for(p_uid uuid, p_department text, p_team text, p_member uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select case
    when public.chat_is_admin(p_uid) then
      exists (select 1 from public.profiles p where p.id = p_member and coalesce(p.active, true))
    else
      p_member = p_uid
      or exists (select 1 from public.employees e
                  where e.user_id = p_member and e.active
                    and e.department = p_department
                    and (p_team is null or e.shift_group = p_team))
  end;
$$;
revoke all on function public.chat_eligible_for(uuid, text, text, uuid) from public, anon, authenticated;

-- What the "New group" form offers: the departments this person runs, with their crews.
create or replace function public.chat_my_group_scope()
returns table (department text, teams text[])
language sql stable security definer set search_path = public
as $$
  with mine as (
    select d from public.chat_departments_of(auth.uid()) d
    where public.chat_can_manage_groups(auth.uid())
    union
    select distinct e.department from public.employees e
     where public.chat_is_admin(auth.uid()) and e.active
       and e.department is not null and btrim(e.department) <> ''
  )
  select m.d,
         coalesce(array(select distinct e.shift_group from public.employees e
                         where e.active and e.department = m.d and e.shift_group is not null
                         order by 1), '{}')
    from mine m
   order by 1;
$$;
revoke all on function public.chat_my_group_scope() from public, anon;
grant execute on function public.chat_my_group_scope() to authenticated;

-- The people the form offers for a department (and crew).
create or replace function public.chat_eligible_members(p_department text, p_team text default null)
returns table (user_id uuid, name text, avatar_path text, job text)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.chat_runs_department(auth.uid(), p_department) then
    raise exception 'You do not run this department' using errcode = '42501';
  end if;
  return query
    select distinct on (e.user_id) e.user_id, e.full_name, p.avatar_path, e.position
      from public.employees e
      left join public.profiles p on p.id = e.user_id
     where e.active and e.user_id is not null and e.user_id <> auth.uid()
       and e.department = p_department
       and (p_team is null or e.shift_group = p_team)
     order by e.user_id, e.full_name;
end;
$$;
revoke all on function public.chat_eligible_members(text, text) from public, anon;
grant execute on function public.chat_eligible_members(text, text) to authenticated;

create or replace function public.chat_create_group(
  p_kind text, p_name text, p_department text, p_team text default null,
  p_description text default null, p_members uuid[] default '{}'
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_me    uuid := auth.uid();
  v_id    uuid;
  v_team  text := nullif(btrim(coalesce(p_team, '')), '');
  v_m     uuid;
begin
  if v_me is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if not public.chat_can_manage_groups(v_me) then
    raise exception 'Only supervisors and administrators create groups' using errcode = '42501';
  end if;
  if p_kind not in ('department', 'team') then
    raise exception 'A group is for a department or a team' using errcode = 'P0001';
  end if;
  if not public.chat_runs_department(v_me, p_department) then
    raise exception 'You can only create groups for a department you run' using errcode = '42501';
  end if;
  if p_kind = 'team' and v_team is null then
    raise exception 'Choose the crew this team group is for' using errcode = 'P0001';
  end if;
  if p_kind = 'department' then v_team := null; end if;

  insert into public.chat_groups (kind, name, description, department, team, created_by)
  values (p_kind, btrim(p_name), nullif(btrim(coalesce(p_description, '')), ''), p_department, v_team, v_me)
  returning id into v_id;

  insert into public.chat_group_members (group_id, user_id, role, added_by)
  values (v_id, v_me, 'manager', v_me);
  insert into public.chat_group_events (group_id, actor_id, action, detail)
  values (v_id, v_me, 'created', jsonb_build_object('name', btrim(p_name), 'kind', p_kind,
                                                   'department', p_department, 'team', v_team));

  foreach v_m in array coalesce(p_members, '{}') loop
    if v_m = v_me then continue; end if;
    if not public.chat_eligible_for(v_me, p_department, v_team, v_m) then
      raise exception 'Somebody chosen is not in this department or crew' using errcode = '42501';
    end if;
    insert into public.chat_group_members (group_id, user_id, role, added_by)
    values (v_id, v_m, 'member', v_me)
    on conflict (group_id, user_id) do nothing;
    insert into public.chat_group_events (group_id, actor_id, action, target_user_id)
    values (v_id, v_me, 'member_added', v_m);
  end loop;
  return v_id;
end;
$$;
revoke all on function public.chat_create_group(text, text, text, text, text, uuid[]) from public, anon;
grant execute on function public.chat_create_group(text, text, text, text, text, uuid[]) to authenticated;

create or replace function public.chat_add_members(p_group uuid, p_members uuid[])
returns integer
language plpgsql security definer set search_path = public
as $$
declare
  v_me  uuid := auth.uid();
  v_g   public.chat_groups;
  v_m   uuid;
  v_n   integer := 0;
begin
  select * into v_g from public.chat_groups where id = p_group;
  if v_g.id is null or not public.chat_manages_group(v_me, p_group) then
    raise exception 'Only this group''s managers change who is in it' using errcode = '42501';
  end if;
  foreach v_m in array coalesce(p_members, '{}') loop
    if not public.chat_eligible_for(v_me, v_g.department, v_g.team, v_m) then
      raise exception 'Somebody chosen is not in this department or crew' using errcode = '42501';
    end if;
    insert into public.chat_group_members (group_id, user_id, role, added_by)
    values (p_group, v_m, 'member', v_me)
    on conflict (group_id, user_id) do update
      set left_at = null, removed_by = null, joined_at = clock_timestamp(), added_by = v_me, role = 'member'
      where public.chat_group_members.left_at is not null;
    if found then
      v_n := v_n + 1;
      insert into public.chat_group_events (group_id, actor_id, action, target_user_id)
      values (p_group, v_me, 'member_added', v_m);
    end if;
  end loop;
  update public.chat_groups set updated_at = now() where id = p_group;
  return v_n;
end;
$$;
revoke all on function public.chat_add_members(uuid, uuid[]) from public, anon;
grant execute on function public.chat_add_members(uuid, uuid[]) to authenticated;

create or replace function public.chat_remove_member(p_group uuid, p_user uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_role text;
begin
  if not public.chat_manages_group(v_me, p_group) then
    raise exception 'Only this group''s managers change who is in it' using errcode = '42501';
  end if;
  select role into v_role from public.chat_group_members
   where group_id = p_group and user_id = p_user and left_at is null;
  if v_role is null then return; end if;
  -- A manager is removed by an admin only, so one supervisor cannot push out another.
  if v_role = 'manager' and not public.chat_is_admin(v_me) then
    raise exception 'Only an administrator removes a group manager' using errcode = '42501';
  end if;
  update public.chat_group_members set left_at = clock_timestamp(), removed_by = v_me
   where group_id = p_group and user_id = p_user and left_at is null;
  insert into public.chat_group_events (group_id, actor_id, action, target_user_id)
  values (p_group, v_me, 'member_removed', p_user);
end;
$$;
revoke all on function public.chat_remove_member(uuid, uuid) from public, anon;
grant execute on function public.chat_remove_member(uuid, uuid) to authenticated;

create or replace function public.chat_set_member_role(p_group uuid, p_user uuid, p_role text)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.chat_is_admin(auth.uid()) then
    raise exception 'Only an administrator names group managers' using errcode = '42501';
  end if;
  if p_role not in ('manager', 'member') then
    raise exception 'A member is a manager or a member' using errcode = 'P0001';
  end if;
  update public.chat_group_members set role = p_role
   where group_id = p_group and user_id = p_user and left_at is null and role <> p_role;
  if found then
    insert into public.chat_group_events (group_id, actor_id, action, target_user_id, detail)
    values (p_group, auth.uid(), 'role_changed', p_user, jsonb_build_object('role', p_role));
  end if;
end;
$$;
revoke all on function public.chat_set_member_role(uuid, uuid, text) from public, anon;
grant execute on function public.chat_set_member_role(uuid, uuid, text) to authenticated;

create or replace function public.chat_update_group(
  p_group uuid, p_name text, p_description text, p_avatar_path text
)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  if not public.chat_manages_group(auth.uid(), p_group) then
    raise exception 'Only this group''s managers change it' using errcode = '42501';
  end if;
  if p_avatar_path is not null and p_avatar_path not like 'groups/' || p_group::text || '/%' then
    raise exception 'That photo is not this group''s' using errcode = '42501';
  end if;
  update public.chat_groups
     set name = btrim(p_name),
         description = nullif(btrim(coalesce(p_description, '')), ''),
         avatar_path = p_avatar_path,
         updated_at = now()
   where id = p_group;
  insert into public.chat_group_events (group_id, actor_id, action, detail)
  values (p_group, auth.uid(), 'details_changed', jsonb_build_object('name', btrim(p_name)));
end;
$$;
revoke all on function public.chat_update_group(uuid, text, text, text) from public, anon;
grant execute on function public.chat_update_group(uuid, text, text, text) to authenticated;

-- ── 3. Files ────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('chat-files', 'chat-files', false, 10485760, array[
  'image/jpeg', 'image/png', 'image/webp', 'image/gif',
  'application/pdf', 'text/plain', 'text/csv',
  'application/msword', 'application/vnd.ms-excel', 'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation'
])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

-- `g/<group>/…`: the group's current members. `dm/<a>_<b>/…`: the two of the pair.
create or replace function public.chat_may_use_file(p_name text)
returns boolean
language plpgsql stable security definer set search_path = public
as $$
declare
  v_parts text[] := string_to_array(coalesce(p_name, ''), '/');
  v_group uuid;
  v_pair  text[];
begin
  if auth.uid() is null or coalesce(array_length(v_parts, 1), 0) < 3 then return false; end if;
  if v_parts[1] = 'g' then
    begin v_group := v_parts[2]::uuid; exception when others then return false; end;
    return public.chat_is_member(auth.uid(), v_group);
  elsif v_parts[1] = 'dm' then
    v_pair := string_to_array(v_parts[2], '_');
    if coalesce(array_length(v_pair, 1), 0) <> 2 then return false; end if;
    begin
      -- The same order as `least`/`greatest` on uuid, whatever the collation.
      if v_pair[1]::uuid >= v_pair[2]::uuid then return false; end if;
    exception when others then return false; end;
    return auth.uid() in (v_pair[1]::uuid, v_pair[2]::uuid);
  end if;
  return false;
end;
$$;
revoke all on function public.chat_may_use_file(text) from public, anon;
grant execute on function public.chat_may_use_file(text) to authenticated;

drop policy if exists "chat-files read in conversation" on storage.objects;
create policy "chat-files read in conversation" on storage.objects
  for select to authenticated
  using (bucket_id = 'chat-files' and public.chat_may_use_file(name));

drop policy if exists "chat-files upload in conversation" on storage.objects;
create policy "chat-files upload in conversation" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'chat-files' and owner = auth.uid() and public.chat_may_use_file(name));

drop policy if exists "avatars read signed in" on storage.objects;
create policy "avatars read signed in" on storage.objects
  for select to authenticated
  using (bucket_id = 'avatars');

drop policy if exists "avatars write own" on storage.objects;
create policy "avatars write own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'avatars' and public.chat_may_write_avatar(name));

drop policy if exists "avatars replace own" on storage.objects;
create policy "avatars replace own" on storage.objects
  for update to authenticated
  using (bucket_id = 'avatars' and public.chat_may_write_avatar(name))
  with check (bucket_id = 'avatars' and public.chat_may_write_avatar(name));

drop policy if exists "avatars delete own" on storage.objects;
create policy "avatars delete own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'avatars' and public.chat_may_write_avatar(name));

create table if not exists public.chat_attachments (
  id                uuid primary key default gen_random_uuid(),
  group_message_id  uuid references public.chat_group_messages(id) on delete cascade,
  direct_message_id uuid references public.direct_messages(id) on delete cascade,
  storage_path      text not null unique,
  file_name         text not null check (length(file_name) between 1 and 200),
  content_type      text not null,
  size_bytes        bigint not null check (size_bytes > 0 and size_bytes <= 10485760),
  uploaded_by       uuid not null references auth.users(id),
  created_at        timestamptz not null default now(),
  constraint chat_attachments_one_message check (num_nonnulls(group_message_id, direct_message_id) = 1)
);
create index if not exists chat_attachments_group_msg_idx on public.chat_attachments (group_message_id);
create index if not exists chat_attachments_dm_idx on public.chat_attachments (direct_message_id);

alter table public.chat_attachments enable row level security;
drop policy if exists "chat_attachments_read_in_conversation" on public.chat_attachments;
create policy "chat_attachments_read_in_conversation" on public.chat_attachments
  for select to authenticated
  using (public.chat_may_use_file(storage_path));
revoke all on public.chat_attachments from anon;
revoke insert, update, delete on public.chat_attachments from authenticated;
grant select on public.chat_attachments to authenticated;

-- Records the files of a message the caller just sent. Each file must already be in
-- storage, uploaded by the caller, inside that message's conversation folder; the
-- size and type are read from storage, so the browser's word is never the record.
create or replace function public.chat_record_attachments(
  p_group_message uuid, p_direct_message uuid, p_files jsonb
)
returns integer
language plpgsql security definer set search_path = public, storage
as $$
declare
  v_me     uuid := auth.uid();
  v_prefix text;
  v_sender uuid;
  v_at     timestamptz;
  v_f      jsonb;
  v_obj    storage.objects;
  v_n      integer := 0;
  v_dm     public.direct_messages;
begin
  if num_nonnulls(p_group_message, p_direct_message) <> 1 then
    raise exception 'Name one message' using errcode = 'P0001';
  end if;
  if jsonb_typeof(coalesce(p_files, '[]'::jsonb)) <> 'array' or jsonb_array_length(coalesce(p_files, '[]'::jsonb)) > 5 then
    raise exception 'Up to 5 files per message' using errcode = 'P0001';
  end if;
  if p_group_message is not null then
    select sender_id, created_at, 'g/' || group_id::text || '/' into v_sender, v_at, v_prefix
      from public.chat_group_messages where id = p_group_message;
  else
    select * into v_dm from public.direct_messages where id = p_direct_message;
    v_sender := v_dm.sender_id; v_at := v_dm.created_at;
    v_prefix := 'dm/' || least(v_dm.sender_id, v_dm.recipient_id)::text || '_'
                      || greatest(v_dm.sender_id, v_dm.recipient_id)::text || '/';
  end if;
  if v_sender is null or v_sender <> v_me then
    raise exception 'Only the sender adds files to a message' using errcode = '42501';
  end if;
  if v_at < now() - interval '15 minutes' then
    raise exception 'Files are added when the message is sent' using errcode = 'P0001';
  end if;

  for v_f in select * from jsonb_array_elements(coalesce(p_files, '[]'::jsonb)) loop
    if (v_f->>'path') not like v_prefix || '%' then
      raise exception 'A file is not in this conversation' using errcode = '42501';
    end if;
    select * into v_obj from storage.objects
     where bucket_id = 'chat-files' and name = v_f->>'path' and owner = v_me;
    if v_obj.id is null then
      raise exception 'A file did not finish uploading' using errcode = 'P0001';
    end if;
    insert into public.chat_attachments
      (group_message_id, direct_message_id, storage_path, file_name, content_type, size_bytes, uploaded_by)
    values (p_group_message, p_direct_message, v_obj.name,
            left(coalesce(nullif(btrim(v_f->>'name'), ''), regexp_replace(v_obj.name, '^.*/', '')), 200),
            coalesce(v_obj.metadata->>'mimetype', 'application/octet-stream'),
            coalesce((v_obj.metadata->>'size')::bigint, 1), v_me)
    on conflict (storage_path) do nothing;
    if found then v_n := v_n + 1; end if;
  end loop;
  return v_n;
end;
$$;
revoke all on function public.chat_record_attachments(uuid, uuid, jsonb) from public, anon;
grant execute on function public.chat_record_attachments(uuid, uuid, jsonb) to authenticated;

-- ── Sending and reading a group ─────────────────────────────────────────────
create or replace function public.chat_send_group_message(
  p_id uuid, p_group uuid, p_body text, p_reply_to uuid default null, p_files jsonb default '[]'
)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_me   uuid := auth.uid();
  v_body text := btrim(coalesce(p_body, ''));
  v_old  public.chat_group_messages;
begin
  if not public.chat_is_member(v_me, p_group) then
    raise exception 'You are not in this group' using errcode = '42501';
  end if;
  -- A retry of a message already written is that message.
  select * into v_old from public.chat_group_messages where id = p_id;
  if v_old.id is not null then
    if v_old.sender_id <> v_me or v_old.group_id <> p_group then
      raise exception 'That message id is taken' using errcode = '42501';
    end if;
    perform public.chat_record_attachments(p_id, null, p_files);
    return p_id;
  end if;
  if length(v_body) = 0 and jsonb_array_length(coalesce(p_files, '[]'::jsonb)) = 0 then
    raise exception 'Write a message first' using errcode = 'P0001';
  end if;
  if length(v_body) > 4000 then
    raise exception 'Keep it under 4000 characters' using errcode = 'P0001';
  end if;
  if p_reply_to is not null
     and not exists (select 1 from public.chat_group_messages where id = p_reply_to and group_id = p_group) then
    raise exception 'That reply is to a message in another conversation' using errcode = 'P0001';
  end if;

  insert into public.chat_group_messages (id, group_id, sender_id, body, reply_to_id)
  values (coalesce(p_id, gen_random_uuid()), p_group, v_me, v_body, p_reply_to)
  returning id into p_id;
  perform public.chat_record_attachments(p_id, null, p_files);
  update public.chat_group_members set last_read_at = clock_timestamp()
   where group_id = p_group and user_id = v_me;
  return p_id;
end;
$$;
revoke all on function public.chat_send_group_message(uuid, uuid, text, uuid, jsonb) from public, anon;
grant execute on function public.chat_send_group_message(uuid, uuid, text, uuid, jsonb) to authenticated;

create or replace function public.chat_mark_group_read(p_group uuid)
returns void
language plpgsql security definer set search_path = public
as $$
begin
  update public.chat_group_members set last_read_at = clock_timestamp()
   where group_id = p_group and user_id = auth.uid() and left_at is null;
  update public.notifications set read_at = now()
   where user_id = auth.uid() and kind = 'chat_group' and read_at is null
     and action_url = '/dashboard/messages?group=' || p_group::text;
end;
$$;
revoke all on function public.chat_mark_group_read(uuid) from public, anon;
grant execute on function public.chat_mark_group_read(uuid) to authenticated;

-- The sidebar: each of my groups, its last message and how many I have not read.
create or replace function public.chat_my_groups()
returns table (
  id uuid, kind text, name text, description text, department text, team text,
  avatar_path text, my_role text, member_count integer,
  last_at timestamptz, last_sender_name text, last_body text, last_has_files boolean, unread integer
)
language sql stable security definer set search_path = public
as $$
  select g.id, g.kind, g.name, g.description, g.department, g.team, g.avatar_path, me.role,
         (select count(*)::int from public.chat_group_members x where x.group_id = g.id and x.left_at is null),
         lm.created_at, lp.name, left(lm.body, 140),
         exists (select 1 from public.chat_attachments a where a.group_message_id = lm.id),
         (select count(*)::int from public.chat_group_messages u
           where u.group_id = g.id and u.sender_id <> auth.uid()
             and u.created_at > coalesce(me.last_read_at, me.joined_at))
    from public.chat_group_members me
    join public.chat_groups g on g.id = me.group_id
    left join lateral (select * from public.chat_group_messages m where m.group_id = g.id
                        order by m.created_at desc, m.id desc limit 1) lm on true
    left join public.profiles lp on lp.id = lm.sender_id
   where me.user_id = auth.uid() and me.left_at is null
   order by coalesce(lm.created_at, g.created_at) desc;
$$;
revoke all on function public.chat_my_groups() from public, anon;
grant execute on function public.chat_my_groups() to authenticated;

-- The people of a group I am in.
create or replace function public.chat_group_people(p_group uuid)
returns table (user_id uuid, name text, avatar_path text, role text, job text, joined_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.chat_is_member(auth.uid(), p_group) and not public.chat_is_admin(auth.uid()) then
    raise exception 'You are not in this group' using errcode = '42501';
  end if;
  return query
    select m.user_id, coalesce(e.full_name, nullif(p.name, ''), p.email, 'User'), p.avatar_path, m.role,
           e.position, m.joined_at
      from public.chat_group_members m
      left join public.profiles p on p.id = m.user_id
      left join lateral (select full_name, position from public.employees
                          where user_id = m.user_id and active limit 1) e on true
     where m.group_id = p_group and m.left_at is null
     order by (m.role = 'manager') desc, 2;
end;
$$;
revoke all on function public.chat_group_people(uuid) from public, anon;
grant execute on function public.chat_group_people(uuid) to authenticated;

-- ── Private conversations: one summary row per person I have written with ─────
-- Runs as the caller, so RLS (`dm_select_own`) decides what it can see.
create or replace function public.chat_my_dm_summaries()
returns table (partner_id uuid, last_at timestamptz, last_body text, last_from_me boolean,
               last_has_audio boolean, unread integer)
language sql stable security invoker set search_path = public
as $$
  with mine as (
    select d.*, case when d.sender_id = auth.uid() then d.recipient_id else d.sender_id end as partner
      from public.direct_messages d
     where d.sender_id = auth.uid() or d.recipient_id = auth.uid()
  ), last as (
    select distinct on (partner) partner, created_at, message, sender_id, audio_url
      from mine order by partner, created_at desc, id desc
  )
  select l.partner, l.created_at, left(l.message, 140), l.sender_id = auth.uid(), l.audio_url is not null,
         (select count(*)::int from mine u
           where u.partner = l.partner and u.recipient_id = auth.uid() and u.read_at is null)
    from last l;
$$;
revoke all on function public.chat_my_dm_summaries() from public, anon;
grant execute on function public.chat_my_dm_summaries() to authenticated;

-- Names, photos and job titles of the people on screen.
create or replace function public.chat_people(p_ids uuid[])
returns table (user_id uuid, name text, avatar_path text, job text)
language sql stable security definer set search_path = public
as $$
  select p.id, coalesce(e.full_name, nullif(p.name, ''), p.email, 'User'), p.avatar_path, e.position
    from public.profiles p
    left join lateral (select full_name, position from public.employees
                        where user_id = p.id and active limit 1) e on true
   where auth.uid() is not null
     and p.id = any (p_ids[1:300]);
$$;
revoke all on function public.chat_people(uuid[]) from public, anon;
grant execute on function public.chat_people(uuid[]) to authenticated;

-- ── Photos are set here, nowhere else ───────────────────────────────────────
create or replace function public.set_avatar(p_path text, p_user uuid default null)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_for uuid := coalesce(p_user, auth.uid());
begin
  if auth.uid() is null then raise exception 'Sign in first' using errcode = '42501'; end if;
  if v_for <> auth.uid() and not public.chat_is_admin(auth.uid()) then
    raise exception 'You can only change your own photo' using errcode = '42501';
  end if;
  if p_path is not null and p_path not like v_for::text || '/%' then
    raise exception 'That photo is not in this person''s folder' using errcode = '42501';
  end if;
  perform set_config('app.avatar_change', 'on', true);
  update public.profiles set avatar_path = p_path where id = v_for;
  perform set_config('app.avatar_change', '', true);
end;
$$;
revoke all on function public.set_avatar(text, uuid) from public, anon;
grant execute on function public.set_avatar(text, uuid) to authenticated;

create or replace function public.profiles_avatar_only_via_set_avatar()
returns trigger
language plpgsql set search_path = public
as $$
begin
  if new.avatar_path is distinct from old.avatar_path
     and coalesce(current_setting('app.avatar_change', true), '') <> 'on' then
    raise exception 'A photo is changed with set_avatar()' using errcode = '42501';
  end if;
  return new;
end;
$$;
drop trigger if exists profiles_avatar_only_via_set_avatar_t on public.profiles;
create trigger profiles_avatar_only_via_set_avatar_t
  before update of avatar_path on public.profiles
  for each row execute function public.profiles_avatar_only_via_set_avatar();

-- ── 4. The bell for a group message ─────────────────────────────────────────
-- One unread row per person per group: a second message while the first is unread
-- refreshes that row instead of adding one. Who wrote and where; never what.
create or replace function public.chat_group_message_bell()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_group text;
  v_from  text;
  v_url   text := '/dashboard/messages?group=' || new.group_id::text;
  v_to    uuid;
begin
  begin
    select name into v_group from public.chat_groups where id = new.group_id;
    select coalesce(nullif(name, ''), 'Somebody') into v_from from public.profiles where id = new.sender_id;
    for v_to in
      select user_id from public.chat_group_members
       where group_id = new.group_id and left_at is null and user_id <> new.sender_id
    loop
      update public.notifications
         set title = 'New messages in ' || coalesce(v_group, 'a group'),
             body = coalesce(v_from, 'Somebody') || ' wrote',
             created_at = now()
       where user_id = v_to and kind = 'chat_group' and action_url = v_url and read_at is null;
      if not found then
        insert into public.notifications (user_id, kind, title, body, priority, action_url)
        values (v_to, 'chat_group', 'New message in ' || coalesce(v_group, 'a group'),
                coalesce(v_from, 'Somebody') || ' wrote', 'medium', v_url);
      end if;
    end loop;
  exception when others then
    -- The message is the record; the bell is a courtesy. Never undo it for the bell.
    raise warning 'chat_group_message_bell(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.chat_group_message_bell() from public, anon, authenticated;

drop trigger if exists chat_group_message_bell_t on public.chat_group_messages;
create trigger chat_group_message_bell_t
  after insert on public.chat_group_messages
  for each row execute function public.chat_group_message_bell();

-- ── 5. Realtime ─────────────────────────────────────────────────────────────
do $$
declare t text;
begin
  if not exists (select 1 from pg_publication where pubname = 'supabase_realtime') then
    raise notice 'No supabase_realtime publication here; nothing to do.';
    return;
  end if;
  foreach t in array array['chat_group_messages', 'chat_group_members', 'chat_attachments'] loop
    if not exists (select 1 from pg_publication_tables
                    where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = t) then
      execute format('alter publication supabase_realtime add table public.%I', t);
    end if;
  end loop;
end $$;

notify pgrst, 'reload schema';

-- ================================================================
-- BLOCO 109
-- 20261020100000_the_hub_lists_whoever_the_rule_lets_you_write_to.sql
-- ================================================================
--
-- A PESQUISA DO COMMUNICATION HUB: passa a listar toda a gente a quem a regra de envio
-- (dm_insert_routing) deixa escrever, mais o supervisor da ficha de um employee. Antes,
-- um admin podia escrever aos 24 employees e nao encontrava nenhum. So acrescenta duas
-- funcoes de leitura; nao muda nenhuma politica nem nenhuma linha. Pode colar-se duas vezes.
-- Precisa dos BLOCOS 107 e 108.
-- Teste depois: supabase/tests/hub_contactable_people_test.sql (acaba em ALL TESTS PASSED, com ROLLBACK).
--
-- The Communication Hub lists whoever the rule lets you write to.
--
-- WHAT WAS THERE. The hub's list of people came from `list_dm_partners` (20260723170000),
-- which picks by role and never lists an `employee` login: the role did not exist when
-- it was written. The rule that decides who may write to whom is a different thing,
-- `dm_insert_routing` on `direct_messages` (read from production on 20/10/2026):
--
--   operator                                  -> a supervisor, or an operator-chat admin
--   supervisor, or an operator-chat admin     -> anybody
--   admin / manager / maintenance_manager /
--   warehouse                                 -> anybody who is not an operator
--
-- So an admin was allowed to write to every employee and could find none of them: 24
-- employee logins in production, 0 in the list. And an employee's only way to start a
-- conversation is `message_my_supervisor` (BLOCO 107), to the supervisor on file.
--
-- WHAT THIS DOES. `chat_contactable_people()` lists the active logins the caller may
-- start a conversation with, by evaluating THE SAME expression as `dm_insert_routing`
-- for each of them, plus the employee's supervisor on file. It decides nothing new and
-- grants nothing: a name it returns is a name the insert would accept, and the test
-- (supabase/tests/hub_contactable_people_test.sql) checks exactly that, pair by pair.
-- Only names, photos and job titles come back — what the hub already shows.
--
-- Nothing is rewritten; no policy changes. Needs BLOCOS 107 and 108.

create or replace function public.chat_may_start(p_from uuid, p_to uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  -- Word for word the WITH CHECK of "dm_insert_routing", with sender = p_from and
  -- recipient = p_to. If that policy changes, this changes with it (the test fails
  -- until it does).
  select p_from is not null and p_to is not null and p_from <> p_to and (
       (public.has_role(p_from, 'operator'::app_role)
         and (public.has_role(p_to, 'supervisor'::app_role) or public.is_operator_chat_admin(p_to)))
    or public.has_role(p_from, 'supervisor'::app_role)
    or public.is_operator_chat_admin(p_from)
    or ((public.has_role(p_from, 'admin'::app_role) or public.has_role(p_from, 'manager'::app_role)
         or public.has_role(p_from, 'maintenance_manager'::app_role) or public.has_role(p_from, 'warehouse'::app_role))
        and not public.has_role(p_to, 'operator'::app_role))
  );
$$;
revoke all on function public.chat_may_start(uuid, uuid) from public, anon, authenticated;

create or replace function public.chat_contactable_people()
returns table (user_id uuid, name text, avatar_path text, job text)
language sql stable security definer set search_path = public
as $$
  with me as (select auth.uid() as id),
  sup as (
    -- An employee's door: the supervisor on file (BLOCO 107), written to through
    -- message_my_supervisor.
    select s.user_id from public.my_supervisor() s
  )
  select p.id,
         coalesce(e.full_name, nullif(btrim(p.name), ''), p.email, 'User'),
         p.avatar_path,
         coalesce(nullif(btrim(e.position), ''),
                  initcap(replace((select r.role::text from public.user_roles r where r.user_id = p.id limit 1), '_', ' ')))
           || coalesce(' · ' || nullif(btrim(e.department), ''), '')
    from public.profiles p
    cross join me
    left join lateral (select x.full_name, x.position, x.department from public.employees x
                        where x.user_id = p.id and x.active limit 1) e on true
   where me.id is not null
     and p.id <> me.id
     and coalesce(p.active, true)
     and (public.chat_may_start(me.id, p.id) or p.id in (select user_id from sup))
   order by 2;
$$;
revoke all on function public.chat_contactable_people() from public, anon;
grant execute on function public.chat_contactable_people() to authenticated;

notify pgrst, 'reload schema';

-- ================================================================
-- BLOCO 110
-- 20261020110000_a_groups_people_list_names_its_columns.sql
-- ================================================================
--
-- CORRIGE "column reference user_id is ambiguous" no Communication Hub: a lista de
-- membros de um grupo (chat_group_people) falhava sempre. Recria so essa funcao, igual
-- mas com as colunas qualificadas. Nao muda dados nem politicas. Pode colar-se duas vezes.
-- Teste depois: supabase/tests/chat_functions_answer_test.sql (acaba em ALL TESTS PASSED, com ROLLBACK).
--
-- A group's people list names its columns.
--
-- WHAT WAS THERE. `chat_group_people` (BLOCO 108) is PL/pgSQL and RETURNS TABLE
-- (user_id, …), which makes `user_id` a variable inside its body. Its lateral lookup
-- said `where user_id = m.user_id` without a table prefix, so Postgres could not tell
-- the column from the variable and refused every call: "column reference "user_id" is
-- ambiguous" (Root Diagnostics, /dashboard/communication, 20/10 10:27). The group's
-- details sheet — members, Add, Remove, Make manager — showed "Members could not be
-- loaded" for everybody. The BLOCO 108 test only called it on the refusal path, which
-- raises before reaching that query; the test now calls it for real.
--
-- WHAT THIS DOES. The same function, the same signature, grants and checks, with every
-- column named by its table. Nothing else changes.

create or replace function public.chat_group_people(p_group uuid)
returns table (user_id uuid, name text, avatar_path text, role text, job text, joined_at timestamptz)
language plpgsql stable security definer set search_path = public
as $$
begin
  if not public.chat_is_member(auth.uid(), p_group) and not public.chat_is_admin(auth.uid()) then
    raise exception 'You are not in this group' using errcode = '42501';
  end if;
  return query
    select m.user_id, coalesce(e.full_name, nullif(p.name, ''), p.email, 'User'), p.avatar_path, m.role,
           e.position, m.joined_at
      from public.chat_group_members m
      left join public.profiles p on p.id = m.user_id
      left join lateral (select x.full_name, x.position from public.employees x
                          where x.user_id = m.user_id and x.active limit 1) e on true
     where m.group_id = p_group and m.left_at is null
     order by (m.role = 'manager') desc, 2;
end;
$$;
revoke all on function public.chat_group_people(uuid) from public, anon;
grant execute on function public.chat_group_people(uuid) to authenticated;

notify pgrst, 'reload schema';

-- ================================================================
-- BLOCO 111
-- 20261021090000_the_presence_draft_gets_its_migration_and_its_grants.sql
-- ================================================================
--
-- REGISTA o rascunho de disponibilidade do Communication Hub, que estava na producao sem
-- migracao (3 tabelas e 8 funcoes, todas vazias/por usar), FECHA as permissoes das tabelas
-- (authenticated tinha TRUNCATE, DELETE e UPDATE, e anon tinha SELECT) e faz o batimento
-- calar-se: so avisa quando alguem passa a estar ligado ou desligado, nao de 60 em 60
-- segundos por separador. Passa tambem a LER o dia de trabalho (ferias e baixas aprovadas,
-- quadro de presencas, escala do turno): ferias -> On Holiday, baixa/falta -> Offline, Online fora do
-- turno (30 min de folga) -> Away; Busy e Do Not Disturb nunca mudam. Nao muda dados, nem as
-- politicas das mensagens.
-- Pode colar-se duas vezes. Precisa dos BLOCOS 107 a 110.
-- Teste depois: supabase/tests/communication_presence_test.sql (acaba em ALL TESTS PASSED, com ROLLBACK).
--
-- The Communication presence draft gets its migration, its grants, and a quieter heartbeat.
--
-- WHAT WAS THERE. A server side for availability was applied to production directly, with
-- no migration: three tables (communication_availability, communication_connection_leases,
-- communication_presence_changes) and eight functions. Read from production on 21/10/2026:
-- every table empty, nothing in the app calling any of it. The client half is
-- src/lib/communicationPresence.ts, whose rules these functions already follow:
-- availability is a PREFERENCE, a connection is a 180-second LEASE, the final status is
-- derived on the server with the server's clock, and nothing private leaves it.
--
-- This file does not build a second implementation. It does three things to that one:
--
--   1. RECORDS it. `create table if not exists` and `create or replace function`, with the
--      bodies production has, so a fresh database gets the same objects (the app now reads
--      them, and an object the app reads must exist in a migration).
--
--   2. CLOSES THE GRANTS. The tables were created with the platform's default grants:
--      `authenticated` could INSERT, UPDATE, DELETE and TRUNCATE all three, and `anon` could
--      SELECT them. Row level security stops the first three only where a policy says so;
--      TRUNCATE ignores it entirely, so any signed-in account could empty everyone's
--      presence. After this file the tables are read-only to `authenticated` (and the lease
--      table is not readable at all), `anon` has nothing, and every write goes through the
--      functions below, which take the identity from the JWT and never from an argument.
--
--   3. QUIETS THE HEARTBEAT. `communication_touch_presence` bumped the person's row in
--      `communication_presence_changes` on EVERY beat, i.e. once a minute per open tab, and
--      Realtime evaluates that table's policy (communication_can_view_presence, which calls
--      chat_contactable_people()) once per subscriber per change. That is people x viewers
--      policy evaluations a minute for nothing: a viewer only needs to hear when somebody
--      BECOMES connected or STOPS being connected. Now the revision moves when the person
--      goes from no live lease to a live one (touch), when their last live lease ends (end),
--      and when they change their preference. A lease that simply times out cannot announce
--      itself; clients re-read on a timer for that.
--
-- THE RULES (communication_presence_for). The system reads the person's WORK STATE from what
-- it already knows (communication_work_state), the person's choice never being rewritten:
--   approved holiday leave today, or a holiday on the attendance board  -> on_holiday
--   approved sick/unpaid leave today, or sick/unpaid/absent on the board -> offline
--   preference 'on_holiday'                                              -> on_holiday
--   preference 'offline', or no live lease                               -> offline
--   preference 'online' but outside the shift (30 min grace either side) -> away
--   otherwise                                                            -> the preference
-- Busy and Do Not Disturb are never changed by the schedule. Sick/unpaid is shown as Offline,
-- never as a word that tells colleagues why. No pattern or no linked employee = no opinion.
-- A preference is kept until its owner changes it; there is no automatic expiry. Automatic
-- states last only while they are true and the preference is back untouched afterwards.
--
-- NOTHING HERE TOUCHES MESSAGE DELIVERY: no policy on direct_messages or the group tables
-- changes, and none of these functions is called by them.
--
-- Needs: leave_requests, employees, profiles, direct_messages, chat_group_members,
-- chat_is_member and chat_contactable_people (20261020100000).

-- ── 1. Tables, as production has them ───────────────────────────────────────
create table if not exists public.communication_availability (
  user_id    uuid primary key,
  preference text not null default 'online'
    check (preference in ('online', 'busy', 'do_not_disturb', 'away', 'offline', 'on_holiday')),
  updated_at timestamptz not null default clock_timestamp()
);

create table if not exists public.communication_connection_leases (
  user_id         uuid not null,
  auth_session_id uuid not null,
  tab_id          uuid not null,
  expires_at      timestamptz not null,
  primary key (user_id, auth_session_id, tab_id)
);
create index if not exists communication_connection_leases_expiry_idx
  on public.communication_connection_leases (expires_at);

create table if not exists public.communication_presence_changes (
  user_id  uuid primary key,
  revision uuid not null default gen_random_uuid()
);

alter table public.communication_availability      enable row level security;
alter table public.communication_connection_leases enable row level security;
alter table public.communication_presence_changes  enable row level security;

-- ── 2. Grants: read what a policy allows, write only through the functions ──
revoke all on public.communication_availability      from public, anon, authenticated;
revoke all on public.communication_connection_leases from public, anon, authenticated;
revoke all on public.communication_presence_changes  from public, anon, authenticated;
grant select on public.communication_availability     to authenticated;   -- own row only (policy)
grant select on public.communication_presence_changes to authenticated;   -- Realtime, scoped by policy
-- The lease table has no grant and no policy: it is reachable through the functions only.

-- ── 3. Functions ────────────────────────────────────────────────────────────
create or replace function public.communication_presence_actor()
returns uuid
language plpgsql stable security definer set search_path to ''
as $$
declare v_me uuid := auth.uid();
begin
  if v_me is null or not exists (
    select 1 from public.profiles p where p.id = v_me and coalesce(p.active, true)
  ) then raise exception 'Sign in with an active account' using errcode = '42501'; end if;
  return v_me;
end;
$$;

create or replace function public.communication_has_approved_holiday(p_target uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select exists (
    select 1 from public.employees e join public.leave_requests r on r.employee_id = e.id
    where e.user_id = p_target and e.active and r.kind = 'holiday' and r.status = 'approved'
      and (statement_timestamp() at time zone 'Europe/London')::date between r.start_date and r.end_date
  );
$$;

-- What the system knows about this person's working day, in the London calendar: 'holiday',
-- 'absent' (sick, unpaid, absent), 'on_shift', 'off_shift', or null when it cannot tell (no
-- linked employee, no shift pattern). Reads leave, the attendance board and the rota; returns
-- only the word, never the record. Used by the definers below; nobody calls it directly.
create or replace function public.communication_work_state(p_target uuid)
returns text
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_local   timestamp := statement_timestamp() at time zone 'Europe/London';
  v_today   date := (statement_timestamp() at time zone 'Europe/London')::date;
  v_pattern uuid;
  v_days    smallint[];
  v_s time; v_e time; v_ps time; v_pe time;
  v_d date; v_start timestamp; v_end timestamp;
begin
  select e.shift_pattern_id into v_pattern
    from public.employees e where e.user_id = p_target and e.active order by e.created_at limit 1;
  if not found then return null; end if;

  if public.communication_has_approved_holiday(p_target)
     or exists (select 1 from public.employees e join public.employee_attendance a on a.employee_id = e.id
                where e.user_id = p_target and e.active and a.on_date = v_today and a.status = 'holiday') then
    return 'holiday';
  end if;
  if exists (select 1 from public.employees e join public.leave_requests r on r.employee_id = e.id
             where e.user_id = p_target and e.active and r.kind in ('sick', 'unpaid') and r.status = 'approved'
               and v_today between r.start_date and r.end_date)
     or exists (select 1 from public.employees e join public.employee_attendance a on a.employee_id = e.id
                where e.user_id = p_target and e.active and a.on_date = v_today
                  and a.status in ('sick', 'unpaid', 'absent')) then
    return 'absent';
  end if;
  -- Recorded present today: at work, whatever the rota says (overtime, a swapped day).
  if exists (select 1 from public.employees e join public.employee_attendance a on a.employee_id = e.id
             where e.user_id = p_target and e.active and a.on_date = v_today and a.status in ('present', 'training')) then
    return 'on_shift';
  end if;

  if v_pattern is null then return null; end if;
  select p.days, p.starts_at, p.ends_at into v_days, v_s, v_e
    from public.shift_patterns p where p.id = v_pattern and p.active;
  if not found then return null; end if;
  -- A rota with days only: the whole of a covered day counts.
  if v_s is null or v_e is null then
    return case when extract(isodow from v_today)::smallint = any (v_days) then 'on_shift' else 'off_shift' end;
  end if;
  -- Today's shift, and yesterday's if it runs past midnight. Per-day hours override the pattern.
  foreach v_d in array array[v_today - 1, v_today] loop
    if extract(isodow from v_d)::smallint = any (v_days) then
      v_ps := null; v_pe := null;
      select d.starts_at, d.ends_at into v_ps, v_pe from public.shift_pattern_days d
        where d.pattern_id = v_pattern and d.weekday = extract(isodow from v_d)::smallint;
      v_ps := coalesce(v_ps, v_s); v_pe := coalesce(v_pe, v_e);
      v_start := v_d + v_ps;
      v_end   := v_d + v_pe + case when v_pe <= v_ps then interval '1 day' else interval '0' end;
      if v_local between v_start - interval '30 minutes' and v_end + interval '30 minutes' then
        return 'on_shift';
      end if;
    end if;
  end loop;
  return 'off_shift';
end;
$$;

create or replace function public.communication_can_view_presence(p_target uuid)
returns boolean
language sql stable security definer set search_path to ''
as $$
  select auth.uid() is not null
    and exists (select 1 from public.profiles me where me.id = auth.uid() and coalesce(me.active, true))
    and exists (select 1 from public.profiles p where p.id = p_target and coalesce(p.active, true))
    and (
      p_target = auth.uid()
      or exists (select 1 from public.chat_contactable_people() c where c.user_id = p_target)
      or exists (select 1 from public.direct_messages d
        where (d.sender_id = auth.uid() and d.recipient_id = p_target)
           or (d.recipient_id = auth.uid() and d.sender_id = p_target))
      or exists (select 1 from public.chat_group_members m
        where m.user_id = p_target and m.left_at is null
          and public.chat_is_member(auth.uid(), m.group_id))
    );
$$;

create or replace function public.communication_set_availability(p_preference text)
returns void
language plpgsql security definer set search_path to ''
as $$
declare v_me uuid := public.communication_presence_actor();
begin
  if p_preference is null or p_preference not in ('online', 'busy', 'do_not_disturb', 'away', 'offline', 'on_holiday') then
    raise exception 'Choose a permitted availability status' using errcode = '22023';
  end if;
  insert into public.communication_availability(user_id, preference, updated_at)
    values (v_me, p_preference, clock_timestamp())
    on conflict (user_id) do update set preference = excluded.preference, updated_at = excluded.updated_at;
  insert into public.communication_presence_changes(user_id, revision) values (v_me, gen_random_uuid())
    on conflict (user_id) do update set revision = excluded.revision;
end;
$$;

-- The return type changed (it gained the automatic state), so the old function goes first.
drop function if exists public.communication_my_availability();
create function public.communication_my_availability()
returns table (preference text, approved_holiday boolean, automatic_status text, automatic_reason text)
language plpgsql stable security definer set search_path to ''
as $$
declare
  v_me   uuid := public.communication_presence_actor();
  v_pref text := coalesce((select a.preference from public.communication_availability a where a.user_id = v_me), 'online');
  v_work text := public.communication_work_state(v_me);
begin
  return query select v_pref, v_work = 'holiday',
    case when v_work = 'holiday' then 'on_holiday'
         when v_work = 'absent' then 'offline'
         when v_work = 'off_shift' and v_pref = 'online' then 'away' end,
    case when v_work = 'holiday' then 'holiday'
         when v_work = 'absent' then 'absence'
         when v_work = 'off_shift' and v_pref = 'online' then 'off_shift' end;
end;
$$;

create or replace function public.communication_end_presence(p_tab_id uuid)
returns void
language plpgsql security definer set search_path to ''
as $$
declare
  v_me uuid := public.communication_presence_actor();
  v_session uuid := nullif(auth.jwt()->>'session_id', '')::uuid;
begin
  if p_tab_id is null or v_session is null then
    raise exception 'An authenticated session and tab are required' using errcode = '42501';
  end if;
  delete from public.communication_connection_leases l
    where l.user_id = v_me and l.auth_session_id = v_session and l.tab_id = p_tab_id;
  -- Only news if that was the last live lease: another open tab keeps the person connected.
  if not exists (select 1 from public.communication_connection_leases l
                  where l.user_id = v_me and l.expires_at > clock_timestamp()) then
    insert into public.communication_presence_changes(user_id, revision) values (v_me, gen_random_uuid())
      on conflict (user_id) do update set revision = excluded.revision;
  end if;
end;
$$;

create or replace function public.communication_presence_for(p_user_ids uuid[])
returns table (user_id uuid, status text)
language plpgsql stable security definer set search_path to ''
as $$
begin
  perform public.communication_presence_actor();
  if p_user_ids is null or cardinality(p_user_ids) > 300 then
    raise exception 'Request up to 300 people' using errcode = '22023';
  end if;
  return query
    select p.id,
      case when w.state = 'holiday' or a.preference = 'on_holiday' then 'on_holiday'
           when w.state = 'absent' then 'offline'
           when a.preference = 'offline' then 'offline'
           when not exists (select 1 from public.communication_connection_leases l
             where l.user_id = p.id and l.expires_at > statement_timestamp()) then 'offline'
           when w.state = 'off_shift' and coalesce(a.preference, 'online') = 'online' then 'away'
           else coalesce(a.preference, 'online') end
    from public.profiles p left join public.communication_availability a on a.user_id = p.id
    cross join lateral (select public.communication_work_state(p.id) as state) w
    where p.id = any(p_user_ids) and public.communication_can_view_presence(p.id);
end;
$$;

-- Execute: signed-in users on the six they call; the two helpers only the definers use.
revoke all on function public.communication_presence_actor()            from public, anon, authenticated;
revoke all on function public.communication_has_approved_holiday(uuid)  from public, anon, authenticated;
revoke all on function public.communication_work_state(uuid)            from public, anon, authenticated;
revoke all on function public.communication_can_view_presence(uuid)     from public, anon;
revoke all on function public.communication_set_availability(text)      from public, anon;
revoke all on function public.communication_my_availability()           from public, anon;
revoke all on function public.communication_touch_presence(uuid)        from public, anon;
revoke all on function public.communication_end_presence(uuid)          from public, anon;
revoke all on function public.communication_presence_for(uuid[])        from public, anon;
grant execute on function public.communication_can_view_presence(uuid)  to authenticated;  -- the policy below calls it as the invoker
grant execute on function public.communication_set_availability(text)   to authenticated;
grant execute on function public.communication_my_availability()        to authenticated;
grant execute on function public.communication_touch_presence(uuid)     to authenticated;
grant execute on function public.communication_end_presence(uuid)       to authenticated;
grant execute on function public.communication_presence_for(uuid[])     to authenticated;

-- ── 4. Policies ─────────────────────────────────────────────────────────────
drop policy if exists "communication_availability_own_read" on public.communication_availability;
create policy "communication_availability_own_read" on public.communication_availability
  for select to authenticated using (user_id = auth.uid());

drop policy if exists "communication_presence_changes_scoped_read" on public.communication_presence_changes;
create policy "communication_presence_changes_scoped_read" on public.communication_presence_changes
  for select to authenticated using (public.communication_can_view_presence(user_id));

-- ── 5. Realtime: the change marker, not the data ───────────────────────────
-- The published row carries only a user id and a fresh revision. Each subscriber receives
-- it only if communication_can_view_presence says so, then re-reads the status through
-- communication_presence_for(), which applies the same check again.
do $$
begin
  if exists (select 1 from pg_publication where pubname = 'supabase_realtime')
     and not exists (select 1 from pg_publication_tables
                      where pubname = 'supabase_realtime' and schemaname = 'public'
                        and tablename = 'communication_presence_changes') then
    alter publication supabase_realtime add table public.communication_presence_changes;
  end if;
end $$;

notify pgrst, 'reload schema';

-- F-1 (raiz): fechar o EXECUTE de `anon` por default no schema public.
--
-- Problema: o schema `public` tem ALTER DEFAULT PRIVILEGES que concede EXECUTE a `anon`
-- a TODA a função nova. O sweep de 27/06 (REVOKE ALL ON ALL FUNCTIONS ... FROM anon) só
-- cobriu as funções existentes nesse instante; cada função criada depois volta a ganhar
-- anon=EXECUTE, e a proteção passou a depender de cada função fazer o seu auth.uid()-check.
-- Isto já deixou PII de empregados acessível à chave anónima (overtime_unlinked_names,
-- medido 18/10/2026). Esta migração corrige a RAIZ e repõe um estado explícito.
--
-- ÂMBITO DELIBERADAMENTE ESTREITO: mexe SÓ no papel `anon`.
--   • NÃO toca em `authenticated` nem `service_role` — há funções propositadamente
--     revogadas de authenticated (service_role-only, ex. 20260624211229); um GRANT em
--     bloco a authenticated reabri-las-ia. Por isso não se concede nada a authenticated.
--   • NÃO revoga de PUBLIC — isso foi tratado em 27/06 e um REVOKE FROM PUBLIC poderia
--     remover acesso de que `authenticated` depende por via de PUBLIC.
--   O default do schema concede diretamente a anon ("anon=X of its own"), por isso
--   REVOKE ... FROM anon remove exatamente esse caminho sem efeitos colaterais.
--
-- Idempotente. REVÊ a allowlist de login antes de aplicar.

-- 1) RAIZ: parar o default de conceder EXECUTE a anon a funções FUTURAS.
--    Aplica-se ao role que cria as funções (o das migrações).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- 2) ESTADO ATUAL: tirar a anon o EXECUTE que já tem (anon apenas; authenticated intacto).
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- 3) Repor anon SÓ na allowlist de login — as funções que o ecrã pré-sessão chama sem
--    sessão. `to_regprocedure` salta as que não existam neste momento (idempotente).
--    Fonte da allowlist: medida na produção a 21/10/2026, chamada a chamada, e não lida
--    das migrações — foi por lê-las que esta lista nasceu errada duas vezes:
--      * `signup_invite_code` não leva argumentos. Escrita `(text)`, `to_regprocedure`
--        devolvia NULL e o GRANT era saltado SEM ERRO, deixando o código QR do ecrã de
--        entrada (Login.tsx → useSignupInviteCode) sem resposta para quem não tem sessão.
--      * `self_signup_role()` faltava por completo. O /signup chama-a anonimamente ao
--        abrir (SignUp.tsx: "Read once, anonymously; it only changes the words").
--    Nada fora disto deve ser anon.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.get_login_branding()',
    'public.list_tablet_accounts_public()',
    'public.check_invite_code(text)',
    'public.signup_invite_code()',
    'public.self_signup_role()'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN
      -- Em vez de saltar em silencio. Era assim que `signup_invite_code(text)` — uma
      -- assinatura que nao existe — passava despercebido: `to_regprocedure` devolvia
      -- NULL, o GRANT nao corria, e o codigo QR do ecra de entrada ficava sem resposta
      -- para quem ainda nao tem sessao. Um nome errado aqui tranca gente de fora, por
      -- isso falha alto.
      RAISE EXCEPTION 'Allowlist aponta para funcao inexistente: %', fn;
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', fn);
  END LOOP;
END $$;

-- Nota operacional: se as funções forem criadas por mais do que um role de BD, o default
-- privilege é por-role — confirma com `\ddp`/pg_default_acl e repete o passo 1 com
-- `FOR ROLE <role>` para cada um. O teste de regressão
-- (no_public_function_is_anon_executable_test.sql) deteta qualquer regresso.

-- F-2: rate-limit/lockout na verificação do PIN de engenheiro.
--
-- Problema: verify-engineer-pin autentica o chamador (qualquer utilizador com sessão) e
-- chama verify_pin_by_code(_pin), que procura em TODOS os engenheiros ativos por um PIN
-- de 4-6 dígitos SEM contador de tentativas. O caminho de admin já tem lockout
-- (verify_admin_pin_with_lockout + admin_pin_attempts); o de engenheiro não. Como o match
-- é contra qualquer engenheiro, a entropia efetiva é ainda menor e o espaço é
-- brute-forçável por qualquer conta autenticada, devolvendo a identidade de um engenheiro.
--
-- Correção: espelhar exatamente o padrão do admin — tentativas keyed em auth.uid() (o
-- chamador que adivinha), 5 tentativas livres e escada de lockout [30,60,120,300]s. A
-- função é chamada pelo cliente USER-SCOPED na edge (para auth.uid() resolver), tal como
-- verify_admin_pin_with_lockout.
--
-- Não altera verify_pin_by_code (mantém-se service_role-only para compatibilidade até a
-- edge atualizada estar confirmada em produção; pode ser removida num follow-up).

-- 1) Tentativas por chamador (mesma forma que admin_pin_attempts; escrita só pela função)
CREATE TABLE IF NOT EXISTS public.engineer_pin_attempts (
  user_id uuid PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  lockout_step integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_attempt timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.engineer_pin_attempts ENABLE ROW LEVEL SECURITY;
-- Sem policies para anon/authenticated: a tabela é escrita apenas pela função
-- SECURITY DEFINER (que corre como owner). O service_role mantém acesso direto.
GRANT ALL ON public.engineer_pin_attempts TO service_role;

-- 2) Verificação com lockout. Devolve jsonb, como o lado admin.
CREATE OR REPLACE FUNCTION public.verify_engineer_pin_with_lockout(_pin text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _now timestamptz := now();
  _row public.engineer_pin_attempts%ROWTYPE;
  _eid uuid;
  _ename text;
  _step integer;
  _wait integer;
  _max_free constant integer := 5;
  _ladder constant integer[] := ARRAY[30, 60, 120, 300];
BEGIN
  -- Tem de ser chamada por um cliente user-scoped (auth.uid() não nulo). Mantém o
  -- comportamento atual: qualquer utilizador autenticado pode verificar, sem role
  -- específica — o lockout conta contra quem adivinha.
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Forbidden: sign in required';
  END IF;

  SELECT * INTO _row FROM public.engineer_pin_attempts WHERE user_id = _uid FOR UPDATE;

  IF _row.locked_until IS NOT NULL AND _row.locked_until > _now THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'locked',
      'locked_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_row.locked_until - _now)))::int),
      'remaining', 0);
  END IF;

  SELECT e.id, e.name INTO _eid, _ename
  FROM public.engineers e
  WHERE e.is_active = true
    AND e.pin_hash = extensions.crypt(_pin, e.pin_hash)
  LIMIT 1;

  IF _eid IS NOT NULL THEN
    DELETE FROM public.engineer_pin_attempts WHERE user_id = _uid;
    RETURN jsonb_build_object('success', true, 'engineer_id', _eid, 'engineer_name', _ename);
  END IF;

  INSERT INTO public.engineer_pin_attempts (user_id, failures, lockout_step, last_attempt, updated_at)
  VALUES (_uid, 1, 0, _now, _now)
  ON CONFLICT (user_id) DO UPDATE
    SET failures = engineer_pin_attempts.failures + 1, last_attempt = _now, updated_at = _now
  RETURNING * INTO _row;

  IF _row.failures > _max_free THEN
    _step := LEAST(_row.failures - _max_free, array_length(_ladder, 1));
    _wait := _ladder[_step];
    UPDATE public.engineer_pin_attempts
       SET locked_until = _now + make_interval(secs => _wait), lockout_step = _step
     WHERE user_id = _uid;
    RETURN jsonb_build_object('success', false, 'error', 'locked', 'locked_seconds', _wait, 'remaining', 0);
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'invalid_pin',
    'remaining', GREATEST(0, _max_free - _row.failures));
END;
$function$;

-- 3) Grants: chamada pelo cliente user-scoped (authenticated). Nunca anon.
REVOKE EXECUTE ON FUNCTION public.verify_engineer_pin_with_lockout(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_engineer_pin_with_lockout(text) TO authenticated, service_role;

-- F-4: rate-limit por utilizador para os proxies de IA (abuso de custo).
--
-- translate-message e identify-part autenticam o chamador mas não limitam o ritmo, por
-- isso qualquer conta autenticada pode gastar quota paga (identify-part usa Claude Sonnet
-- com visão e imagens até 6 MB — o mais caro). Este é um limitador por (utilizador,
-- balde), em BD (robusto entre instâncias, ao contrário de um contador em memória por
-- instância), reutilizável por qualquer edge function.
--
-- A função é chamada SERVER-SIDE pela edge com a service-role, passando o user_id já
-- verificado do token — por isso recebe _user_id explicitamente e é service_role-only
-- (um utilizador não a pode chamar para manipular o seu próprio contador).

CREATE TABLE IF NOT EXISTS public.ai_usage_limits (
  user_id uuid NOT NULL,
  bucket text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, bucket)
);

ALTER TABLE public.ai_usage_limits ENABLE ROW LEVEL SECURITY;
-- Sem policies para anon/authenticated: escrita apenas pela função SECURITY DEFINER
-- (corre como owner) e pelo service_role direto.
GRANT ALL ON public.ai_usage_limits TO service_role;

-- Incrementa a contagem na janela atual e diz se o pedido é permitido. Janela fixa:
-- quando a janela expira, reinicia. Atómico via INSERT ... ON CONFLICT DO UPDATE.
CREATE OR REPLACE FUNCTION public.ai_rate_limit_hit(
  _user_id uuid,
  _bucket text,
  _limit integer,
  _window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _now timestamptz := now();
  _row public.ai_usage_limits%ROWTYPE;
  _expired boolean;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user required';
  END IF;
  IF _bucket IS NULL OR _limit IS NULL OR _limit < 1 OR _window_seconds IS NULL OR _window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate-limit parameters';
  END IF;

  INSERT INTO public.ai_usage_limits (user_id, bucket, window_start, count)
  VALUES (_user_id, _bucket, _now, 1)
  ON CONFLICT (user_id, bucket) DO UPDATE SET
    window_start = CASE
      WHEN public.ai_usage_limits.window_start < _now - make_interval(secs => _window_seconds)
      THEN _now ELSE public.ai_usage_limits.window_start END,
    count = CASE
      WHEN public.ai_usage_limits.window_start < _now - make_interval(secs => _window_seconds)
      THEN 1 ELSE public.ai_usage_limits.count + 1 END
  RETURNING * INTO _row;

  IF _row.count > _limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'retry_after', GREATEST(1, CEIL(EXTRACT(EPOCH FROM
        (_row.window_start + make_interval(secs => _window_seconds) - _now)))::int));
  END IF;

  RETURN jsonb_build_object('allowed', true, 'remaining', GREATEST(0, _limit - _row.count));
END;
$function$;

-- Server-side only: a edge chama-a com a service-role e o user_id verificado.
REVOKE EXECUTE ON FUNCTION public.ai_rate_limit_hit(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_rate_limit_hit(uuid, text, integer, integer) TO service_role;

-- ================================================================
-- BLOCO 112
-- 20261021150000_overtime_keeps_a_rest_between_shifts.sql
-- ================================================================
--
-- Uma oferta de overtime deixa de aparecer (e um "sim" deixa de ser aceite) a quem, juntando
-- o turno que ja tem e esse overtime, trabalharia mais de 13 h em 24 h: uma pessoa de turno
-- de dia (06:00-18:00) deixa de ver overtime de noite (18:00-06:00) no mesmo dia, e o
-- contrario. A regra e "descanso minimo" (`overtime_rules.min_rest_hours`, por omissao 11 h,
-- o minimo legal do Reino Unido; 0 desliga-a) e le o quadro, a escala e o overtime ja dado.
-- Esticar um turno (06:00-14:00 + 14:00-18:00 = 12 h) continua permitido. Nao muda dados,
-- nem as politicas; so acrescenta uma coluna a overtime_rules e redefine a regra de conflito.
-- Pode colar-se duas vezes. Precisa do BLOCO 95 (overtime_schedule_clash) e do BLOCO 93.
-- Teste depois: supabase/tests/overtime_rest_between_shifts_test.sql (acaba em ALL TESTS PASSED, com ROLLBACK).
--
-- Overtime keeps a rest between shifts.
--
-- WHAT WAS WRONG. `overtime_schedule_clash` answered one question: do the hours of the ask
-- OVERLAP hours the person is already down for? A Day-crew person on 06:00-18:00 does not
-- overlap a Night ask on 18:00-06:00 — they touch — so the ask was offered, the yes was
-- accepted, and the person was booked for 24 hours in a row. The header of that block said
-- so: "the cross-shift rules (rest, the supervisor's choice) are where they always were".
-- They were nowhere.
--
-- THE RULE. Over any 24 hours, the work they already have (board, rota, overtime accepted on
-- another ask) plus this ask must leave `min_rest_hours` of rest — i.e. at most
-- 24 - min_rest_hours hours of work. With the default of 11, 13 hours.
--   * Day 06:00-18:00 then Night 18:00-06:00 .......... 24 h in 24 h  -> not offered
--   * Night ending 06:00 then Day ask 06:00-18:00 ..... 24 h           -> not offered
--   * 06:00-14:00 then overtime 14:00-18:00 ........... 12 h          -> offered (a longer day)
--   * 06:00-18:00 then overtime 04:00-16:00 next day .. 14 h in 24 h  -> not offered (10 h rest)
--   * 06:00-18:00 then overtime 05:00-17:00 next day .. 13 h in 24 h  -> offered  (11 h rest)
-- Overlap is still refused exactly as before. Every caller of the rule — the phone
-- (`my_overtime_clashes`), the supervisor's screen, the bell (`overtime_notify_targets`),
-- the guard on a yes — follows, because they all call the one function.
--
-- `min_rest_hours` lives on `overtime_rules`, the row the Overtime Rules dialog already
-- saves, so the office can change it (0 turns the rule off) without a deploy.

-- ── 1. The setting ──────────────────────────────────────────────────────────
alter table public.overtime_rules
  add column if not exists min_rest_hours integer not null default 11;
alter table public.overtime_rules drop constraint if exists overtime_rules_min_rest_hours_check;
alter table public.overtime_rules
  add constraint overtime_rules_min_rest_hours_check check (min_rest_hours between 0 and 23);

-- ── 2. Two work periods, one 24-hour window ─────────────────────────────────
-- True when some 24-hour window holds more than (24 - rest) hours of the two periods.
-- The worst window starts at one of the four edges, so those are the four tried.
create or replace function public.overtime_rest_short(
  p_a_from timestamp, p_a_to timestamp, p_b_from timestamp, p_b_to timestamp, p_rest_hours integer)
returns boolean
language sql immutable
as $$
  with w(s) as (values (p_a_from), (p_b_from), (p_a_to - interval '24 hours'), (p_b_to - interval '24 hours')),
  worked as (
    select
      greatest(0, extract(epoch from least(p_a_to, s + interval '24 hours') - greatest(p_a_from, s)))
      + greatest(0, extract(epoch from least(p_b_to, s + interval '24 hours') - greatest(p_b_from, s))) as secs
    from w
  )
  select coalesce(p_rest_hours, 0) > 0
     and coalesce(bool_or(secs > (24 - p_rest_hours) * 3600), false)
  from worked
$$;

revoke all on function public.overtime_rest_short(timestamp, timestamp, timestamp, timestamp, integer) from public, anon;
grant execute on function public.overtime_rest_short(timestamp, timestamp, timestamp, timestamp, integer) to authenticated;

-- ── 3. The one rule, now with rest ──────────────────────────────────────────
create or replace function public.overtime_schedule_clash(p_employee_id uuid, p_request_id uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_req      public.overtime_requests;
  v_ot_from  timestamp;
  v_ot_to    timestamp;
  v_day      date;
  v_crew     text;
  v_pattern  uuid;
  v_days     smallint[];
  v_p_start  time;
  v_p_end    time;
  v_board    text;
  v_drawn    boolean;
  v_start    time;
  v_end      time;
  v_from     timestamp;
  v_to       timestamp;
  b          record;
  o          record;
  v_rest     integer := coalesce((select r.min_rest_hours from public.overtime_rules r where r.id), 0);
begin
  if p_employee_id is null then return null; end if;
  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null then return null; end if;

  -- Local wall time throughout: the ask, the rota and the board are all written in it.
  v_ot_from := v_req.on_date + v_req.starts_at;
  v_ot_to   := v_req.on_date + v_req.ends_at;
  if v_req.ends_at <= v_req.starts_at then v_ot_to := v_ot_to + interval '1 day'; end if;

  -- Overtime already given on another ask.
  for o in
    select q.on_date, q.starts_at, q.ends_at
      from public.overtime_responses r
      join public.overtime_requests q on q.id = r.request_id
     where r.employee_id = p_employee_id
       and r.decision = 'accepted'
       and q.id <> v_req.id
       and q.status <> 'cancelled'
       and q.on_date between v_req.on_date - 1 and v_req.on_date + 1
       and not exists (
         select 1 from public.overtime_outcomes x
          where x.response_id = r.id
            and x.outcome in ('no_show', 'called_sick', 'cancelled', 'cancelled_in_time', 'cancelled_late'))
  loop
    v_from := o.on_date + o.starts_at;
    v_to   := o.on_date + o.ends_at;
    if o.ends_at <= o.starts_at then v_to := v_to + interval '1 day'; end if;
    if v_from < v_ot_to and v_ot_from < v_to then
      return format('Already down for overtime on %s, %s–%s',
        to_char(o.on_date, 'Dy DD/MM'), to_char(o.starts_at, 'HH24:MI'), to_char(o.ends_at, 'HH24:MI'));
    end if;
    if public.overtime_rest_short(v_from, v_to, v_ot_from, v_ot_to, v_rest) then
      return format('Already down for overtime on %s, %s–%s',
        to_char(o.on_date, 'Dy DD/MM'), to_char(o.starts_at, 'HH24:MI'), to_char(o.ends_at, 'HH24:MI')) ||
        format(' (not enough rest: at most %s h of work in any 24 h)', 24 - v_rest);
    end if;
  end loop;

  -- The normal schedule, the day before through the day after.
  for v_day in
    select d::date from generate_series(v_req.on_date - 1, v_req.on_date + 1, interval '1 day') d
  loop
    -- The crew and rota held on that date, not today's.
    v_crew := null; v_pattern := null;
    select h.shift_group, h.shift_pattern_id into v_crew, v_pattern
      from public.employee_shift_history h
     where h.employee_id = p_employee_id and h.effective_from <= v_day
     order by h.effective_from desc
     limit 1;
    if not found then
      select e.shift_group, e.shift_pattern_id into v_crew, v_pattern
        from public.employees e where e.id = p_employee_id;
    end if;

    v_days := null; v_p_start := null; v_p_end := null;
    if v_pattern is not null then
      select p.days, coalesce(pd.starts_at, p.starts_at), coalesce(pd.ends_at, p.ends_at)
        into v_days, v_p_start, v_p_end
        from public.shift_patterns p
        left join public.shift_pattern_days pd
          on pd.pattern_id = p.id and pd.weekday = extract(isodow from v_day)
       where p.id = v_pattern;
    elsif v_crew in ('Weekend', 'Warehouse Weekend') then
      v_days := array[5, 6, 7, 1]::smallint[];
    end if;
    -- The board a crew is drawn on: Night, or Day for every other crew.
    v_board := case when v_crew is null then null when v_crew = 'Night' then 'Night' else 'Day' end;

    -- The board, where it has been drawn for this person on this day.
    v_drawn := false;
    for b in
      select a.shift, a.status, a.sheet_start_time, a.overtime_request_id
        from public.daily_allocations a
       where a.employee_id = p_employee_id and a.on_date = v_day
    loop
      v_drawn := true;
      -- Rows an ask wrote are the accepted answers above, read with their own hours.
      continue when b.overtime_request_id is not null;
      continue when b.status not in ('assigned', 'overtime');

      if b.shift = v_board and v_p_start is not null and v_p_end is not null then
        v_start := v_p_start; v_end := v_p_end;
      elsif b.shift = 'Night' then
        v_start := '18:00'; v_end := '06:00';
      else
        v_start := '06:00'; v_end := '18:00';
      end if;
      -- The sheet's own start, when it wrote one ("09:00").
      if b.sheet_start_time ~ '^\s*([01]?\d|2[0-3]):[0-5]\d\s*$' then
        v_start := trim(b.sheet_start_time)::time;
      end if;

      v_from := v_day + v_start;
      v_to   := v_day + v_end;
      if v_end <= v_start then v_to := v_to + interval '1 day'; end if;
      if v_from < v_ot_to and v_ot_from < v_to then
        return format('%s on the %s shift on %s, %s–%s',
          case when b.status = 'overtime' then 'Already down for overtime' else 'Rostered' end,
          lower(b.shift), to_char(v_day, 'Dy DD/MM'),
          to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI'));
      end if;
      if public.overtime_rest_short(v_from, v_to, v_ot_from, v_ot_to, v_rest) then
        return format('%s on the %s shift on %s, %s–%s',
          case when b.status = 'overtime' then 'Already down for overtime' else 'Rostered' end,
          lower(b.shift), to_char(v_day, 'Dy DD/MM'),
          to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI')) ||
          format(' (not enough rest: at most %s h of work in any 24 h)', 24 - v_rest);
      end if;
    end loop;

    -- Not drawn yet: the rota says whether they are due.
    if not v_drawn and v_board is not null and v_days is not null
       and extract(isodow from v_day)::smallint = any (v_days) then
      v_start := coalesce(v_p_start, case v_board when 'Night' then '18:00'::time else '06:00'::time end);
      v_end   := coalesce(v_p_end,   case v_board when 'Night' then '06:00'::time else '18:00'::time end);
      v_from := v_day + v_start;
      v_to   := v_day + v_end;
      if v_end <= v_start then v_to := v_to + interval '1 day'; end if;
      if v_from < v_ot_to and v_ot_from < v_to then
        return format('Your rota has you on the %s shift on %s, %s–%s',
          lower(v_board), to_char(v_day, 'Dy DD/MM'),
          to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI'));
      end if;
      if public.overtime_rest_short(v_from, v_to, v_ot_from, v_ot_to, v_rest) then
        return format('Your rota has you on the %s shift on %s, %s–%s',
          lower(v_board), to_char(v_day, 'Dy DD/MM'),
          to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI')) ||
          format(' (not enough rest: at most %s h of work in any 24 h)', 24 - v_rest);
      end if;
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.overtime_schedule_clash(uuid, uuid) from public, anon, authenticated;

-- ── 4. A yes the rule refuses says which rule ───────────────────────────────
-- The same guard as before (BLOCO 95), with the message told apart: overlapping your own
-- hours is "already yours"; too little rest is not.
create or replace function public.overtime_response_schedule_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_clash text;
begin
  if new.answer is distinct from 'yes' or new.decision is not null then return new; end if;
  if tg_op = 'UPDATE' and old.answer = 'yes' then return new; end if;
  if auth.uid() is null or public.can_manage_overtime(auth.uid()) then return new; end if;

  v_clash := public.overtime_schedule_clash(new.employee_id, new.request_id);
  if v_clash is not null then
    if v_clash like '%(not enough rest:%' then
      raise exception 'Not enough rest between your shifts: %', v_clash using errcode = 'P0001';
    end if;
    raise exception 'These hours are already yours: %', v_clash using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.overtime_response_schedule_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ================================================================
-- BLOCO 113
-- 20261021160000_operators_have_no_overtime_or_attendance.sql
-- ================================================================
--
-- O operador continua a poder entrar, mas Overtime e Attendance deixam de existir para ele.
-- No ecra isso ja era assim (a matriz de permissoes nao da `overtime.respond` nem
-- `attendance.view_own` ao `operator`); aqui fecha-se no backend, que e o que conta: quem
-- chamar as funcoes directamente, sem passar pelo menu, tambem nao recebe nada.
--
-- Todas as funcoes "do proprio" (my_attendance, answer_overtime, my_overtime_clashes, o
-- sino do overtime, as respostas do proprio) perguntam quem e a pessoa a `my_employee_id()`.
-- Passa a responder NULL a um login de operador que nao tenha nenhuma das duas permissoes — com a mesma regra da
-- matriz (`has_action`, que respeita as excepcoes guardadas no ecra de Permissoes). Um
-- operador a quem o admin der a permissao la volta a ter acesso; sem ela, nao.
--
-- NAO apaga nem muda dados: registos de attendance e de overtime ficam como estao, e
-- admin / manager mantem tudo. `my_employee_id()` so e usada por overtime e attendance.
--
-- An operator can still sign in, but Overtime and Attendance do not exist for them. The
-- screen already hid both; this closes it in the database too. `my_employee_id()` — the one
-- function every "my own" overtime/attendance function asks — now answers NULL for an operator login unless it holds `overtime.respond` or `attendance.view_own` (same rule as the matrix, so a
-- grant on the Permissions screen still counts). No data is touched.

create or replace function public.my_employee_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select e.id
    from public.employees e
   where e.user_id = auth.uid()
     and e.active
     and (
       -- Only a login that is an operator is held back; everybody else is exactly as before.
       not exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'operator'::app_role)
       or public.has_action(auth.uid(), 'overtime.respond',
         array['admin','manager','production_office_admin','maintenance_manager',
               'warehouse','quality_supervisor','employee']::app_role[])
       or public.has_action(auth.uid(), 'attendance.view_own',
         array['admin','manager','production_office_admin','maintenance_manager',
               'warehouse','quality_supervisor','employee']::app_role[])
     )
   limit 1;
$$;

revoke all on function public.my_employee_id() from public, anon;
grant execute on function public.my_employee_id() to authenticated;

-- As ofertas de overtime eram legiveis por qualquer sessao (`using (true)`). Passam a nao ser
-- por um login que so seja operador: quem tem outro papel, ou a permissao de overtime/
-- attendance (por papel ou por excepcao), le como antes.
-- The asks themselves were readable by any signed-in session. A login that is only an
-- operator no longer reads them; anybody with another role, or the permission, reads as before.
drop policy if exists "overtime_requests_read" on public.overtime_requests;
create policy "overtime_requests_read" on public.overtime_requests
  for select to authenticated
  using (
    not exists (select 1 from public.user_roles ur where ur.user_id = auth.uid() and ur.role = 'operator'::app_role)
    or public.my_employee_id() is not null
    or public.can_manage_overtime(auth.uid())
    or public.has_action(auth.uid(), 'overtime.respond',
         array['admin','manager','production_office_admin','maintenance_manager',
               'warehouse','quality_supervisor','employee']::app_role[])
  );

notify pgrst, 'reload schema';

-- ================================================================
-- BLOCO 114
-- 20261021170000_employees_can_write_to_each_other.sql
-- ================================================================
--
-- Um employee passa a poder comecar uma conversa com OUTRO employee, alem do supervisor
-- registado (que continua a ser pela porta `message_my_supervisor`). Ate aqui so podia
-- responder a quem lhe escrevia.
--
--   1. Nova politica de INSERT em `direct_messages` (as politicas somam-se; nenhuma das que
--      existem muda): remetente e destinatario com papel `employee`, nao a si proprio.
--   2. `chat_may_start` ganha a mesma clausula, para a lista do Communication Hub continuar
--      a ser exactamente o que o INSERT aceita (o teste hub_contactable_people confere par a par).
--   3. O sino: uma mensagem de um employee a outro toca "X sent you a message" e abre a
--      conversa no Messages. Antes, qualquer mensagem a um employee dizia "Your supervisor
--      replied" e abria o My Overtime — certo para o supervisor, errado para um colega.
--
-- Operadores, admins e managers: sem alteracoes. Um employee continua sem poder escrever
-- a operadores, a admins nem a managers (so ao supervisor registado, e a responder).
-- Nao muda nem apaga dados.
--
-- An employee may now start a conversation with another employee, as well as with the
-- supervisor on file (still through `message_my_supervisor`). Before, they could only answer
-- whoever wrote to them. A new additive INSERT policy on `direct_messages`; the same clause in
-- `chat_may_start` so the hub's list stays exactly what the insert accepts; and the bell says
-- "X sent you a message" (opening Messages) for a peer message, instead of "Your supervisor
-- replied". No other role changes. No data is touched.

drop policy if exists "dm_insert_employee_peers" on public.direct_messages;
create policy "dm_insert_employee_peers" on public.direct_messages
  for insert to authenticated
  with check (
    auth.uid() = sender_id
    and sender_id <> recipient_id
    and public.has_role(sender_id, 'employee'::app_role)
    and public.has_role(recipient_id, 'employee'::app_role)
  );

create or replace function public.chat_may_start(p_from uuid, p_to uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  select p_from is not null and p_to is not null and p_from <> p_to and (
       (public.has_role(p_from, 'operator'::app_role)
         and (public.has_role(p_to, 'supervisor'::app_role) or public.is_operator_chat_admin(p_to)))
    or public.has_role(p_from, 'supervisor'::app_role)
    or public.is_operator_chat_admin(p_from)
    or ((public.has_role(p_from, 'admin'::app_role) or public.has_role(p_from, 'manager'::app_role)
         or public.has_role(p_from, 'maintenance_manager'::app_role) or public.has_role(p_from, 'warehouse'::app_role))
        and not public.has_role(p_to, 'operator'::app_role))
    or (public.has_role(p_from, 'employee'::app_role) and public.has_role(p_to, 'employee'::app_role))
  );
$$;
revoke all on function public.chat_may_start(uuid, uuid) from public, anon, authenticated;

create or replace function public.dm_employee_bell()
returns trigger
language plpgsql security definer set search_path = public
as $$
begin
  begin
    if coalesce(current_setting('app.dm_door', true), '') = 'employee' then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (new.recipient_id, 'overtime_message',
              coalesce(nullif(new.sender_name, ''), 'An employee') || ' sent you a message',
              left(new.message, 200), 'medium', '/dashboard/messages');
    elsif public.has_role(new.sender_id, 'employee'::app_role)
          and public.has_role(new.recipient_id, 'employee'::app_role) then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (new.recipient_id, 'chat_message',
              coalesce(nullif(new.sender_name, ''), 'A colleague') || ' sent you a message',
              left(new.message, 200), 'medium', '/dashboard/messages?c=dm:' || new.sender_id);
    elsif (public.has_role(new.recipient_id, 'employee'::app_role)
           or public.has_role(new.recipient_id, 'operator'::app_role))
          and exists (select 1 from public.employees e where e.user_id = new.recipient_id and e.active) then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (new.recipient_id, 'chat_message',
              coalesce(nullif(new.sender_name, ''), 'Your supervisor') || ' replied',
              left(new.message, 200), 'medium', '/dashboard/my-overtime?chat=supervisor');
    end if;
  exception when others then
    raise warning 'dm_employee_bell(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.dm_employee_bell() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ================================================================
-- BLOCO 115
-- 20261021180000_an_employee_can_have_more_than_one_supervisor.sql
-- ================================================================
--
-- "Reports to" passa a aceitar mais de um supervisor. `employees.manager_id` continua a
-- existir e passa a ser o PRIMEIRO supervisor (o que ja era para tudo o que le um so);
-- a lista completa vive em `employee_supervisors`. O que muda:
--   * `employee_supervisors` (employee_id, supervisor_id, position): preenchida a partir
--     do manager_id que ja existe (so acrescenta linhas); ninguem escreve nela a direito,
--     so `set_employee_supervisors()` (quem tem `workforce.manage`), que tambem poe o
--     manager_id no primeiro. Maximo 5; nunca a propria pessoa; so pessoas activas.
--   * `my_supervisor()` devolve todos os supervisores com login (antes, um).
--   * `message_my_supervisor(texto, supervisor opcional)`: sem o segundo, escreve ao
--     primeiro, como antes; com ele, a esse (tem de ser um dos seus).
--   * o aviso "X vem fazer overtime" toca a todos os supervisores, uma vez cada.
--   * os grupos do chat contam os reportes de qualquer um dos supervisores.
-- Nao apaga nem reescreve nenhum employee, mensagem ou notificacao.
--
-- "Reports to" now takes more than one supervisor. `employees.manager_id` stays and is the
-- FIRST supervisor (so everything that reads one keeps working); the full list is in
-- `employee_supervisors`, back-filled from manager_id (adds rows only) and written only by
-- `set_employee_supervisors()`. `my_supervisor()` returns all of them; the overtime "is
-- coming in" bell rings each once; chat group scope counts reports of any supervisor.

create table if not exists public.employee_supervisors (
  employee_id   uuid not null references public.employees(id) on delete cascade,
  supervisor_id uuid not null references public.employees(id) on delete cascade,
  position      smallint not null default 0,
  primary key (employee_id, supervisor_id),
  check (employee_id <> supervisor_id)
);
create index if not exists employee_supervisors_supervisor_idx on public.employee_supervisors (supervisor_id);

insert into public.employee_supervisors (employee_id, supervisor_id, position)
select e.id, e.manager_id, 0 from public.employees e
 where e.manager_id is not null and e.manager_id <> e.id
on conflict do nothing;

alter table public.employee_supervisors enable row level security;
revoke all on public.employee_supervisors from public, anon, authenticated;
grant select on public.employee_supervisors to authenticated;
drop policy if exists "employee_supervisors_read" on public.employee_supervisors;
create policy "employee_supervisors_read" on public.employee_supervisors
  for select to authenticated
  using (public.has_action((select auth.uid()), 'workforce.view', array['admin']::app_role[]));

create or replace function public.set_employee_supervisors(p_employee uuid, p_supervisors uuid[])
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_ids uuid[];
begin
  if not public.has_action(auth.uid(), 'workforce.manage', array['admin']::app_role[]) then
    raise exception 'Not allowed' using errcode = '42501';
  end if;
  if not exists (select 1 from public.employees where id = p_employee) then
    raise exception 'No such employee' using errcode = 'P0001';
  end if;
  -- In the order given, once each, never the person themselves, only active records.
  select coalesce(array_agg(s order by o), '{}') into v_ids
    from (select s, min(o) as o
            from unnest(coalesce(p_supervisors, '{}')) with ordinality as t(s, o)
           where s <> p_employee and exists (select 1 from public.employees x where x.id = s and x.active)
           group by s) q;
  if cardinality(v_ids) > 5 then
    raise exception 'At most 5 supervisors' using errcode = 'P0001';
  end if;

  delete from public.employee_supervisors where employee_id = p_employee and not (supervisor_id = any (v_ids));
  insert into public.employee_supervisors (employee_id, supervisor_id, position)
  select p_employee, v_ids[i], (i - 1)::smallint from generate_subscripts(v_ids, 1) i
  on conflict (employee_id, supervisor_id) do update set position = excluded.position;
  update public.employees set manager_id = v_ids[1] where id = p_employee and manager_id is distinct from v_ids[1];
end;
$$;
revoke all on function public.set_employee_supervisors(uuid, uuid[]) from public, anon;
grant execute on function public.set_employee_supervisors(uuid, uuid[]) to authenticated;

-- Every active supervisor with a login, in order: the table, and manager_id for a row not yet in it.
create or replace function public.supervisor_logins_of(p_employee uuid)
returns table (login uuid, ord integer)
language sql stable security definer set search_path = public
as $$
  select m.user_id, min(x.position)::integer
    from (select supervisor_id, position from public.employee_supervisors where employee_id = p_employee
          union all
          select e.manager_id, 0::smallint from public.employees e
           where e.id = p_employee and e.manager_id is not null
             and not exists (select 1 from public.employee_supervisors s where s.employee_id = e.id)) x
    join public.employees m on m.id = x.supervisor_id
    join public.employees me on me.id = p_employee
   where m.active and m.user_id is not null and m.user_id is distinct from me.user_id
   group by m.user_id
   order by min(x.position), m.user_id;
$$;
revoke all on function public.supervisor_logins_of(uuid) from public, anon, authenticated;

create or replace function public.my_supervisor()
returns table (user_id uuid, full_name text)
language sql stable security definer set search_path = public
as $$
  select m.user_id, m.full_name
    from public.supervisor_logins_of(public.my_employee_id()) l
    join public.employees m on m.user_id = l.login and m.active
   where m.user_id is distinct from auth.uid()
   order by l.ord, m.full_name;
$$;
revoke all on function public.my_supervisor() from public, anon;
grant execute on function public.my_supervisor() to authenticated;

drop function if exists public.message_my_supervisor(text);
create or replace function public.message_my_supervisor(p_message text, p_supervisor uuid default null)
returns uuid
language plpgsql security definer set search_path = public
as $$
declare
  v_emp  uuid := public.my_employee_id();
  v_name text;
  v_text text := btrim(coalesce(p_message, ''));
  v_to   uuid;
begin
  if v_emp is null then
    raise exception 'No employee record is linked to this login' using errcode = 'P0001';
  end if;
  if length(v_text) = 0 then
    raise exception 'Write a message first' using errcode = 'P0001';
  end if;
  if length(v_text) > 1000 then
    raise exception 'Keep it under 1000 characters' using errcode = 'P0001';
  end if;
  if p_supervisor is null then
    v_to := public.supervisor_login_of(v_emp);
  elsif exists (select 1 from public.supervisor_logins_of(v_emp) l where l.login = p_supervisor) then
    v_to := p_supervisor;
  else
    raise exception 'That is not one of your supervisors' using errcode = 'P0001';
  end if;
  if v_to is null or v_to = auth.uid() then
    raise exception 'No supervisor is on file for you yet. Ask the office to set your manager.' using errcode = 'P0001';
  end if;
  select full_name into v_name from public.employees where id = v_emp;
  return public.dm_from_employee(v_to, v_name, v_text);
end;
$$;
revoke all on function public.message_my_supervisor(text, uuid) from public, anon;
grant execute on function public.message_my_supervisor(text, uuid) to authenticated;

create or replace function public.overtime_response_booked_notify()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_req  public.overtime_requests;
  v_user uuid;
  v_name text;
  v_when text;
  v_to   uuid;
begin
  if new.decision is null or new.decision not in ('accepted', 'reserve') then return null; end if;
  if tg_op = 'UPDATE' and old.decision is not distinct from new.decision then return null; end if;

  begin
    select * into v_req from public.overtime_requests where id = new.request_id;
    select user_id, full_name into v_user, v_name from public.employees where id = new.employee_id;
    v_when := to_char(v_req.on_date, 'Dy DD/MM') || ' · ' || left(v_req.starts_at::text, 5)
              || '–' || left(v_req.ends_at::text, 5) || coalesce(' · ' || v_req.department, '');

    if v_user is not null then
      insert into public.notifications (user_id, kind, title, body, priority, action_url)
      values (v_user, 'overtime_booked',
              case when new.decision = 'accepted' then 'You''re booked for overtime'
                   else 'You''re on the overtime reserve list' end,
              v_when, 'medium', '/dashboard/my-overtime?ask=' || v_req.id);
    end if;

    -- The supervisor on file and the poster, unless they did it themselves, or nobody
    -- did (the one-off backlog of BLOCO 105). Once per person per ask: only when the
    -- answer is first decided, so a reserve later accepted, or a retried yes, does not
    -- ring again — and `distinct`, so one login holding both roles is rung once.
    -- (Not BLOCO 100's unique key: that is one row per ask, and an ask has many people.)
    if auth.uid() is not null and (tg_op = 'INSERT' or old.decision is null) then
      for v_to in
        select distinct t from unnest(array_append(array(select l.login from public.supervisor_logins_of(new.employee_id) l), v_req.created_by)) t
         where t is not null and t <> auth.uid() and t is distinct from v_user
      loop
        insert into public.notifications (user_id, kind, title, body, priority, action_url)
        values (v_to, 'overtime_yes',
                coalesce(v_name, 'Somebody') ||
                  case when new.decision = 'accepted' then ' is coming in' else ' said yes (on reserve)' end,
                v_when, 'medium', '/dashboard/overtime');
      end loop;
    end if;
  exception when others then
    -- The booking is the record; the bell is a courtesy. Never undo it for the bell.
    raise warning 'overtime_response_booked_notify(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.overtime_response_booked_notify() from public, anon, authenticated;

create or replace function public.chat_departments_of(p_uid uuid)
returns setof text
language sql stable security definer set search_path = public
as $$
  select distinct d from (
    select e.department as d
      from public.employees e
     where e.user_id = p_uid and e.active
    union
    select r.department
      from public.employees me
      join public.employees r on r.active
       and (r.manager_id = me.id
            or exists (select 1 from public.employee_supervisors s where s.employee_id = r.id and s.supervisor_id = me.id))
     where me.user_id = p_uid and me.active
  ) x
  where d is not null and btrim(d) <> '';
$$;
revoke all on function public.chat_departments_of(uuid) from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ================================================================
-- BLOCO 116
-- 20261021190000_an_ask_can_skip_a_crew.sql
-- ================================================================
--
-- Ao divulgar um overtime, o escritorio pode escolher NAO enviar a uma ou mais equipas
-- (por exemplo "todos menos a equipa Night"). Ate aqui so dava para escolher uma equipa ou todas.
--   * `overtime_requests.excluded_shift_groups` (text[], por omissao vazio): so acrescenta
--     uma coluna; os pedidos que ja existem ficam como estao (ninguem excluido).
--   * `overtime_notify_targets`: quem e avisado no sino deixa de incluir essas equipas.
--   * uma guarda em `overtime_responses`: um "sim" ou "nao" da PROPRIA pessoa dessas equipas
--     e recusado (quem acrescenta um sim dado ao balcao continua a poder).
-- No telemovel o pedido deixa de aparecer a essas equipas (o ecra ja usa a mesma regra
-- que a base). Nao apaga nem muda nenhuma resposta ou pedido.
--
-- When publishing an overtime ask the office can now choose NOT to send it to one or more
-- crews ("everybody except the Night crew"). One new column (default empty, so every existing
-- ask is unchanged); the bell skips those crews; a guard on `overtime_responses` refuses a person's own answer from them (a supervisor adding a desk yes is unaffected).
-- Nothing is deleted or changed.

alter table public.overtime_requests
  add column if not exists excluded_shift_groups text[] not null default '{}';

create or replace function public.overtime_notify_targets(p_request_id uuid)
returns table (employee_id uuid, user_id uuid)
-- plpgsql, not sql: a sql body is checked when it is created, and this one names
-- BLOCO 95's function. Out of order, the paste must not stop here.
language plpgsql stable security definer set search_path = public
as $$
begin
  return query
  select e.id, e.user_id
    from public.overtime_requests q
    join public.employees e
      on e.active
     and e.user_id is not null
     and (q.department  is null or q.department  is not distinct from e.department)
     and (q.shift_group is null or q.shift_group is not distinct from e.shift_group)
     and (e.shift_group is null or not (e.shift_group = any (coalesce(q.excluded_shift_groups, '{}'))))
   where q.id = p_request_id
     and q.status = 'open'
     and (q.on_date + q.starts_at) > (now() at time zone 'Europe/London')
     and not exists (select 1 from public.overtime_responses r
                      where r.request_id = q.id and r.employee_id = e.id)
     and not exists (select 1 from public.overtime_block_for(e.id))
     and public.overtime_schedule_clash(e.id, q.id) is null;
end;
$$;

revoke all on function public.overtime_notify_targets(uuid) from public, anon, authenticated;

-- A trigger and not a new answer_overtime: that function is defined in older blocks that
-- must stay the last word on it, and a trigger also covers any other way a person answers
-- for themselves. It only looks at a person's OWN answer, so the supervisor who adds a yes
-- given at the desk can still put somebody from a skipped crew on an ask, as before.
create or replace function public.overtime_response_crew_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_skip  text[];
  v_shift text;
begin
  if new.employee_id is distinct from public.my_employee_id() then return new; end if;
  select coalesce(q.excluded_shift_groups, '{}') into v_skip
    from public.overtime_requests q where q.id = new.request_id;
  select e.shift_group into v_shift from public.employees e where e.id = new.employee_id;
  if v_shift is not null and v_shift = any (coalesce(v_skip, '{}')) then
    raise exception 'This overtime is not being asked of the % crew', v_shift using errcode = 'P0001';
  end if;
  return new;
end;
$$;
revoke all on function public.overtime_response_crew_guard() from public, anon, authenticated;

drop trigger if exists overtime_response_crew_guard_t on public.overtime_responses;
create trigger overtime_response_crew_guard_t
  before insert or update of answer on public.overtime_responses
  for each row execute function public.overtime_response_crew_guard();

notify pgrst, 'reload schema';

-- ================================================================
-- BLOCO 117
-- 20261021200000_the_bell_rings_the_phone.sql
-- ================================================================
--
-- As linhas do sino que a propria base escreve passam a fazer vibrar o telemovel, mesmo
-- com o ecra bloqueado. Ate aqui so os pedidos de overtime chegavam ao telemovel, porque
-- so o browser de quem os cria chamava o `send-push` (`overtimeAnnounce.ts`). Uma mensagem
-- directa (`dm_employee_bell`), um "you're booked" ou um "X said yes" ficavam no sino a
-- espera que a pessoa abrisse a app.
--
--   1. `notification_push()`: um trigger AFTER INSERT em `notifications` que chama o
--      `send-push` por `pg_net`, com o `CRON_SECRET` do vault no header `x-cron-secret`
--      (o mesmo caminho do job 63, que esta vivo) e `in_app: false`, para nao escrever o
--      sino uma segunda vez.
--   2. Quais linhas: todas as que tem `kind`, menos `overtime_new`. As sem `kind` sao
--      escritas pelo proprio `send-push`, que ja fez o push nesse momento; o `overtime_new`
--      e enviado pelo browser de quem cria o pedido (`announceAsk`). Qualquer das duas aqui
--      seria um segundo toque no mesmo telemovel.
--   3. So chama quando o destinatario tem pelo menos uma subscricao, para nao encher o
--      `net._http_response` com pedidos que nao vao a lado nenhum.
--
-- Nunca recusa a linha do sino: qualquer falha (vault vazio, pg_net em baixo) fica num
-- WARNING e o INSERT segue. O `pg_net` so envia depois do COMMIT, por isso uma linha
-- revertida nao toca telemovel nenhum.
--
-- Precisa do `send-push` publicado com o ramo do `x-cron-secret` (mesmo PR). Antes disso
-- o `send-push` responde 401 ao trigger e nada pior acontece: o sino continua a funcionar.
-- Nao muda nem apaga dados.
--
-- The bell rows the database writes itself now buzz the phone too, even when it is locked.
-- An AFTER INSERT trigger on `notifications` calls `send-push` through pg_net with the
-- vault's CRON_SECRET and `in_app: false`, for every row with a `kind` except
-- `overtime_new` (the browser already pushes those) — rows without a kind are written by
-- `send-push` itself, which has already pushed them. Only for recipients with a
-- subscription. It never refuses the bell row. No data is touched.

create or replace function public.notification_push()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_secret text;
begin
  begin
    if not exists (select 1 from public.push_subscriptions s where s.user_id = new.user_id) then
      return null;
    end if;

    select decrypted_secret into v_secret
      from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1;
    if v_secret is null then
      raise warning 'notification_push(%): CRON_SECRET missing from the vault', new.id;
      return null;
    end if;

    perform net.http_post(
      url := 'https://ybtrzqzliepknpzqdajx.supabase.co/functions/v1/send-push',
      headers := jsonb_build_object(
        'Content-Type', 'application/json',
        'x-cron-secret', v_secret
      ),
      body := jsonb_strip_nulls(jsonb_build_object(
        'user_id', new.user_id,
        'title', left(coalesce(nullif(new.title, ''), 'PMSystem'), 200),
        'body', left(new.body, 2000),
        'priority', case when new.priority in ('low', 'medium', 'high', 'critical')
                         then new.priority else 'medium' end,
        'tag', left(new.kind || ':' || new.id, 100),
        'action_url', left(new.action_url, 2048),
        'wo_id', new.wo_id,
        'in_app', false
      )),
      timeout_milliseconds := 10000
    );
  exception when others then
    raise warning 'notification_push(%): %', new.id, sqlerrm;
  end;
  return null;
end;
$$;
revoke all on function public.notification_push() from public, anon, authenticated;

drop trigger if exists notification_push on public.notifications;
create trigger notification_push
  after insert on public.notifications
  for each row
  when (new.kind is not null and new.kind <> 'overtime_new')
  execute function public.notification_push();

-- ================================================================
-- BLOCO 118
-- 20261021210000_a_managers_own_overtime_yes_follows_the_same_rules.sql
-- ================================================================
--
-- PT: Quem tem permissao de gerir overtime (admin, supervisor...) e tambem e employee
-- conseguia dizer "yes" a dois overtimes do MESMO dia (ex. 06:00-18:00 e 06:00-14:00): o
-- guarda de horario (BLOCO 95/112) saltava a verificacao para qualquer gestor, mesmo quando
-- o yes era dele proprio. Passa a saltar so quando o gestor escreve o yes de OUTRA pessoa
-- (o supervisor a registar no balcao). O yes do proprio segue as mesmas regras de todos:
-- horas ja suas, descanso minimo, uma opcao por horario.
--
-- EN: Someone who can manage overtime (admin, supervisor...) and is also an employee could
-- say yes to two overtimes on the SAME day (e.g. 06:00-18:00 and 06:00-14:00): the schedule
-- guard skipped the check for any manager, even for their own yes. It now skips only when
-- the manager writes somebody ELSE's yes (the supervisor booking at the desk). Their own yes
-- follows the same rules as everyone's: hours already theirs, minimum rest, one option per slot.
--
-- PT: Alem disso, "ja e seu" passa a contar tambem o yes que ficou na reserva ou ainda sem
-- decisao, nao so o ja aceite: com a lista cheia o primeiro yes ia para a reserva e o segundo
-- passava. EN: Also, "already yours" now counts a yes on the reserve list or still undecided,
-- not only an accepted one: with the list full the first yes went to reserve and the second passed.

-- ── 1. One option per slot: a reserve or undecided yes counts too ───────────
create or replace function public.overtime_schedule_clash(p_employee_id uuid, p_request_id uuid)
returns text
language plpgsql stable security definer set search_path = public
as $$
declare
  v_req      public.overtime_requests;
  v_ot_from  timestamp;
  v_ot_to    timestamp;
  v_day      date;
  v_crew     text;
  v_pattern  uuid;
  v_days     smallint[];
  v_p_start  time;
  v_p_end    time;
  v_board    text;
  v_drawn    boolean;
  v_start    time;
  v_end      time;
  v_from     timestamp;
  v_to       timestamp;
  b          record;
  o          record;
  v_rest     integer := coalesce((select r.min_rest_hours from public.overtime_rules r where r.id), 0);
begin
  if p_employee_id is null then return null; end if;
  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null then return null; end if;

  -- Local wall time throughout: the ask, the rota and the board are all written in it.
  v_ot_from := v_req.on_date + v_req.starts_at;
  v_ot_to   := v_req.on_date + v_req.ends_at;
  if v_req.ends_at <= v_req.starts_at then v_ot_to := v_ot_to + interval '1 day'; end if;

  -- Overtime already given on another ask.
  for o in
    select q.on_date, q.starts_at, q.ends_at
      from public.overtime_responses r
      join public.overtime_requests q on q.id = r.request_id
     where r.employee_id = p_employee_id
       and (r.decision in ('accepted', 'reserve')
            or (r.decision is null and r.answer = 'yes'))
       and q.id <> v_req.id
       and q.status <> 'cancelled'
       and q.on_date between v_req.on_date - 1 and v_req.on_date + 1
       and not exists (
         select 1 from public.overtime_outcomes x
          where x.response_id = r.id
            and x.outcome in ('no_show', 'called_sick', 'cancelled', 'cancelled_in_time', 'cancelled_late'))
  loop
    v_from := o.on_date + o.starts_at;
    v_to   := o.on_date + o.ends_at;
    if o.ends_at <= o.starts_at then v_to := v_to + interval '1 day'; end if;
    if v_from < v_ot_to and v_ot_from < v_to then
      return format('Already down for overtime on %s, %s–%s',
        to_char(o.on_date, 'Dy DD/MM'), to_char(o.starts_at, 'HH24:MI'), to_char(o.ends_at, 'HH24:MI'));
    end if;
    if public.overtime_rest_short(v_from, v_to, v_ot_from, v_ot_to, v_rest) then
      return format('Already down for overtime on %s, %s–%s',
        to_char(o.on_date, 'Dy DD/MM'), to_char(o.starts_at, 'HH24:MI'), to_char(o.ends_at, 'HH24:MI')) ||
        format(' (not enough rest: at most %s h of work in any 24 h)', 24 - v_rest);
    end if;
  end loop;

  -- The normal schedule, the day before through the day after.
  for v_day in
    select d::date from generate_series(v_req.on_date - 1, v_req.on_date + 1, interval '1 day') d
  loop
    -- The crew and rota held on that date, not today's.
    v_crew := null; v_pattern := null;
    select h.shift_group, h.shift_pattern_id into v_crew, v_pattern
      from public.employee_shift_history h
     where h.employee_id = p_employee_id and h.effective_from <= v_day
     order by h.effective_from desc
     limit 1;
    if not found then
      select e.shift_group, e.shift_pattern_id into v_crew, v_pattern
        from public.employees e where e.id = p_employee_id;
    end if;

    v_days := null; v_p_start := null; v_p_end := null;
    if v_pattern is not null then
      select p.days, coalesce(pd.starts_at, p.starts_at), coalesce(pd.ends_at, p.ends_at)
        into v_days, v_p_start, v_p_end
        from public.shift_patterns p
        left join public.shift_pattern_days pd
          on pd.pattern_id = p.id and pd.weekday = extract(isodow from v_day)
       where p.id = v_pattern;
    elsif v_crew in ('Weekend', 'Warehouse Weekend') then
      v_days := array[5, 6, 7, 1]::smallint[];
    end if;
    -- The board a crew is drawn on: Night, or Day for every other crew.
    v_board := case when v_crew is null then null when v_crew = 'Night' then 'Night' else 'Day' end;

    -- The board, where it has been drawn for this person on this day.
    v_drawn := false;
    for b in
      select a.shift, a.status, a.sheet_start_time, a.overtime_request_id
        from public.daily_allocations a
       where a.employee_id = p_employee_id and a.on_date = v_day
    loop
      v_drawn := true;
      -- Rows an ask wrote are the accepted answers above, read with their own hours.
      continue when b.overtime_request_id is not null;
      continue when b.status not in ('assigned', 'overtime');

      if b.shift = v_board and v_p_start is not null and v_p_end is not null then
        v_start := v_p_start; v_end := v_p_end;
      elsif b.shift = 'Night' then
        v_start := '18:00'; v_end := '06:00';
      else
        v_start := '06:00'; v_end := '18:00';
      end if;
      -- The sheet's own start, when it wrote one ("09:00").
      if b.sheet_start_time ~ '^\s*([01]?\d|2[0-3]):[0-5]\d\s*$' then
        v_start := trim(b.sheet_start_time)::time;
      end if;

      v_from := v_day + v_start;
      v_to   := v_day + v_end;
      if v_end <= v_start then v_to := v_to + interval '1 day'; end if;
      if v_from < v_ot_to and v_ot_from < v_to then
        return format('%s on the %s shift on %s, %s–%s',
          case when b.status = 'overtime' then 'Already down for overtime' else 'Rostered' end,
          lower(b.shift), to_char(v_day, 'Dy DD/MM'),
          to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI'));
      end if;
      if public.overtime_rest_short(v_from, v_to, v_ot_from, v_ot_to, v_rest) then
        return format('%s on the %s shift on %s, %s–%s',
          case when b.status = 'overtime' then 'Already down for overtime' else 'Rostered' end,
          lower(b.shift), to_char(v_day, 'Dy DD/MM'),
          to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI')) ||
          format(' (not enough rest: at most %s h of work in any 24 h)', 24 - v_rest);
      end if;
    end loop;

    -- Not drawn yet: the rota says whether they are due.
    if not v_drawn and v_board is not null and v_days is not null
       and extract(isodow from v_day)::smallint = any (v_days) then
      v_start := coalesce(v_p_start, case v_board when 'Night' then '18:00'::time else '06:00'::time end);
      v_end   := coalesce(v_p_end,   case v_board when 'Night' then '06:00'::time else '18:00'::time end);
      v_from := v_day + v_start;
      v_to   := v_day + v_end;
      if v_end <= v_start then v_to := v_to + interval '1 day'; end if;
      if v_from < v_ot_to and v_ot_from < v_to then
        return format('Your rota has you on the %s shift on %s, %s–%s',
          lower(v_board), to_char(v_day, 'Dy DD/MM'),
          to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI'));
      end if;
      if public.overtime_rest_short(v_from, v_to, v_ot_from, v_ot_to, v_rest) then
        return format('Your rota has you on the %s shift on %s, %s–%s',
          lower(v_board), to_char(v_day, 'Dy DD/MM'),
          to_char(v_start, 'HH24:MI'), to_char(v_end, 'HH24:MI')) ||
          format(' (not enough rest: at most %s h of work in any 24 h)', 24 - v_rest);
      end if;
    end if;
  end loop;

  return null;
end;
$$;

revoke all on function public.overtime_schedule_clash(uuid, uuid) from public, anon, authenticated;

-- ── 2. The manager's own yes is checked ─────────────────────────────────────
create or replace function public.overtime_response_schedule_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_clash text;
  v_owner uuid;
begin
  if new.answer is distinct from 'yes' or new.decision is not null then return new; end if;
  if tg_op = 'UPDATE' and old.answer = 'yes' then return new; end if;
  if auth.uid() is null then return new; end if;

  select e.user_id into v_owner from public.employees e where e.id = new.employee_id;
  if public.can_manage_overtime(auth.uid()) and v_owner is distinct from auth.uid() then
    return new;
  end if;

  v_clash := public.overtime_schedule_clash(new.employee_id, new.request_id);
  if v_clash is not null then
    if v_clash like '%(not enough rest:%' then
      raise exception 'Not enough rest between your shifts: %', v_clash using errcode = 'P0001';
    end if;
    raise exception 'These hours are already yours: %', v_clash using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.overtime_response_schedule_guard() from public, anon, authenticated;

notify pgrst, 'reload schema';

-- ================================================================
-- BLOCO 119
-- 20261021220000_the_chat_list_shows_the_shift_each_person_works.sql
-- ================================================================
--
-- PT: Na lista do chat cada pessoa aparecia como "Employee · Lab" (funcao e departamento).
-- Passa a mostrar tambem o turno em que trabalha, o `employees.shift_group` (o mesmo que o
-- resto da app): "Employee · Lab · Night shift". Sem registo de employee, ou sem turno, a
-- linha fica como estava. So muda o texto de `job`; quem aparece na lista nao muda.
--
-- EN: The chat list showed each person as "Employee · Lab" (role and department). It now
-- also shows the shift they work, `employees.shift_group` (the same one the rest of the app
-- uses): "Employee · Lab · Night shift". No employee record, or no shift, and the line is
-- unchanged. Only the `job` text changes; who is listed does not.

create or replace function public.chat_contactable_people()
returns table (user_id uuid, name text, avatar_path text, job text)
language sql stable security definer set search_path = public
as $$
  with me as (select auth.uid() as id),
  sup as (
    select s.user_id from public.my_supervisor() s
  )
  select p.id,
         coalesce(e.full_name, nullif(btrim(p.name), ''), p.email, 'User'),
         p.avatar_path,
         coalesce(nullif(btrim(e.position), ''),
                  initcap(replace((select r.role::text from public.user_roles r where r.user_id = p.id limit 1), '_', ' ')))
           || coalesce(' · ' || nullif(btrim(e.department), ''), '')
           || coalesce(' · ' || nullif(btrim(e.shift_group), '') || ' shift', '')
    from public.profiles p
    cross join me
    left join lateral (select x.full_name, x.position, x.department, x.shift_group from public.employees x
                        where x.user_id = p.id and x.active limit 1) e on true
   where me.id is not null
     and p.id <> me.id
     and coalesce(p.active, true)
     and (public.chat_may_start(me.id, p.id) or p.id in (select user_id from sup))
   order by 2;
$$;
revoke all on function public.chat_contactable_people() from public, anon;
grant execute on function public.chat_contactable_people() to authenticated;

notify pgrst, 'reload schema';

-- ================================================================
-- BLOCO 120
-- 20261021230000_the_gel_columns_take_the_machines_names.sql
-- ================================================================
-- As duas colunas de gel do Headcount passam a chamar-se como as máquinas.
--
-- O quadro dizia "Gel Room" e "Gel Line". Nenhum dos dois é o nome de um posto: a GEL
-- Line tem duas máquinas, e a tabela `machines` já as nomeia — "Gel Machine" e
-- "Gel Packing", ambas na linha 6fca06ef. Quem preenche o quadro de manhã lê os nomes
-- das máquinas, não os do quadro, e tinha de traduzir de cabeça.
--
-- A tradução já estava meia-feita e escondida no `sheet_label`, que é por onde a folha
-- de Excel entra:
--
--     name "Gel Room"  ->  sheet_label "Gel Line"
--     name "Gel Line"  ->  sheet_label "Gel Machine"
--
-- Ou seja, o `name` de uma era o `sheet_label` da outra. Era disto que vinha a confusão.
--
-- Depois desta migração os dois passam a dizer a mesma coisa:
--
--     "Gel Packing"  (era "Gel Room",  236 alocações, 8 funcionários)
--     "Gel Machine"  (era "Gel Line",   65 alocações, 3 funcionários, ligada à GEL Line)
--
-- NADA SE PERDE. `daily_allocations.area_id`, `headcount_matrix.area_id` e
-- `employees.headcount_area_id` são todos `uuid` e apontam para a linha, não para o
-- nome. As 301 alocações e os 11 funcionários ficam onde estavam; só muda o cabeçalho.
--
-- A FOLHA DE EXCEL TEM DE MUDAR TAMBÉM. O `sheet_label` é o cabeçalho que o importador
-- procura no ficheiro. Alinhá-lo com o nome novo é deliberado — pedido a 21/10 — mas
-- significa que a folha do headcount tem de passar a dizer "Gel Packing" e
-- "Gel Machine" nessas duas colunas, senão a importação deixa de as encontrar.
--
-- Não confundir com `lines` nem com `20260801100000_one_name_for_the_gel_line`. Essa
-- migração unificou nomes na tabela `lines`, que é outro domínio: ali a linha chama-se
-- "GEL Line" e continua a chamar-se. Aqui mexe-se só nas colunas do Headcount.
--
-- Pela chave antiga e não pelo id, porque um id gerado não se escreve numa migração.
-- Correr duas vezes não faz nada da segunda.

UPDATE public.headcount_areas
   SET name = 'Gel Packing', sheet_label = 'Gel Packing'
 WHERE name = 'Gel Room';

UPDATE public.headcount_areas
   SET name = 'Gel Machine', sheet_label = 'Gel Machine'
 WHERE name = 'Gel Line';

notify pgrst, 'reload schema';

-- ================================================================
-- BLOCO 121
-- 20261021240000_a_phone_belongs_to_one_login_and_every_group_message_buzzes.sql
-- ================================================================
--
-- PT: Duas falhas do push no telemovel, ambas do lado da base de dados.
--
--   1. UM TELEMOVEL, UM LOGIN. O endpoint de push identifica o aparelho, nao a pessoa. Num
--      telemovel ou tablet partilhado, quem entra depois guardava o mesmo endpoint com o seu
--      user_id e a linha de quem entrou antes ficava la: as mensagens da primeira pessoa
--      continuavam a tocar no aparelho da segunda. `register_push_subscription()` guarda a
--      subscricao do login que esta a chamar e apaga a mesma subscricao de qualquer outro
--      login, na mesma transaccao. A tabela tem RLS e um login so apaga as suas proprias
--      linhas, por isso so uma funcao SECURITY DEFINER o pode fazer.
--
--   2. UMA MENSAGEM DE GRUPO, UM TOQUE. A linha do sino de um grupo e reescrita (nao
--      inserida) enquanto estiver por ler, para nao encher o sino. O trigger do BLOCO 117
--      so dispara em INSERT, por isso so a primeira mensagem de um grupo tocava no
--      telemovel; as seguintes ficavam em silencio. Passa a disparar tambem quando a
--      linha do sino de um grupo e renovada. A etiqueta da notificacao e a mesma, por isso
--      no aparelho a nova substitui a anterior em vez de empilhar.
--
-- Nao muda nem apaga dados. A tabela push_subscriptions e as suas politicas ficam como estao.
--
-- EN: Two push faults, both in the database.
--   1. One phone, one login: the push endpoint identifies the device, not the person. On a
--      shared phone the previous login's row stayed and kept buzzing the device.
--      `register_push_subscription()` stores the caller's subscription and removes the same
--      endpoint from every other login, in one transaction. RLS lets a login delete only its
--      own rows, so only a SECURITY DEFINER function can.
--   2. One group message, one buzz: a group's bell row is rewritten while unread, and the
--      BLOCO 117 trigger fires on INSERT only, so only a group's first message reached the
--      phone. It now also fires when a group's bell row is renewed; the tag is the same, so
--      the device replaces the notification instead of stacking.
-- No data is touched.

create or replace function public.register_push_subscription(
  p_endpoint   text,
  p_p256dh     text,
  p_auth       text,
  p_user_agent text default null
) returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not signed in' using errcode = '28000';
  end if;
  if p_endpoint is null or p_endpoint !~ '^https://' or length(p_endpoint) > 2048
     or coalesce(p_p256dh, '') = '' or coalesce(p_auth, '') = '' then
    raise exception 'Invalid push subscription' using errcode = '22023';
  end if;

  delete from public.push_subscriptions where endpoint = p_endpoint and user_id <> v_uid;

  insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
  values (v_uid, p_endpoint, p_p256dh, p_auth, left(p_user_agent, 400))
  on conflict (user_id, endpoint)
  do update set p256dh = excluded.p256dh, auth = excluded.auth,
                user_agent = coalesce(excluded.user_agent, public.push_subscriptions.user_agent);
end;
$$;
revoke all on function public.register_push_subscription(text, text, text, text) from public;
revoke execute on function public.register_push_subscription(text, text, text, text) from anon;
grant execute on function public.register_push_subscription(text, text, text, text) to authenticated;

drop trigger if exists notification_push_again on public.notifications;
create trigger notification_push_again
  after update of created_at on public.notifications
  for each row
  when (new.kind = 'chat_group' and new.read_at is null and new.created_at > old.created_at)
  execute function public.notification_push();

notify pgrst, 'reload schema';

-- ================================================================
-- BLOCO 122
-- 20261021250000_cron_jobs_read_the_key_from_the_vault.sql
-- ================================================================
--
-- PT: Dois jobs do agendador (intouch-poll, todos os minutos, e calculate-shift-targets, de
-- meia em meia hora) tinham a chave do cron escrita em texto no proprio comando. Qualquer
-- pessoa que leia `cron.job` a ve, e a mesma chave esta numa migracao antiga do repositorio
-- (20260807140000). Os outros jobs (safetyculture-sync, intouch-sync-production e o gatilho do
-- push) ja a leem do vault. Aqui os dois passam a ler do vault tambem, com o MESMO valor, por
-- isso nada muda para quem os recebe: e o passo que torna possivel TROCAR a chave depois, num
-- so sitio, sem editar jobs.
--
--   * Procura em todos os jobs o padrao 'x-cron-secret', '<hex>' e troca o valor literal por
--     (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET').
--   * Se o vault nao tiver CRON_SECRET, nao toca em nada: um job a ler um vault vazio
--     mandaria um cabecalho vazio e pararia.
--   * Idempotente: sem nenhum literal, nao faz nada. Nao troca a chave, nao muda horarios.
--
-- EN: Two scheduler jobs (intouch-poll every minute, calculate-shift-targets every half hour)
-- carried the cron key as plain text in their command. Anybody who can read `cron.job` sees it,
-- and the same key sits in an old migration (20260807140000). The other jobs already read it
-- from the vault. This makes these two read it from the vault too, with the SAME value, so
-- nothing changes for the receiver; it is the step that lets the key be rotated in one place.
-- It leaves everything alone when the vault has no CRON_SECRET, and does nothing when no
-- literal is left. It does not rotate the key and does not change any schedule.

do $$
declare
  j record;
  v_new text;
  c_old constant text := $re$'x-cron-secret'\s*,\s*'[0-9a-fA-F]{32,}'$re$;
  c_new constant text := $nw$'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'CRON_SECRET' limit 1)$nw$;
begin
  if to_regclass('cron.job') is null or to_regclass('vault.decrypted_secrets') is null then
    raise notice 'pg_cron or the vault is not here; nothing to do';
    return;
  end if;
  if not exists (select 1 from vault.decrypted_secrets where name = 'CRON_SECRET' and coalesce(decrypted_secret, '') <> '') then
    raise notice 'The vault has no CRON_SECRET; leaving the jobs as they are';
    return;
  end if;

  for j in select jobid, command from cron.job where command ~ c_old loop
    v_new := regexp_replace(j.command, c_old, c_new, 'g');
    if v_new = j.command or v_new ~ c_old then
      raise exception 'cron job % was not rewritten cleanly', j.jobid;
    end if;
    perform cron.alter_job(j.jobid, command := v_new);
    raise notice 'cron job % now reads the key from the vault', j.jobid;
  end loop;
end;
$$;

-- ================================================================
-- BLOCO 123
-- 20261021260000_staff_can_see_whose_phone_is_on_the_list.sql
-- ================================================================
--
-- PT: Uma mensagem so chega a um telemovel bloqueado se ESSE telemovel disse "sim" uma vez.
-- Quem gere o overtime nao tinha maneira de ver quem ainda nao disse: a 21/10 uma mensagem para
-- o Maikon nao chegou a ninguem porque ele tinha 0 telemoveis na lista. `push_coverage()`
-- devolve, por login, quantos telemoveis tem registados, de que tipo, e quando foi o ultimo.
--
--   * So para quem pode gerir overtime (admin, manager, production office admin, e as
--     permissoes dadas pela matriz). Todos os outros recebem zero linhas.
--   * Devolve o tipo (iPhone/iPad, Android/Chrome, Firefox, Windows) deduzido do servidor do
--     endpoint, nunca o endpoint nem as chaves: com elas qualquer pessoa podia enviar push
--     para esse telemovel.
--   * So le. Nao muda nem apaga dados.
--
-- EN: A message reaches a locked phone only if THAT phone said yes once. Whoever manages
-- overtime had no way to see who had not: on 21/10 a message to Maikon reached nobody because
-- he had 0 phones on the list. `push_coverage()` returns, per login, how many phones are
-- registered, of what kind, and when the last one was. Only for people who can manage
-- overtime (everyone else gets no rows). The kind is derived from the endpoint's host; the
-- endpoint and keys are never returned. Read-only.

create or replace function public.push_coverage()
returns table (user_id uuid, phones integer, platforms text[], last_registered timestamptz)
language sql stable security definer set search_path = public
as $$
  select s.user_id,
         count(*)::int,
         array_agg(distinct case
           when s.endpoint like '%web.push.apple.com%'          then 'iPhone/iPad'
           when s.endpoint like '%fcm.googleapis.com%'          then 'Android/Chrome'
           when s.endpoint like '%push.services.mozilla.com%'   then 'Firefox'
           when s.endpoint like '%notify.windows.com%'          then 'Windows'
           else 'Other' end),
         max(s.created_at)
    from public.push_subscriptions s
   where auth.uid() is not null and public.can_manage_overtime(auth.uid())
   group by s.user_id;
$$;
revoke all on function public.push_coverage() from public;
revoke execute on function public.push_coverage() from anon;
grant execute on function public.push_coverage() to authenticated;

notify pgrst, 'reload schema';
