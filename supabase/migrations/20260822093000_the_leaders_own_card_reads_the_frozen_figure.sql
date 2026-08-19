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
