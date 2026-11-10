-- APLICAR 156 — índice para o contador de crashes do Root Diagnostics.
--
-- PT: Colar no SQL Editor do AN Maintenance (Supabase), o ficheiro inteiro. É o BLOCO 156 do
-- APPLY-ALL-IN-ORDER.sql, byte a byte. Cria só um índice; não muda tabelas, políticas nem
-- dados. Pode colar-se duas vezes. Depois correr VERIFY-156-indice-do-badge.sql (só lê).
--
-- EN: Paste the whole file into the AN Maintenance SQL Editor; it is BLOCO 156. One index,
-- no table, policy or data change. Then run VERIFY-156.

-- ================================================================
-- BLOCO 156
-- 20261110130000_hot_path_indexes.sql
-- ================================================================
-- BLOCO 156 — colar no SQL Editor do projeto AN Maintenance (Supabase), não no Lovable.
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
