-- A matriz de permissões do Admin escreve em role_permission_overrides, mas
-- nenhuma política RLS a consultava: desligar um switch escondia o botão e
-- deixava a escrita passar. Estes triggers fazem o Postgres recusá-la.
-- Semântica: só negar. A base de quem pode o quê continua no MATRIX (TypeScript).

CREATE OR REPLACE FUNCTION public.action_revoked(_action text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  -- Sem utilizador (edge functions, pg_cron) nada é negado: um switch do Admin
  -- não pode parar o sync do iTouching nem os fechos noturnos.
  SELECT auth.uid() IS NOT NULL AND EXISTS (
    SELECT 1
    FROM public.role_permission_overrides o
    WHERE o.action = _action
      AND o.allowed = false
      AND o.role = public.current_user_role()
  )
$$;

CREATE OR REPLACE FUNCTION public.enforce_action()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF public.action_revoked(TG_ARGV[0]) THEN
    RAISE EXCEPTION 'Permission "%" is turned off for your role.', TG_ARGV[0]
      USING ERRCODE = '42501';
  END IF;
  RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END;
$$;

DROP TRIGGER IF EXISTS wo_guard_insert ON public.work_orders;
CREATE TRIGGER wo_guard_insert
  BEFORE INSERT ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_action('wo.create');

DROP TRIGGER IF EXISTS wo_guard_update ON public.work_orders;
CREATE TRIGGER wo_guard_update
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_action('wo.update');

DROP TRIGGER IF EXISTS wo_guard_delete ON public.work_orders;
CREATE TRIGGER wo_guard_delete
  BEFORE DELETE ON public.work_orders
  FOR EACH ROW EXECUTE FUNCTION public.enforce_action('wo.delete');

DROP TRIGGER IF EXISTS wo_guard_close ON public.work_orders;
CREATE TRIGGER wo_guard_close
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW
  WHEN (NEW.status = 'closed' AND OLD.status IS DISTINCT FROM 'closed')
  EXECUTE FUNCTION public.enforce_action('wo.close');

DROP TRIGGER IF EXISTS wo_guard_force ON public.work_orders;
CREATE TRIGGER wo_guard_force
  BEFORE UPDATE ON public.work_orders
  FOR EACH ROW
  WHEN (NEW.status = 'force_closed' AND OLD.status IS DISTINCT FROM 'force_closed')
  EXECUTE FUNCTION public.enforce_action('wo.force');

-- Rollback:
--   DROP TRIGGER IF EXISTS wo_guard_force  ON public.work_orders;
--   DROP TRIGGER IF EXISTS wo_guard_close  ON public.work_orders;
--   DROP TRIGGER IF EXISTS wo_guard_delete ON public.work_orders;
--   DROP TRIGGER IF EXISTS wo_guard_update ON public.work_orders;
--   DROP TRIGGER IF EXISTS wo_guard_insert ON public.work_orders;
--   DROP FUNCTION IF EXISTS public.enforce_action();
--   DROP FUNCTION IF EXISTS public.action_revoked(text);
