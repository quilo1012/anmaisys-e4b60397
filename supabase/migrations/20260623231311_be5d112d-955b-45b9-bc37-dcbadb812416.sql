
-- ─── work_orders: hottest table in the app ────────────────────────────────
-- Manager/Control Center dashboards: list active WOs for a line, newest first.
CREATE INDEX IF NOT EXISTS idx_wo_physical_line_status_created
  ON public.work_orders (physical_line_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_wo_line_status_created
  ON public.work_orders (line_id, status, created_at DESC);

-- Engineer Dashboard: "my WOs" lookups.
CREATE INDEX IF NOT EXISTS idx_wo_engineer_status
  ON public.work_orders (engineer_id, status)
  WHERE engineer_id IS NOT NULL;

-- Machine history page: every WO ever raised for a machine, newest first.
CREATE INDEX IF NOT EXISTS idx_wo_machine_created
  ON public.work_orders (machine, created_at DESC);

-- SLA / criticality views — prioritise critical+high in lists.
CREATE INDEX IF NOT EXISTS idx_wo_priority_status
  ON public.work_orders (priority, status);

-- ─── audit_logs: pagination + filters from AuditLogsPage ──────────────────
CREATE INDEX IF NOT EXISTS idx_audit_logs_created_desc
  ON public.audit_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_entity_type_created
  ON public.audit_logs (entity_type, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_created
  ON public.audit_logs (user_id, created_at DESC);

-- ─── products: low-stock alerts ──────────────────────────────────────────
-- Partial index for the "needs reorder" predicate used on the Stock page.
CREATE INDEX IF NOT EXISTS idx_products_low_stock
  ON public.products (quantity, min_stock)
  WHERE quantity <= min_stock;

-- ─── machine_events: reliability dashboard ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_machine_events_machine_created
  ON public.machine_events (machine_id, created_at DESC);

-- ─── downtime_events: timeline + open-downtime lookups ────────────────────
CREATE INDEX IF NOT EXISTS idx_downtime_events_wo_stopped
  ON public.downtime_events (work_order_id, stopped_at DESC);
CREATE INDEX IF NOT EXISTS idx_downtime_events_open
  ON public.downtime_events (work_order_id)
  WHERE resumed_at IS NULL;

-- ─── wo_episodes: recurrence lookups ──────────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_wo_episodes_wo_episode
  ON public.wo_episodes (work_order_id, episode_number DESC);
