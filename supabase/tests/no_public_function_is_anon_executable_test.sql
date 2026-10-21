-- F-1 regression invariant. Run the WHOLE file in the SQL editor (or test harness)
-- AFTER 20261021_f1_lock_anon_default_execute.sql. Read-only: inspects catalogue
-- privileges only, writes nothing. Prints ALL TESTS PASSED or raises.
--
-- Unlike the per-function lists (anon_was_granted_on_its_own_test.sql et al.), this is
-- the WHOLE-SCHEMA invariant: NO function in `public` may be executable by `anon`,
-- except the handful the pre-session login screen genuinely needs. A function added in
-- any future migration that re-inherits the anon default-grant fails here on day one,
-- which ends the whack-a-mole.
--
-- If you add a legitimately-anon login function later, add it to `allow` below in the
-- same change — that review is the point.

do $$
declare
  r record;
  sig text;
  leaked text[] := '{}';
  allow text[] := array[
    'check_invite_code',
    'get_login_branding',
    'list_tablet_accounts_public',
    'signup_invite_code'
  ];
begin
  for r in
    select p.oid,
           p.proname,
           pg_get_function_identity_arguments(p.oid) as args
      from pg_proc p
      join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public'
       and p.prokind = 'f'            -- plain functions (not aggregates/procedures)
  loop
    if r.proname = any(allow) then
      continue;                       -- intentionally anon (login screen)
    end if;
    sig := format('public.%I(%s)', r.proname, r.args);
    if has_function_privilege('anon', r.oid, 'execute') then
      leaked := leaked || sig;
    end if;
  end loop;

  if array_length(leaked, 1) is not null then
    raise exception E'FAILED: % public function(s) are anon-executable outside the login allowlist:\n  %',
      array_length(leaked, 1), array_to_string(leaked, E'\n  ');
  end if;

  -- And the login allowlist must still work (a revoke that took too much is also a bug).
  declare fn text;
  begin
    foreach fn in array array[
      'public.check_invite_code(text)',
      'public.get_login_branding()',
      'public.list_tablet_accounts_public()',
      'public.signup_invite_code(text)'
    ] loop
      continue when to_regprocedure(fn) is null;
      if not has_function_privilege('anon', fn, 'execute') then
        raise exception 'FAILED: login function % lost anon EXECUTE', fn;
      end if;
    end loop;
  end;

  raise notice 'ALL TESTS PASSED — no public function is anon-executable outside the login allowlist';
end $$;
