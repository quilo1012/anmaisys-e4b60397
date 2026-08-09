-- Every stop gets a clock, not just the ones we bill.
--
-- The performance board writes one number beside the stop reason, and for half
-- the stop codes in this installation that number was never the stop's.
--
-- `prod_dt_started_at` is bookkeeping for `production_downtimes`: the poll opens
-- it when a PRODUCTION-side code appears and closes it into a row of measured
-- downtime. A code flagged `requires_wo = true` never goes down that path — it
-- raises a work order instead, and the poll explicitly CLEARS `prod_dt_started_at`
-- when maintenance takes over (intouch-poll, "prod-dt handover"). That is correct
-- for the ledger: a maintenance stoppage is billed against the order's own clock,
-- and counting it twice would be a lie about the minutes.
--
-- But the board was reading that same column to answer a different question —
-- "how long has this line been down?" — and for 23 of the 48 mapped codes the
-- answer came back null. The card then filled the slot with the age of the last
-- poll: Line 1 stood in "Filling Blender/ Blending" and read "78s", a number that
-- resets every minute, in the place where a stop's duration goes.
--
-- So: a second clock, which is not the ledger's. `stop_since_at` is when the poll
-- first saw THIS code on THIS machine, continuously — nothing more. It is set for
-- every stop whatever the code, it survives the handover to maintenance, and it
-- is cleared the moment the machine reports no code at all. It bills nobody.
--
-- "For", not "since": it is accurate to the poll's one-minute interval, and a
-- stop already running when this lands starts counting from here.

ALTER TABLE public.intouch_machine_map
  ADD COLUMN IF NOT EXISTS stop_since_at timestamptz;

COMMENT ON COLUMN public.intouch_machine_map.stop_since_at IS
  'When the poll first saw the CURRENT stop code on this machine, continuously. Set for every stop code including requires_wo ones; null while the machine reports no code. Display only — production_downtimes and the work order keep their own clocks.';

-- The stops already running keep the clock they have rather than restarting at
-- zero on deploy. Only the production-side ones have one to keep; the maintenance
-- stops have never had a start recorded anywhere the board can read, and inventing
-- one would be worse than counting from now.
UPDATE public.intouch_machine_map
   SET stop_since_at = prod_dt_started_at
 WHERE last_downtime_code IS NOT NULL
   AND btrim(last_downtime_code) <> ''
   AND prod_dt_started_at IS NOT NULL
   AND stop_since_at IS NULL;

-- The view answers the board's question with the board's column, and falls back
-- to the ledger's only for the window between this migration and the next poll.
CREATE OR REPLACE VIEW public.v_line_live_status AS
SELECT DISTINCT ON (l.name)
  l.name                                   AS line,
  m.intouch_machine_name                   AS machine,
  m.last_status                            AS status,
  CASE
    WHEN m.last_downtime_code IS NULL OR btrim(m.last_downtime_code) = '' THEN NULL
    WHEN cm.label IS NOT NULL AND btrim(cm.label) <> '' THEN cm.label
    ELSE 'Unmapped stop code'
  END                                      AS reason,
  c.planned                                AS planned,
  m.last_seen_at                           AS seen_at,
  -- When the poll FIRST SAW this stop, which is not the same as when the stop
  -- began: accurate to the poll's one-minute interval. Now answered for every
  -- stop code rather than only for the ones that open a production-downtime row —
  -- a maintenance stop is still a line standing still, and the supervisor reading
  -- this board is asking how long, not who it is billed to.
  COALESCE(m.stop_since_at, m.prod_dt_started_at) AS stop_since
FROM public.intouch_machine_map m
JOIN public.lines l
  ON l.id = m.line_id
LEFT JOIN public.intouch_stop_code_map cm
  ON lower(btrim(cm.stop_code)) = lower(btrim(m.last_downtime_code))
LEFT JOIN public.intouch_stop_code_catalog c
  ON lower(btrim(c.name)) = lower(btrim(cm.label))
WHERE m.active
ORDER BY l.name, (m.last_downtime_code IS NOT NULL) DESC, m.last_seen_at DESC NULLS LAST;

COMMENT ON VIEW public.v_line_live_status IS
  'Live iTouching state per line for the performance board: line, machine, raw status, stop reason, whether that stop is planned, how long the stop has been running, and the age of the reading. Deliberately readable by every signed-in user — intouch_machine_map itself is not.';

GRANT SELECT ON public.v_line_live_status TO authenticated;
