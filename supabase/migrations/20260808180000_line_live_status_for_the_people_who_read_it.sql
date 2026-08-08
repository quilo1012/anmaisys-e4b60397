-- The live state of a line, for the screen the supervisors actually land on.
--
-- `production.performance.view` is held by admin, manager, supervisor,
-- maintenance_manager, planner, operator and production_office_admin — and
-- /dashboard/production-performance is the LANDING page for supervisor and
-- production_office_admin both. But `intouch_machine_map` grants SELECT to
-- authenticated and then narrows it to admin, manager, maintenance_manager and
-- engineer, so four of those seven roles would open the board and find every
-- status pill empty, with nothing on screen saying why.
--
-- A view rather than a wider policy on the table. The table carries the mapping
-- itself — machine GUIDs, downtime-tracking bookkeeping, the poll's cursor — and
-- none of that belongs to a supervisor reading a board. What does belong is six
-- columns: which line, which machine, what state, why, and how old the reading is.
--
-- This view is intentionally NOT security_invoker: it reads the base table with
-- the definer's rights and exposes only those six columns to any signed-in user.
-- Machine running state is not sensitive; the mapping behind it is.

CREATE OR REPLACE VIEW public.v_line_live_status AS
SELECT DISTINCT ON (l.name)
  l.name                                   AS line,
  m.intouch_machine_name                   AS machine,
  m.last_status                            AS status,
  -- The label from the stop-code map, falling back to a named unknown rather
  -- than a bare GUID. A code missing from the map is a mapping job, and the
  -- board should say that instead of showing a supervisor a UUID — or, worse,
  -- showing nothing and reading as running.
  CASE
    WHEN m.last_downtime_code IS NULL OR btrim(m.last_downtime_code) = '' THEN NULL
    WHEN cm.label IS NOT NULL AND btrim(cm.label) <> '' THEN cm.label
    ELSE 'Unmapped stop code'
  END                                      AS reason,
  c.planned                                AS planned,
  m.last_seen_at                           AS seen_at
FROM public.intouch_machine_map m
JOIN public.lines l
  ON l.id = m.line_id
LEFT JOIN public.intouch_stop_code_map cm
  ON lower(btrim(cm.stop_code)) = lower(btrim(m.last_downtime_code))
LEFT JOIN public.intouch_stop_code_catalog c
  ON lower(btrim(c.name)) = lower(btrim(cm.label))
WHERE m.active
-- A line can carry several machines, and the one that decides the pill is the one
-- that is STOPPED: a line is not running because four of its five machines are.
-- Among equals, the freshest reading wins.
ORDER BY l.name, (m.last_downtime_code IS NOT NULL) DESC, m.last_seen_at DESC NULLS LAST;

COMMENT ON VIEW public.v_line_live_status IS
  'Live iTouching state per line for the performance board: line, machine, raw status, stop reason, whether that stop is planned, and the age of the reading. Deliberately readable by every signed-in user — intouch_machine_map itself is not.';

GRANT SELECT ON public.v_line_live_status TO authenticated;
