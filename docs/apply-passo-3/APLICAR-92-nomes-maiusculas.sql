-- A name is written one way: first letter of each word capital, the rest small.
--
-- The employee list had "JOAO SPINELLI" and "KAMILLA ZAPELINI" beside "Juliano Santos".
-- The screens now write names in that form (src/lib/personName.ts), but the screens are
-- not the only writers — imports, the SQL editor, anything to come — so the rule lives
-- here, on every insert and every rename, and the screen's copy is a convenience.
--
-- The rule is `initcap` after trimming and collapsing spaces, the same rule the client
-- applies, so the two cannot disagree about a name.
--
-- The backfill skips a row whose corrected name would collide with another person's on
-- `employees_name_unique_idx` (lower(full_name)). Only a change of spacing can do that —
-- a change of case cannot — and one such pair would otherwise abort the whole update.
-- Those rows are left as they are for a human to settle; the query at the end lists them.
--
-- Idempotent.

create or replace function public.person_name_case(raw text)
returns text
language sql
immutable
set search_path = public
as $$
  select initcap(regexp_replace(btrim(raw), '\s+', ' ', 'g'))
$$;

create or replace function public.employees_name_case()
returns trigger
language plpgsql
set search_path = public
as $$
begin
  if new.full_name is not null then
    new.full_name := public.person_name_case(new.full_name);
  end if;
  return new;
end;
$$;

drop trigger if exists trg_employees_name_case on public.employees;
create trigger trg_employees_name_case
  before insert or update of full_name on public.employees
  for each row execute function public.employees_name_case();

update public.employees e
   set full_name = public.person_name_case(e.full_name)
 where e.full_name is distinct from public.person_name_case(e.full_name)
   and not exists (
     select 1 from public.employees o
      where o.id <> e.id
        and lower(public.person_name_case(o.full_name)) = lower(public.person_name_case(e.full_name))
   );

-- Left behind, if any: rows whose corrected name is already somebody else's.
--   select id, full_name from public.employees
--    where full_name is distinct from public.person_name_case(full_name);
