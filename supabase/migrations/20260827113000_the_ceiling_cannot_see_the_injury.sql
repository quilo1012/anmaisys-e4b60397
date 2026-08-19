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
