-- A leader can read their own card, with their own PIN.
--
-- Line leaders are not users of this system: all 22 rows in `leader_pins` are a name
-- and a PIN hash, with no auth account behind them. They work on a tablet that is
-- signed in as its line, and RLS scopes that session to that one line — while a
-- leader rotates across six. Reading the scorecard tables directly from such a
-- session therefore does not fail; it quietly returns a third of the rows and prints
-- a smaller score for the person the card is about. That is the failure this function
-- exists to prevent.
--
-- So the PIN is the identity, and the function is the boundary:
--   * it runs SECURITY DEFINER, so the leader's whole period comes back whatever
--     line the tablet is bound to;
--   * it takes the PIN, never a leader id, so a session cannot ask for a colleague's
--     card by guessing a uuid;
--   * it returns rows only, never a score. The arithmetic stays in
--     src/lib/leaderScorecard.ts, which the manager's copy of the card also uses, so
--     the leader and their manager can never be shown different numbers for the same
--     person and the same period.
--
-- It still requires a signed-in device (auth.uid()) and reuses the same
-- `pin_attempts` lockout ladder as verify_pin_with_lockout: this widens what a
-- correct PIN can read, and must not widen how cheaply a PIN can be guessed.

CREATE OR REPLACE FUNCTION public.leader_self_scorecard(
  _pin text,
  _from date,
  _to date,
  _shift text DEFAULT 'all'
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _now timestamptz := now();
  _row public.pin_attempts%ROWTYPE;
  _leader record;
  _eng record;
  -- The leader's name as the production tables spell it, which is not how the PIN
  -- table spells it. See the note above the first query.
  _lname text;
  _shift_up text := upper(coalesce(_shift, 'all'));
  _gte timestamptz;
  _lte timestamptz;
  _step integer;
  _wait integer;
  _max_free constant integer := 5;
  _ladder constant integer[] := ARRAY[30, 60, 120, 300];
  _ids uuid[];
  _actions jsonb; _completes jsonb; _sessions jsonb; _rag jsonb; _items jsonb; _wos jsonb;
BEGIN
  IF _uid IS NULL THEN
    RETURN jsonb_build_object('success', false, 'error', 'not_authenticated');
  END IF;
  IF _from IS NULL OR _to IS NULL OR _to < _from THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_period');
  END IF;
  -- A year at a time is already more than any review asks for, and bounds what one
  -- correct PIN can pull out of the tables in a single call.
  IF (_to - _from) > 366 THEN
    RETURN jsonb_build_object('success', false, 'error', 'period_too_long');
  END IF;
  IF _shift_up NOT IN ('ALL', 'DAY', 'NIGHT') THEN
    RETURN jsonb_build_object('success', false, 'error', 'bad_shift');
  END IF;

  SELECT * INTO _row FROM public.pin_attempts WHERE user_id = _uid FOR UPDATE;
  IF _row.locked_until IS NOT NULL AND _row.locked_until > _now THEN
    RETURN jsonb_build_object('success', false, 'error', 'locked',
      'locked_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_row.locked_until - _now)))::int),
      'remaining', 0);
  END IF;

  SELECT l.id, l.name, l.line, COALESCE(l.lines, '{}'::text[]) AS lines
    INTO _leader
    FROM public.leader_pins l
   WHERE l.is_active = true
     AND l.pin_hash IS NOT NULL
     AND l.pin_hash = extensions.crypt(_pin, l.pin_hash)
   LIMIT 1;

  IF _leader.id IS NULL THEN
    -- An engineer's PIN is a correct PIN — it just does not name a leader, and there
    -- is no card to show for it. Told apart from a wrong PIN so an engineer who tries
    -- the wrong screen is not walked up a lockout ladder for it.
    SELECT e.id, e.name INTO _eng
      FROM public.engineers e
     WHERE e.is_active = true
       AND e.pin_hash IS NOT NULL
       AND e.pin_hash = extensions.crypt(_pin, e.pin_hash)
     LIMIT 1;
    IF _eng.id IS NOT NULL THEN
      DELETE FROM public.pin_attempts WHERE user_id = _uid;
      RETURN jsonb_build_object('success', false, 'error', 'not_a_leader', 'engineer_name', _eng.name);
    END IF;

    IF _row.user_id IS NULL THEN
      INSERT INTO public.pin_attempts (user_id, failures, lockout_step, last_attempt, updated_at)
      VALUES (_uid, 1, 0, _now, _now) RETURNING * INTO _row;
    ELSE
      UPDATE public.pin_attempts
         SET failures = _row.failures + 1, last_attempt = _now, updated_at = _now
       WHERE user_id = _uid RETURNING * INTO _row;
    END IF;

    IF _row.failures > _max_free THEN
      _step := LEAST(_row.failures - _max_free, array_length(_ladder, 1));
      _wait := _ladder[_step];
      UPDATE public.pin_attempts
         SET locked_until = _now + make_interval(secs => _wait), lockout_step = _step
       WHERE user_id = _uid;
      RETURN jsonb_build_object('success', false, 'error', 'locked', 'locked_seconds', _wait, 'remaining', 0);
    END IF;

    RETURN jsonb_build_object('success', false, 'error', 'invalid_pin',
      'remaining', GREATEST(0, _max_free - _row.failures));
  END IF;

  DELETE FROM public.pin_attempts WHERE user_id = _uid;

  -- Matched case-insensitively, because the two tables do not agree on the spelling
  -- of the same person. `leader_pins` holds HENRIQUE, CAINAN, FILIPI, KAZ and JULIANO
  -- in capitals, while production_sessions and quality_actions hold Henrique, Cainan,
  -- Filipi, Kaz and Juliano. On an exact match those five leaders — 52 sessions and 7
  -- quality actions between them — open a card that reads zero on everything and a
  -- score computed from nothing, which is worse than an error message. The manager's
  -- copy of the card never hit this: its leader name comes from the session rows
  -- themselves, so it was always already in the production spelling.
  _lname := lower(btrim(_leader.name));

  -- A night filed under `_to` is still being written at 05:59 the next morning, so the
  -- fetch reaches a day past the range; shiftSessionDate() in the client throws back
  -- what does not belong. Same window as the manager's copy of the card.
  _gte := (_from::text || 'T00:00:00.000Z')::timestamptz;
  _lte := ((_to + 1)::text || 'T06:59:59.999Z')::timestamptz;

  SELECT COALESCE(jsonb_agg(to_jsonb(a) ORDER BY a.recorded_at), '[]'::jsonb),
         ARRAY_AGG(a.id)
    INTO _actions, _ids
    FROM (
      SELECT qa.id, qa.status, qa.severity, qa.recorded_at, qa.labels, qa.department,
             qa.line, qa.action_no, qa.description, qa.shift, qa.validation_status,
             qa.validated_at, qa.validated_by, qa.attachments, qa.closed_at
        FROM public.quality_actions qa
       WHERE lower(btrim(qa.leader_name)) = _lname
         AND qa.recorded_at >= _gte
         AND qa.recorded_at <= _lte
         AND (_shift_up = 'ALL' OR qa.shift = _shift_up)
    ) a;

  SELECT COALESCE(jsonb_agg(jsonb_build_object('action_id', h.action_id, 'changed_at', h.changed_at)), '[]'::jsonb)
    INTO _completes
    FROM public.quality_action_history h
   WHERE h.action_id = ANY (COALESCE(_ids, '{}'::uuid[]))
     AND h.field = 'status'
     AND h.new_value = 'complete';

  SELECT COALESCE(jsonb_agg(to_jsonb(s)), '[]'::jsonb)
    INTO _sessions
    FROM (
      SELECT ps.oee_pct, ps.run_time_min, ps.down_time_min, ps.intouch_good_total,
             ps.session_date, ps.line, ps.shift
        FROM public.production_sessions ps
       WHERE lower(btrim(ps.leader_name)) = _lname
         AND ps.session_date >= _from
         AND ps.session_date <= _to
         AND (_shift_up = 'ALL' OR ps.shift = _shift_up)
    ) s;

  -- The plan, from RAG weekly — the denominator the rest of the system reports
  -- against. Not filtered to the leader: the client matches it to the sessions above
  -- on date + shift + line, exactly as the manager's card does.
  SELECT COALESCE(jsonb_agg(to_jsonb(r)), '[]'::jsonb)
    INTO _rag
    FROM (
      SELECT rw.entry_date, rw.line, rw.shift, rw.plan_qty
        FROM public.rag_weekly_entries rw
       WHERE rw.entry_date >= _from
         AND rw.entry_date <= _to
         AND (_shift_up = 'ALL' OR rw.shift = _shift_up)
    ) r;

  SELECT COALESCE(jsonb_agg(to_jsonb(i)), '[]'::jsonb)
    INTO _items
    FROM (
      SELECT pi.actual_qty, pi.target_qty
        FROM public.production_items pi
        JOIN public.production_sessions ps ON ps.id = pi.session_id
       WHERE lower(btrim(ps.leader_name)) = _lname
         AND ps.session_date >= _from
         AND ps.session_date <= _to
         AND (_shift_up = 'ALL' OR ps.shift = _shift_up)
    ) i;

  -- requester_name is free text typed on the request form — "murilo", "FILIPE",
  -- "Filipi (Line 2)" — so the match is a case-insensitive prefix, the only link a
  -- work order carries back to a line leader.
  SELECT COALESCE(jsonb_agg(to_jsonb(w) ORDER BY w.created_at), '[]'::jsonb)
    INTO _wos
    FROM (
      SELECT wo.id, wo.wo_number, wo.created_at, wo.status, wo.line_at_time,
             wo.line_stopped, wo.description
        FROM public.work_orders wo
       WHERE wo.requester_name ILIKE (btrim(_leader.name) || '%')
         AND wo.created_at >= (_from::text || 'T00:00:00')::timestamptz
         AND wo.created_at <= (_to::text || 'T23:59:59.999')::timestamptz
    ) w;

  RETURN jsonb_build_object(
    'success', true,
    'leader', jsonb_build_object('id', _leader.id, 'name', _leader.name,
                                 'line', _leader.line, 'lines', to_jsonb(_leader.lines)),
    'period', jsonb_build_object('from', _from, 'to', _to, 'shift', lower(_shift_up)),
    'actions', _actions,
    'completes', _completes,
    'sessions', _sessions,
    'rag', _rag,
    'items', _items,
    'work_orders', _wos
  );
END $function$;

-- A signed-in device only. Never anon: four digits on a public endpoint, across 22
-- active leaders, is a guessable door.
REVOKE ALL ON FUNCTION public.leader_self_scorecard(text, date, date, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leader_self_scorecard(text, date, date, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.leader_self_scorecard(text, date, date, text) TO authenticated;

COMMENT ON FUNCTION public.leader_self_scorecard(text, date, date, text) IS
  'Returns one line leader''s own scorecard rows, identified by their PIN. SECURITY DEFINER because the tablet session is RLS-scoped to a single line while a leader rotates across several. Returns rows only — the score is computed in src/lib/leaderScorecard.ts so the leader and their manager cannot see different numbers.';
