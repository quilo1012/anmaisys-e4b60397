-- An engineer's action, logged twice, stops reaching the client as a failure.
--
-- `idx_work_order_logs_unique_action` is a PARTIAL unique index: one row per
-- (work_order_id, engineer_id, action), and only for accept, start, finish,
-- machine_back_to_work, started and finished. That is deliberate. `received` on a
-- reopened order is a new fact and must write again — twenty-six rows on file are
-- exactly that, and a full unique index would have called them errors.
--
-- The client could not write through it without failing. Both attempts failed on the
-- wire, and the fetch interceptor files every failed Supabase call as a fault, so a
-- handled non-event kept filling Root Diagnostics:
--
--   * `on_conflict=work_order_id,engineer_id,action` → 42P10. Postgres cannot infer a
--     partial index from a conflict target that carries no matching predicate. Live
--     03/08–07/08; the action log wrote nothing at all for two days.
--   * no target at all → 23505. The assumption was that PostgREST would then emit a
--     bare `ON CONFLICT DO NOTHING`. It does not. It defaults the target to the primary
--     key and emits `ON CONFLICT("id") DO NOTHING`, which can never fire, because `id`
--     is generated fresh on every request. pg_stat_statements holds the statement it
--     ran, 34 calls of it.
--
-- PostgREST cannot express a predicate, so no target it can send will ever name that
-- index. A function can: `ON CONFLICT DO NOTHING` with no target is satisfied by any
-- constraint, including a partial one, and it is settled inside the statement, so two
-- taps racing each other cost nothing either — which a read-then-insert could not
-- promise.
--
-- SECURITY INVOKER on purpose: the row is still inserted as the caller, so
-- "Authenticated can insert work_order_logs" decides, exactly as it does today. This
-- function widens nothing.
CREATE OR REPLACE FUNCTION public.log_wo_action(
  p_work_order_id uuid,
  p_engineer_id   uuid,
  p_engineer_name text,
  p_action        text
)
RETURNS void
LANGUAGE sql
SECURITY INVOKER
SET search_path = public
AS $$
  INSERT INTO public.work_order_logs (work_order_id, engineer_id, engineer_name, action)
  VALUES (p_work_order_id, p_engineer_id, p_engineer_name, p_action)
  ON CONFLICT DO NOTHING;
$$;

-- A foreign key violation is still raised: the work order was deleted while somebody
-- had it on screen, and the caller already knows what to do about that. Only the
-- duplicate is swallowed, because only the duplicate is a non-event.

-- `anon` is revoked explicitly, not just via PUBLIC: Supabase's default privileges hand
-- EXECUTE on every new function in `public` to anon by name, and a REVOKE FROM PUBLIC
-- does not touch a grant held by name. The other work-order functions all sit this way.
REVOKE ALL ON FUNCTION public.log_wo_action(uuid, uuid, text, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.log_wo_action(uuid, uuid, text, text) FROM anon;
GRANT EXECUTE ON FUNCTION public.log_wo_action(uuid, uuid, text, text) TO authenticated;
