-- Removing two functions that lost their purpose the same day they were written.
--
-- planned_stop_minutes() and work_order_downtime() were built to take planned
-- stoppage off a maintenance order by computing it on read. Before they were wired to
-- anything, the same rule arrived from the other direction: wo_downtime_exclusions,
-- which every screen, dashboard and export already subtracts, now gets its rows fed
-- automatically from iTouching's planned stop codes.
--
-- One subtraction, reached by one path. Leaving a second, uncalled calculation in the
-- database is how a system ends up with two answers to "how long was the line down" —
-- and the one nobody maintains is the one that eventually gets quoted.
--
-- They are in the git history if the approach is ever needed again.

DROP FUNCTION IF EXISTS public.work_order_downtime(uuid);
DROP FUNCTION IF EXISTS public.planned_stop_minutes(text, timestamptz, timestamptz);
