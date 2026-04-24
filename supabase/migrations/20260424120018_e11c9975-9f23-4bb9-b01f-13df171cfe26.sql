
-- Operator line accounts: maps a shared-tablet operator login to its allowed lines
CREATE TABLE IF NOT EXISTS public.operator_line_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL UNIQUE,
  email text NOT NULL UNIQUE,
  label text NOT NULL,
  line_ids uuid[] NOT NULL DEFAULT '{}'::uuid[],
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  created_by uuid
);

ALTER TABLE public.operator_line_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated can view operator_line_accounts"
ON public.operator_line_accounts
FOR SELECT TO authenticated
USING (true);

CREATE POLICY "Admins managers can insert operator_line_accounts"
ON public.operator_line_accounts
FOR INSERT TO authenticated
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Admins managers can update operator_line_accounts"
ON public.operator_line_accounts
FOR UPDATE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role))
WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));

CREATE POLICY "Admins managers can delete operator_line_accounts"
ON public.operator_line_accounts
FOR DELETE TO authenticated
USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'manager'::app_role));

CREATE TRIGGER operator_line_accounts_updated_at
BEFORE UPDATE ON public.operator_line_accounts
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Helper: admin-only listing of all operator user_ids (used by edge function for bulk reset)
CREATE OR REPLACE FUNCTION public.list_operator_account_user_ids()
RETURNS TABLE(user_id uuid, email text)
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF auth.uid() IS NULL OR NOT has_role(auth.uid(), 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;
  RETURN QUERY SELECT o.user_id, o.email FROM public.operator_line_accounts o;
END;
$$;
