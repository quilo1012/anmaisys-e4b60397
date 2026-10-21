-- F-7 (#1): guard the column-level grants on public.profiles.
-- Run the WHOLE file in the SQL editor / test harness. Read-only. Prints ALL TESTS
-- PASSED or raises.
--
-- secure_labor_rate (20260724130000) replaced the table-wide SELECT on profiles with
-- column-level grants that EXCLUDE labor_rate, so pay rate is only readable through the
-- admin/self SECURITY DEFINER RPCs. Column-level grants do NOT auto-include new columns,
-- which is the landmine: when a column is added and a feature cannot read it, the easy
-- "fix" is `GRANT SELECT ON public.profiles TO authenticated` — which re-exposes
-- labor_rate to every signed-in user. (avatar_path, added 20261019160000 after that
-- migration, is the live example of an ungranted new column — safe here, but it shows the
-- gap.)
--
-- This guard makes that impossible to do silently:
--   1. labor_rate (and any other sensitive column) must NOT be SELECT-able by
--      authenticated or anon. A table-wide re-grant trips this, because it would hand
--      labor_rate out too.
--   2. every column of profiles must be CLASSIFIED below — a new, unclassified column
--      fails the test, forcing a conscious readable-vs-sensitive decision.

do $$
declare
  -- Columns that must NEVER be readable by authenticated/anon (readable only via the
  -- SECURITY DEFINER pay-rate RPCs).
  sensitive text[] := array['labor_rate'];
  -- Columns that are not sensitive. Being listed here does NOT assert they are granted
  -- (e.g. avatar_path is currently not granted to authenticated); it asserts only that
  -- the column has been looked at and is safe to expose.
  non_sensitive text[] := array[
    'id', 'name', 'email', 'shift', 'active', 'production_line',
    'ui_preferences', 'last_seen_at', 'created_at', 'updated_at', 'avatar_path'
  ];
  col text;
  unclassified text[] := '{}';
  leaked text[] := '{}';
begin
  -- 1) Security: no sensitive column readable by authenticated or anon.
  foreach col in array sensitive loop
    if has_column_privilege('authenticated', 'public.profiles', col, 'SELECT') then
      leaked := leaked || ('authenticated:' || col);
    end if;
    if has_column_privilege('anon', 'public.profiles', col, 'SELECT') then
      leaked := leaked || ('anon:' || col);
    end if;
  end loop;
  if array_length(leaked, 1) is not null then
    raise exception E'FAILED: sensitive profiles column(s) are SELECT-able — a table-wide GRANT is the usual cause:\n  %',
      array_to_string(leaked, E'\n  ');
  end if;

  -- 2) Completeness: every actual column is classified.
  for col in
    select column_name from information_schema.columns
     where table_schema = 'public' and table_name = 'profiles'
  loop
    if not (col = any(sensitive) or col = any(non_sensitive)) then
      unclassified := unclassified || col;
    end if;
  end loop;
  if array_length(unclassified, 1) is not null then
    raise exception E'FAILED: new profiles column(s) not classified in this test — add each to `sensitive` or `non_sensitive` and set its grant accordingly:\n  %',
      array_to_string(unclassified, E'\n  ');
  end if;

  raise notice 'ALL TESTS PASSED — profiles sensitive columns stay out of reach and every column is classified';
end $$;
