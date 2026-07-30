-- Finished orders move themselves to Done.
--
-- "Finished" means the engineer has done the work; "Done" (closed) means someone
-- signed it off. Nobody was doing the second step, so the Finished column grew
-- without bound and the board stopped telling anyone anything — the same orders
-- sat there for weeks while the line moved on.
--
-- Rather than drop the sign-off, it gets a deadline: 24 hours for a manager to
-- review and close it by hand, after which the system closes it and says so. The
-- order keeps its history, the audit log records who closed it (or that nobody
-- did), and the board only shows work that still needs a person.
--
-- Force-closed orders are left alone: they are already terminal and closing them
-- again would overwrite the reason they were forced.

CREATE OR REPLACE FUNCTION public.auto_close_finished_work_orders(_grace_hours integer DEFAULT 24)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _n integer := 0;
  _r record;
BEGIN
  FOR _r IN
    SELECT id, wo_number, status, finished_at, line_stopped, line_resumed_at
    FROM public.work_orders
    WHERE status = 'finished'
      AND finished_at IS NOT NULL
      AND finished_at < now() - make_interval(hours => GREATEST(_grace_hours, 1))
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.work_orders
    SET status = 'closed',
        closed_at = now(),
        -- No closed_by: nobody signed this one off, and pretending otherwise would
        -- put a person's name against a review they never did.
        operator_signature_name = COALESCE(operator_signature_name, 'Auto-closed (no sign-off within ' || _grace_hours || 'h)'),
        -- Release the line if the engineer forgot to. Downtime auto-close keys off
        -- line_resumed_at, so leaving it open inflates downtime without bound.
        line_stopped = CASE WHEN line_stopped AND line_resumed_at IS NULL THEN false ELSE line_stopped END,
        line_resumed_at = CASE WHEN line_stopped AND line_resumed_at IS NULL THEN now() ELSE line_resumed_at END
    WHERE id = _r.id;

    INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
    VALUES (
      NULL,
      'System (auto-close)',
      'auto_close',
      'work_order',
      _r.id::text,
      jsonb_build_object(
        'before', jsonb_build_object('status', _r.status, 'finished_at', _r.finished_at),
        'after', jsonb_build_object('status', 'closed'),
        'reason', format('finished more than %sh ago with no sign-off', _grace_hours)
      )
    );

    _n := _n + 1;
  END LOOP;

  RETURN _n;
END
$function$;

REVOKE ALL ON FUNCTION public.auto_close_finished_work_orders(integer) FROM PUBLIC, anon, authenticated;

-- Hourly, so an order closes within an hour of its deadline rather than at a fixed
-- time of day that could be 23 hours later.
SELECT cron.unschedule('auto-close-finished-wos')
WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'auto-close-finished-wos');

SELECT cron.schedule(
  'auto-close-finished-wos',
  '7 * * * *',
  $$SELECT public.auto_close_finished_work_orders(24);$$
);
