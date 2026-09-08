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
