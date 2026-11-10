-- An index for a read that every admin's screen repeats on a timer.
--
-- Index only: no policy, function or data changes, and IF NOT EXISTS makes it safe to
-- paste twice. The table is small enough that a plain CREATE INDEX holds its lock for
-- well under a second.
--
-- The Root Diagnostics badge (src/hooks/useTelemetryBadge.ts) counts
--   error_type = 'REACT_CRASH' AND created_at > <last seen>
-- every 60 seconds for every admin. The table had only (created_at DESC), and on a
-- first visit <last seen> is 1970, so the count read every row in the table and
-- evaluated the admin policy on each one.
--
-- work_orders.line_id needs nothing: idx_wo_line_status_created (20260623231311) and
-- idx_wo_line_created (20260624122325) both lead with it.
CREATE INDEX IF NOT EXISTS system_telemetry_logs_type_created_idx
  ON public.system_telemetry_logs (error_type, created_at DESC);
