-- O relógio voltou a ser do poll, por isso a vista pode confiar nele outra vez.
--
-- An hour ago `stop_since_at` was frozen — the function that maintains it had never
-- been deployed — and the view was taught to take the LATER of it and the ledger's
-- clock, so a backfill from the morning could not outrank a timestamp written minutes
-- ago. That was right for a column nobody was winding.
--
-- The function is deployed now, and the same rule became the opposite mistake. The
-- later of two timestamps is the wrong one whenever the older is the truth: the GEL
-- Line has been on No Planned Shift since 19:21 yesterday, and `GREATEST` read it as
-- two minutes because the poll had just restamped the column. A clock that resets
-- itself every time anything happens is the bug we started the morning with, wearing
-- the other hat.
--
-- So: the poll's clock, and the ledger's only where the poll has none — which is what
-- the column was invented for, and is now safe because something writes it.
--
-- The no-code rule stays. A running line is not timing anything, and the view has no
-- business answering "since when" about it.
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
    ELSE COALESCE(m.stop_since_at, m.prod_dt_started_at)
  END AS stop_since
FROM intouch_machine_map m
  JOIN lines l ON l.id = m.line_id
  LEFT JOIN intouch_stop_code_map cm ON lower(btrim(cm.stop_code)) = lower(btrim(m.last_downtime_code))
  LEFT JOIN intouch_stop_code_catalog c ON lower(btrim(c.name)) = lower(btrim(cm.label))
WHERE m.active
ORDER BY l.name, (m.last_downtime_code IS NOT NULL) DESC, m.last_seen_at DESC NULLS LAST;

-- And the stops that were already open when the column was cleared get their real
-- start back from the ledger, which never forgot it. Without this the GEL Line would
-- have counted from the minute of the wipe until its code next changed, which for a
-- shift-boundary code could be a whole shift away.
UPDATE public.intouch_machine_map
   SET stop_since_at = prod_dt_started_at
 WHERE btrim(coalesce(last_downtime_code, '')) <> ''
   AND prod_dt_started_at IS NOT NULL
   AND (stop_since_at IS NULL OR prod_dt_started_at < stop_since_at);
