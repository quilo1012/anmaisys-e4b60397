-- Drop restrictive FK constraints that prevent operators from being recorded
-- as actors in logs and downtime events. The names (engineer_name,
-- stopped_by_name) are already stored as strings, so referential integrity
-- on the actor UUID is not required.

ALTER TABLE public.work_order_logs
  DROP CONSTRAINT IF EXISTS work_order_logs_engineer_id_fkey;

ALTER TABLE public.downtime_events
  DROP CONSTRAINT IF EXISTS downtime_events_stopped_by_fkey;

ALTER TABLE public.downtime_events
  DROP CONSTRAINT IF EXISTS downtime_events_resumed_by_fkey;