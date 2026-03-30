ALTER TABLE public.work_orders
  ADD COLUMN paused_at timestamptz DEFAULT NULL,
  ADD COLUMN total_paused_minutes integer NOT NULL DEFAULT 0;