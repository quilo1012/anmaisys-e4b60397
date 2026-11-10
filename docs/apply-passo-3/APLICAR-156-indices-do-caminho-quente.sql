-- BLOCO 156 — colar no SQL Editor do projeto AN Maintenance (Supabase), não no Lovable.
-- Só índices (IF NOT EXISTS): pode colar-se duas vezes. Verificação no fim.

-- Two indexes for reads that every open screen repeats on a timer.
--
-- Index only: no policy, function or data changes, and IF NOT EXISTS makes it safe to
-- paste twice. Both tables are small enough that a plain CREATE INDEX holds its lock
-- for well under a second.

-- The Root Diagnostics badge (src/hooks/useTelemetryBadge.ts) counts
--   error_type = 'REACT_CRASH' AND created_at > <last seen>
-- every 60 seconds for every admin. The table had only (created_at DESC), and on a
-- first visit <last seen> is 1970, so the count read every row in the table and
-- evaluated the admin policy on each one.
CREATE INDEX IF NOT EXISTS system_telemetry_logs_type_created_idx
  ON public.system_telemetry_logs (error_type, created_at DESC);

-- Line tablets read their own line's orders (useWorkOrders({ lineId })) every 30
-- seconds and on every realtime event, and the line-scoping policy compares
-- line_id = ANY(...). physical_line_id has an index; line_id had none.
CREATE INDEX IF NOT EXISTS idx_work_orders_line_id
  ON public.work_orders (line_id);

-- Verificação: as duas linhas devem aparecer.
select indexname from pg_indexes
 where schemaname = 'public'
   and indexname in ('system_telemetry_logs_type_created_idx', 'idx_work_orders_line_id');
