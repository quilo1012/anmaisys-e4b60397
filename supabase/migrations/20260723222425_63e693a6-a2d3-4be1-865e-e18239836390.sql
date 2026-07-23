
-- 1. Remove supervisor broad access to audit_logs and profiles
DROP POLICY IF EXISTS "supervisor_read_access" ON public.audit_logs;
DROP POLICY IF EXISTS "supervisor_read_access" ON public.profiles;

-- 2. Scope realtime.messages INSERT so operators can only broadcast to their own line topics
DROP POLICY IF EXISTS "Authorized app roles can send realtime" ON realtime.messages;
CREATE POLICY "Authorized app roles can send realtime"
  ON realtime.messages
  FOR INSERT
  TO authenticated
  WITH CHECK (
    public.has_role(auth.uid(), 'admin'::public.app_role)
    OR public.has_role(auth.uid(), 'manager'::public.app_role)
    OR public.has_role(auth.uid(), 'engineer'::public.app_role)
    OR (
      public.has_role(auth.uid(), 'operator'::public.app_role)
      AND EXISTS (
        SELECT 1
        FROM public.operator_line_accounts ola
        WHERE ola.user_id = auth.uid()
          AND EXISTS (
            SELECT 1 FROM unnest(ola.line_ids) AS lid(lid)
            WHERE realtime.topic() LIKE '%' || lid.lid::text || '%'
          )
      )
    )
  );

-- 3. Set immutable search_path on _norm_img
CREATE OR REPLACE FUNCTION public._norm_img(u text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
 SET search_path = public
AS $function$
DECLARE r text;
BEGIN
  IF u IS NULL THEN RETURN NULL; END IF;
  r := replace(u, '&amp;', '&');
  r := regexp_replace(r, '_[0-9]+x\.', '_1600x.');
  IF r LIKE '//%' THEN r := 'https:' || r;
  ELSE r := regexp_replace(r, '^http://', 'https://'); END IF;
  RETURN r;
END;
$function$;
