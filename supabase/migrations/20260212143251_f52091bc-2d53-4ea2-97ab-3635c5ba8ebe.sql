
-- 1. Extend wo_status enum with new values
ALTER TYPE public.wo_status ADD VALUE IF NOT EXISTS 'received';
ALTER TYPE public.wo_status ADD VALUE IF NOT EXISTS 'arrived';
ALTER TYPE public.wo_status ADD VALUE IF NOT EXISTS 'finished';
ALTER TYPE public.wo_status ADD VALUE IF NOT EXISTS 'closed';

-- 2. Add new timestamp columns and priority to work_orders
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS received_at timestamptz;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS arrived_at timestamptz;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS finished_at timestamptz;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS closed_at timestamptz;
ALTER TABLE public.work_orders ADD COLUMN IF NOT EXISTS priority text NOT NULL DEFAULT 'medium';

-- 3. Create audit_logs table
CREATE TABLE IF NOT EXISTS public.audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid,
  user_name text NOT NULL,
  action text NOT NULL,
  entity_type text NOT NULL,
  entity_id text,
  details jsonb DEFAULT '{}',
  ip_address text,
  created_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;

-- Only admins can view audit logs
CREATE POLICY "Admins can view audit logs"
  ON public.audit_logs FOR SELECT
  USING (has_role(auth.uid(), 'admin'::app_role));

-- No direct insert/update/delete — use the security definer function below

-- 4. Security definer function for logging audit events (callable by any authenticated user)
CREATE OR REPLACE FUNCTION public.log_audit_event(
  _action text,
  _entity_type text,
  _entity_id text DEFAULT NULL,
  _details jsonb DEFAULT '{}'
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (
    auth.uid(),
    COALESCE((SELECT name FROM public.profiles WHERE id = auth.uid()), 'Unknown'),
    _action,
    _entity_type,
    _entity_id,
    _details
  );
END;
$$;
