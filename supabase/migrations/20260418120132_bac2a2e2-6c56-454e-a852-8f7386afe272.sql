-- 1. Tabela de eventos de downtime
CREATE TABLE IF NOT EXISTS public.downtime_events (
  id              UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  work_order_id   UUID NOT NULL REFERENCES public.work_orders(id) ON DELETE CASCADE,
  stopped_at      TIMESTAMPTZ NOT NULL,
  stopped_by      UUID REFERENCES public.profiles(id),
  stopped_by_name TEXT,
  stopped_reason  TEXT,
  resumed_at      TIMESTAMPTZ,
  resumed_by      UUID REFERENCES public.profiles(id),
  resumed_by_name TEXT,
  resumed_note    TEXT,
  duration_minutes INTEGER GENERATED ALWAYS AS (
    CASE
      WHEN resumed_at IS NOT NULL
        THEN (EXTRACT(EPOCH FROM (resumed_at - stopped_at))/60)::int
      ELSE NULL
    END
  ) STORED,
  created_at      TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_downtime_wo
  ON public.downtime_events(work_order_id);

CREATE INDEX IF NOT EXISTS idx_downtime_open
  ON public.downtime_events(work_order_id)
  WHERE resumed_at IS NULL;

CREATE UNIQUE INDEX IF NOT EXISTS idx_downtime_one_open_per_wo
  ON public.downtime_events(work_order_id)
  WHERE resumed_at IS NULL;

-- 2. RLS
ALTER TABLE public.downtime_events ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS dt_select ON public.downtime_events;
CREATE POLICY dt_select ON public.downtime_events
  FOR SELECT TO authenticated USING (true);

DROP POLICY IF EXISTS dt_insert ON public.downtime_events;
CREATE POLICY dt_insert ON public.downtime_events
  FOR INSERT TO authenticated
  WITH CHECK (
    stopped_by = auth.uid() AND (
      public.has_role(auth.uid(),'operator'::app_role) OR
      public.has_role(auth.uid(),'engineer'::app_role) OR
      public.has_role(auth.uid(),'manager'::app_role) OR
      public.has_role(auth.uid(),'admin'::app_role)
    )
  );

DROP POLICY IF EXISTS dt_update ON public.downtime_events;
CREATE POLICY dt_update ON public.downtime_events
  FOR UPDATE TO authenticated
  USING (
    public.has_role(auth.uid(),'engineer'::app_role) OR
    public.has_role(auth.uid(),'manager'::app_role) OR
    public.has_role(auth.uid(),'admin'::app_role) OR
    public.has_role(auth.uid(),'operator'::app_role)
  );

-- 3. Migração de dados antigos
INSERT INTO public.downtime_events (
  work_order_id, stopped_at, stopped_by, resumed_at, resumed_by
)
SELECT id, line_stopped_at, line_stopped_by, line_resumed_at, line_resumed_by
FROM public.work_orders
WHERE line_stopped_at IS NOT NULL
  AND NOT EXISTS (
    SELECT 1 FROM public.downtime_events de
    WHERE de.work_order_id = work_orders.id
  );

-- 4. Trigger para sincronizar work_orders.line_*
CREATE OR REPLACE FUNCTION public.sync_wo_line_status()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _wo_id uuid := COALESCE(NEW.work_order_id, OLD.work_order_id);
BEGIN
  UPDATE public.work_orders wo
  SET
    line_stopped = EXISTS (
      SELECT 1 FROM public.downtime_events
      WHERE work_order_id = wo.id AND resumed_at IS NULL
    ),
    line_stopped_at = (
      SELECT stopped_at FROM public.downtime_events
      WHERE work_order_id = wo.id AND resumed_at IS NULL
      ORDER BY stopped_at DESC LIMIT 1
    ),
    line_stopped_by = (
      SELECT stopped_by FROM public.downtime_events
      WHERE work_order_id = wo.id AND resumed_at IS NULL
      ORDER BY stopped_at DESC LIMIT 1
    ),
    line_resumed_at = (
      SELECT resumed_at FROM public.downtime_events
      WHERE work_order_id = wo.id AND resumed_at IS NOT NULL
      ORDER BY resumed_at DESC LIMIT 1
    ),
    line_resumed_by = (
      SELECT resumed_by FROM public.downtime_events
      WHERE work_order_id = wo.id AND resumed_at IS NOT NULL
      ORDER BY resumed_at DESC LIMIT 1
    )
  WHERE wo.id = _wo_id;
  RETURN NULL;
END $$;

DROP TRIGGER IF EXISTS trg_downtime_sync ON public.downtime_events;
CREATE TRIGGER trg_downtime_sync
  AFTER INSERT OR UPDATE OR DELETE ON public.downtime_events
  FOR EACH ROW EXECUTE FUNCTION public.sync_wo_line_status();

-- 5. View de totais
CREATE OR REPLACE VIEW public.v_wo_downtime_total AS
SELECT
  work_order_id,
  COUNT(*)::int AS stop_count,
  COALESCE(SUM(
    COALESCE(duration_minutes, (EXTRACT(EPOCH FROM (now() - stopped_at))/60)::int)
  ), 0)::int AS total_minutes,
  bool_or(resumed_at IS NULL) AS has_open_stop
FROM public.downtime_events
GROUP BY work_order_id;

-- 6. Realtime
ALTER TABLE public.downtime_events REPLICA IDENTITY FULL;
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename = 'downtime_events'
  ) THEN
    EXECUTE 'ALTER PUBLICATION supabase_realtime ADD TABLE public.downtime_events';
  END IF;
END $$;