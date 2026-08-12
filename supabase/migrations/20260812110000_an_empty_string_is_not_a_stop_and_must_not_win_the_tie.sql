-- A line with several machines shows the pill of the one that is STOPPED. That
-- promise is in the view's own comment, and the ORDER BY that keeps it asked the
-- wrong question: `last_downtime_code IS NOT NULL`.
--
-- iTouching sends the EMPTY STRING for a machine with no reason selected, and an
-- empty string is not null — the tie-break has therefore been ranking machines
-- with no stop at all above their neighbours. It survived unnoticed because the
-- poll used to blank the column to NULL on any healthy status, so most running
-- machines happened to be null anyway. That blanking is exactly what was
-- discarding real stop codes (Filler Line 4, status 1, Deep Clean, reading
-- RUNNING for 1:35), and now that the code is kept, '' arrives here honestly.
--
-- Same test as the two CASE expressions above it, which have always had it
-- right. Nothing else about the view changes.
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
  CASE
    WHEN m.last_downtime_code IS NULL OR btrim(m.last_downtime_code) = '' THEN NULL::timestamptz
    ELSE COALESCE(m.stop_since_at, m.prod_dt_started_at)
  END                                      AS stop_since
FROM public.intouch_machine_map m
JOIN public.lines l
  ON l.id = m.line_id
LEFT JOIN public.intouch_stop_code_map cm
  ON lower(btrim(cm.stop_code)) = lower(btrim(m.last_downtime_code))
LEFT JOIN public.intouch_stop_code_catalog c
  ON lower(btrim(c.name)) = lower(btrim(cm.label))
WHERE m.active
ORDER BY
  l.name,
  (m.last_downtime_code IS NOT NULL AND btrim(m.last_downtime_code) <> '') DESC,
  m.last_seen_at DESC NULLS LAST;

COMMENT ON VIEW public.v_line_live_status IS
  'Live iTouching state per line for the performance board: line, machine, raw status, stop reason, whether that stop is planned, and the age of the reading. Deliberately readable by every signed-in user — intouch_machine_map itself is not.';
