DO $$
DECLARE
  pol record;
  policy_cmd text;
  roles_sql text;
  using_sql text;
  check_sql text;
BEGIN
  FOR pol IN
    SELECT gp.schemaname, gp.tablename, gp.policyname, gp.cmd, gp.roles, gp.qual, gp.with_check
    FROM pg_policies gp
    WHERE gp.schemaname = 'public'
      AND (gp.qual = 'true' OR gp.with_check = 'true')
  LOOP
    EXECUTE format('DROP POLICY IF EXISTS %I ON %I.%I', pol.policyname, pol.schemaname, pol.tablename);

    policy_cmd := CASE pol.cmd WHEN 'ALL' THEN 'ALL' ELSE pol.cmd END;
    roles_sql := array_to_string(ARRAY(SELECT quote_ident(r) FROM unnest(pol.roles) AS r), ', ');
    using_sql := CASE WHEN pol.qual IS NOT NULL THEN replace(pol.qual, 'true', 'auth.uid() IS NOT NULL') END;
    check_sql := CASE WHEN pol.with_check IS NOT NULL THEN replace(pol.with_check, 'true', 'auth.uid() IS NOT NULL') END;

    EXECUTE format(
      'CREATE POLICY %I ON %I.%I FOR %s TO %s%s%s',
      pol.policyname,
      pol.schemaname,
      pol.tablename,
      policy_cmd,
      roles_sql,
      CASE WHEN using_sql IS NOT NULL THEN ' USING (' || using_sql || ')' ELSE '' END,
      CASE WHEN check_sql IS NOT NULL THEN ' WITH CHECK (' || check_sql || ')' ELSE '' END
    );
  END LOOP;
END $$;

ALTER VIEW IF EXISTS public.v_wo_downtime_total SET (security_invoker = true);
ALTER VIEW IF EXISTS public.v_wo_metrics SET (security_invoker = true);
ALTER VIEW IF EXISTS public.profiles_safe SET (security_invoker = true);
ALTER VIEW IF EXISTS public.engineers_safe SET (security_invoker = true);