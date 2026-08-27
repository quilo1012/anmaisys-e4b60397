-- A line stoppage that ended before it started, and the KPI that subtracted it.
--
-- Two rows in `downtime_events` have `resumed_at` BEFORE `stopped_at`. Both are stored
-- with a negative `duration_minutes`, and `v_wo_downtime_total` sums that column
-- straight, so each one does not merely fail to count — it takes time OFF the line's
-- recorded downtime.
--
--   WO   line     stopped_at            resumed_at            duration  is_recurrence
--   498  Line 4   13/07 11:56:09        13/07 11:46:50              -9   true
--   918  Line 4   19/08 14:42:14        19/08 05:59:00           -523    true
--
-- Line 4's downtime for 19/08 is understated by eight and a half hours by a single row.
--
-- THE SHAPE THEY SHARE. Two out of 544 events, and not at random — both are
-- `is_recurrence = true`, both `stopped_by_name = 'Line 4'` (the tablet account named
-- after the line, not a person), both resumed by the same person, both on orders that
-- ended `force_closed`. On WO 918 the inherited `resumed_at` (05:59:00) is 52 seconds
-- EARLIER than the order's own `created_at` (05:59:52): it cannot have been typed for
-- this stoppage, because the stoppage did not exist yet. It is the previous episode's
-- resume, still attached when the recurrence was written.
--
-- WHAT THIS DOES NOT CLAIM. I did not isolate the exact statement that leaves it there.
-- Several paths write these fields — `reopen_wo_as_recurrence`, `close_shift_downtime`,
-- `intouch_machine_state_moves_the_order`, `sync_wo_line_status` and the screen itself —
-- and the two I read most closely are correct: the iTouching trigger inserts a
-- recurrence with no `resumed_at` and nulls the order's, and the shift closer only
-- touches orders whose `line_resumed_at` IS NULL, which is exactly why WO 918 slipped
-- past it. Naming a culprit I have not proven would be worse than saying this.
--
-- It does not matter for the fix. With five writers and one impossible state, the guard
-- belongs where every writer has to pass: a constraint. That is the difference between
-- fixing this instance and closing the shape.
--
-- WHY THE TWO ROWS ARE LEFT ALONE. I do not know how long those lines were actually
-- down. WO 918 stopped at 14:42 and its order was auto-closed at 17:00, so 138 minutes
-- is arguable; WO 498 has no closed_at at all and nothing to anchor to. Writing a
-- plausible number into a production KPI is worse than the negative, because the
-- negative is visibly wrong and a fabricated 138 is not. They are left for whoever knows
-- what happened, through `correct_downtime_event()` and the Downtime corrections screen,
-- which records the before and after in `downtime_corrections`. Until then the view
-- floors them at zero: not counted, never subtracted.

-- =====================================================================
-- 1. Stop the next one being written
--
-- NOT VALID, deliberately. It applies to every INSERT and UPDATE from here on, and does
-- NOT re-check the two rows already there — so this cannot fail to apply, and the
-- historical rows stay visible for the correction screen instead of becoming
-- unupdatable. Run `VALIDATE CONSTRAINT` once they have been corrected.
-- =====================================================================

ALTER TABLE public.downtime_events
  DROP CONSTRAINT IF EXISTS downtime_events_resumed_after_stopped;
ALTER TABLE public.downtime_events
  ADD CONSTRAINT downtime_events_resumed_after_stopped
  CHECK (resumed_at IS NULL OR resumed_at >= stopped_at) NOT VALID;

ALTER TABLE public.downtime_events
  DROP CONSTRAINT IF EXISTS downtime_events_duration_not_negative;
ALTER TABLE public.downtime_events
  ADD CONSTRAINT downtime_events_duration_not_negative
  CHECK (duration_minutes IS NULL OR duration_minutes >= 0) NOT VALID;

-- The sibling table the Downtime screen writes. Measured before adding it: zero rows
-- violate either rule, so these are validated on the spot rather than NOT VALID.
ALTER TABLE public.production_downtimes
  DROP CONSTRAINT IF EXISTS production_downtimes_ended_after_started;
ALTER TABLE public.production_downtimes
  ADD CONSTRAINT production_downtimes_ended_after_started
  CHECK (ended_at IS NULL OR ended_at >= started_at);

ALTER TABLE public.production_downtimes
  DROP CONSTRAINT IF EXISTS production_downtimes_duration_not_negative;
ALTER TABLE public.production_downtimes
  ADD CONSTRAINT production_downtimes_duration_not_negative
  CHECK (duration_minutes IS NULL OR duration_minutes >= 0);

-- =====================================================================
-- 2. Keep an impossible row out of the arithmetic
--
-- The floor is per EVENT, not on the total: flooring the sum would let a bad row cancel
-- a good one inside the same order and still report a plausible figure. At zero, a row
-- that cannot be true contributes nothing and takes nothing away.
--
-- Everything else is carried over unchanged from the existing definition, including the
-- open-stoppage clock and the planned-work exemption.
-- =====================================================================

CREATE OR REPLACE VIEW public.v_wo_downtime_total AS
 SELECT de.work_order_id,
    count(*)::integer AS stop_count,
        CASE
            WHEN COALESCE(p.planned, false) THEN 0
            ELSE COALESCE(sum(
              GREATEST(
                COALESCE(de.duration_minutes,
                         (EXTRACT(epoch FROM now() - de.stopped_at) / 60::numeric)::integer),
                0)
            ), 0::bigint)::integer
        END AS total_minutes,
    bool_or(de.resumed_at IS NULL) AS has_open_stop
   FROM downtime_events de
     LEFT JOIN work_orders w ON w.id = de.work_order_id
     LEFT JOIN problem_descriptions p ON lower(p.name) = lower(w.description)
  GROUP BY de.work_order_id, p.planned;

COMMENT ON VIEW public.v_wo_downtime_total IS
  'Minutos de paragem por ordem. Cada evento entra com piso zero: um evento impossivel '
  '(resumed_at < stopped_at) conta 0 em vez de SUBTRAIR do total da linha — ver 20260909090000, '
  'onde a WO 918 tirava 523 minutos ao downtime da Line 4. O piso e por evento e nao sobre a soma, '
  'para que uma linha ma nao possa anular uma boa dentro da mesma ordem.';

COMMENT ON CONSTRAINT downtime_events_resumed_after_stopped ON public.downtime_events IS
  'NOT VALID: aplica-se a escritas novas, nao revalida as 2 linhas historicas (WO 498 e 918). '
  'Depois de essas serem corrigidas pelo ecra de correccoes, correr '
  'ALTER TABLE public.downtime_events VALIDATE CONSTRAINT downtime_events_resumed_after_stopped;';
