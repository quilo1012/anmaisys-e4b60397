-- Four downtime rows carried a raw UUID where the stop's name should be.
--
-- The poll resolves a stop code's label from intouch_stop_code_map filtered to
-- active = true, so a deactivated code had no entry and the label fell back to the
-- UUID itself. That is not cosmetic: "No Planned Shift" is excluded from downtime by
-- matching its NAME, so 421 minutes of unscheduled time on Line 4 were being counted
-- as a real stoppage, and two Breaks rows with it.
--
-- The function now reads every code for naming and only the active ones for
-- behaviour. This repairs what it already wrote.
UPDATE public.production_downtimes d
SET reason = m.label,
    category = COALESCE(NULLIF(d.category, 'Other'), m.category, d.category)
FROM public.intouch_stop_code_map m
WHERE lower(m.stop_code) = lower(d.reason)
  AND d.reason ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$';
