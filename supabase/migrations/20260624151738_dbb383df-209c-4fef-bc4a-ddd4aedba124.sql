-- Fechar work_orders com line_stopped_at órfão (sem line_resumed_at) anteriores a hoje.
-- O cron job de fim-de-turno só fecha downtime_events; replicamos para work_orders.

UPDATE public.work_orders
SET line_resumed_at = line_stopped_at + interval '1 hour'
WHERE line_stopped_at IS NOT NULL
  AND line_resumed_at IS NULL
  AND line_stopped_at < date_trunc('day', now() AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London';

-- Cron: fim do turno de dia (18:00 London = 17:00 UTC no BST)
SELECT cron.unschedule('close-day-shift-work-orders') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'close-day-shift-work-orders'
);
SELECT cron.schedule(
  'close-day-shift-work-orders',
  '0 17 * * *',
  $$
    UPDATE public.work_orders
    SET line_resumed_at = now()
    WHERE line_stopped_at IS NOT NULL
      AND line_resumed_at IS NULL
      AND line_stopped_at >= (date_trunc('day', now() AT TIME ZONE 'Europe/London') AT TIME ZONE 'Europe/London') + interval '6 hours'
      AND line_stopped_at < now();
  $$
);

-- Cron: fim do turno de noite (06:00 London = 05:00 UTC no BST)
SELECT cron.unschedule('close-night-shift-work-orders') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'close-night-shift-work-orders'
);
SELECT cron.schedule(
  'close-night-shift-work-orders',
  '0 5 * * *',
  $$
    UPDATE public.work_orders
    SET line_resumed_at = now()
    WHERE line_stopped_at IS NOT NULL
      AND line_resumed_at IS NULL
      AND line_stopped_at >= (date_trunc('day', (now() AT TIME ZONE 'Europe/London') - interval '1 day') AT TIME ZONE 'Europe/London') + interval '18 hours'
      AND line_stopped_at < now();
  $$
);