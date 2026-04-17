-- Add line_stopped tracking columns to work_orders
ALTER TABLE public.work_orders
  ADD COLUMN IF NOT EXISTS line_stopped boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS line_stopped_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS line_stopped_by uuid,
  ADD COLUMN IF NOT EXISTS line_resumed_at timestamp with time zone,
  ADD COLUMN IF NOT EXISTS line_resumed_by uuid;

-- Clean any sound preferences from ui_preferences
UPDATE public.profiles
  SET ui_preferences = ui_preferences - 'sound' - 'volume' - 'soundEnabled' - 'notification_sound'
  WHERE ui_preferences ?| array['sound','volume','soundEnabled','notification_sound'];