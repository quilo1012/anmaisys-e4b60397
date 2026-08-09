-- Um relógio que ninguém dá corda é pior do que nenhum.
--
-- `stop_since_at` was added this morning to answer "how long has this line been
-- standing still" for the 23 of 48 codes whose ledger clock is null, and the view was
-- switched to prefer it: COALESCE(stop_since_at, prod_dt_started_at).
--
-- The column is written by `intouch-poll`, and that function was never deployed. So
-- the migration's one-off backfill is the only thing that has ever written it, and it
-- has been frozen at that instant ever since. The poll itself is alive — last_seen_at
-- is seconds old and the stop codes change all morning — it is only this column that
-- nobody winds.
--
-- The tell is in the data: 04:49:01.938 appears on Filler Line 1 and Filler Line 5 to
-- the millisecond, and 19:21:01.687 on five machines at once. Per-machine polls do not
-- share a millisecond; one UPDATE does.
--
-- What the floor saw: Filler Line 5 alarmed at 07:37 and the board said the stop had
-- been running 2:45:07. Filler Line 2 went on Breaks at 07:32 and would have been
-- timed from 19:21 the previous evening. A pill that claims a line has been down for
-- three hours when it stopped four minutes ago is not a slow clock, it is a different
-- fact, and the supervisor reading it reasonably concludes the board is stuck.
--
-- Two changes, and neither waits on the deploy:
--
-- 1. NO CODE, NO CLOCK. The view used to carry `stop_since` whether or not there was
--    a stop to time. `classifyLive` throws it away when there is no reason, so this
--    changed nothing on screen — but it meant the view answered "since when" about a
--    running line, and the next reader of it would not know to ignore that.
--
-- 2. THE LATER OF THE TWO WINS. `GREATEST` skips nulls in Postgres, so a maintenance
--    code with no ledger clock still uses `stop_since_at`, an ordinary stop uses
--    whichever is fresher, and a frozen backfill can no longer outrank a timestamp
--    written minutes ago. When the poll is deployed this keeps being correct rather
--    than needing to be undone.
--
-- And the frozen values are cleared, because until the poll ships nothing will
-- overwrite them: a null clock draws no counter, which is honest, where a stale one
-- draws a wrong number, which is not.
CREATE OR REPLACE VIEW public.v_line_live_status AS
SELECT DISTINCT ON (l.name)
  l.name AS line,
  m.intouch_machine_name AS machine,
  m.last_status AS status,
  CASE
    WHEN m.last_downtime_code IS NULL OR btrim(m.last_downtime_code) = ''::text THEN NULL::text
    WHEN cm.label IS NOT NULL AND btrim(cm.label) <> ''::text THEN cm.label
    ELSE 'Unmapped stop code'::text
  END AS reason,
  c.planned,
  m.last_seen_at AS seen_at,
  CASE
    WHEN m.last_downtime_code IS NULL OR btrim(m.last_downtime_code) = ''::text THEN NULL::timestamptz
    ELSE GREATEST(m.stop_since_at, m.prod_dt_started_at)
  END AS stop_since
FROM intouch_machine_map m
  JOIN lines l ON l.id = m.line_id
  LEFT JOIN intouch_stop_code_map cm ON lower(btrim(cm.stop_code)) = lower(btrim(m.last_downtime_code))
  LEFT JOIN intouch_stop_code_catalog c ON lower(btrim(c.name)) = lower(btrim(cm.label))
WHERE m.active
ORDER BY l.name, (m.last_downtime_code IS NOT NULL) DESC, m.last_seen_at DESC NULLS LAST;

-- The backfill, undone. It was a snapshot of one moment presented as a live reading.
UPDATE public.intouch_machine_map SET stop_since_at = NULL;
