-- One login is one person, one badge is one person, and a crew change keeps its date.
--
-- `employees.user_id` is the only link between somebody who signs in and the record
-- they are paid from. `my_employee_id()`, `my_overtime_identity`, `my_attendance` and
-- `has_action`'s employee ceiling all read it. It had no constraint at all:
--
--   * No uniqueness. The Users screen linked by a plain UPDATE that never asked whether
--     the login already had a person, so one login could hold two. `my_employee_id()`
--     then answers with `limit 1` — whichever of the two the planner reaches first —
--     and the person's overtime answers and attendance can belong to either.
--   * No foreign key. Deleting a login (the `delete-user` function) left its id on the
--     employee row, pointing at nobody. `login_link_candidates` drops such a row from
--     both of its lists — not unclaimed (`user_id is null` fails), not linked (the join
--     to auth.users finds nothing) — so nobody can see it to fix it.
--
-- `employee_ref` was unique byte for byte and looked up case-blind everywhere
-- (`upper(trim())` in SQL, `ilike` in `employee-signin`), so "e045" and "E045 " could
-- both be stored and every lookup of either would find two people.
--
-- And `employee_shift_history`, the dated record of a crew change that every
-- date-aware read goes through, could only be written by admin, while the crew
-- columns on `employees` are written by anybody with `workforce.manage`. For the five
-- production office admin accounts the board changed the crew and then failed to
-- record when — the current column and the history disagreeing from that day on.
--
-- Nothing here adds a column or a table. It constrains the ones that already are the
-- source of truth. The two checks that could find bad data REFUSE and name it rather
-- than choosing for anybody: which of two records a login really is, or which of two
-- spellings of a badge is right, is a fact the office has and this file does not.
--
-- Idempotent. Independent of the blocks still waiting (81, 90, 94).

-- ── 1. Links to logins that no longer exist ──────────────────────────────────
-- The login is gone, so there is nothing to keep: the record goes back to unclaimed,
-- where `login_link_candidates` shows it again. Named in the output, so the paste
-- says who it touched.
do $$
declare v_names text;
begin
  select string_agg(e.full_name, ', ' order by e.full_name) into v_names
    from public.employees e
   where e.user_id is not null
     and not exists (select 1 from auth.users u where u.id = e.user_id);
  if v_names is not null then
    raise notice 'Unlinked from a login that no longer exists: %', v_names;
  end if;
end $$;

update public.employees e
   set user_id = null
 where e.user_id is not null
   and not exists (select 1 from auth.users u where u.id = e.user_id);

-- ── 2. One login, one person ────────────────────────────────────────────────
do $$
declare v_dupes text;
begin
  select string_agg(format('%s (%s)', x.email, x.names), '; ') into v_dupes
    from (select coalesce(u.email, e.user_id::text) as email,
                 string_agg(e.full_name, ' + ' order by e.full_name) as names
            from public.employees e
            left join auth.users u on u.id = e.user_id
           where e.user_id is not null
           group by e.user_id, u.email
          having count(*) > 1) x;
  if v_dupes is not null then
    raise exception 'A login is linked to more than one person. Unlink the wrong one on Users → Link accounts, then paste this again: %', v_dupes;
  end if;
end $$;

create unique index if not exists employees_user_id_key
  on public.employees (user_id) where user_id is not null;

do $$
begin
  if not exists (
    select 1 from pg_constraint
     where conname = 'employees_user_id_fkey' and conrelid = 'public.employees'::regclass
  ) then
    alter table public.employees
      add constraint employees_user_id_fkey
      foreign key (user_id) references auth.users (id) on delete set null;
  end if;
end $$;

-- ── 3. One badge, one person, whatever the case ─────────────────────────────
do $$
declare v_dupes text;
begin
  select string_agg(format('%s (%s)', x.ref, x.names), '; ') into v_dupes
    from (select upper(btrim(employee_ref)) as ref,
                 string_agg(format('%s "%s"', full_name, employee_ref), ' + ' order by full_name) as names
            from public.employees
           where nullif(btrim(employee_ref), '') is not null
           group by upper(btrim(employee_ref))
          having count(*) > 1) x;
  if v_dupes is not null then
    raise exception 'Two records carry the same badge number in different spellings. Correct one of them, then paste this again: %', v_dupes;
  end if;
end $$;

create unique index if not exists employees_employee_ref_norm_key
  on public.employees (upper(btrim(employee_ref)))
  where nullif(btrim(employee_ref), '') is not null;

-- ── 4. Whoever may change a crew may record when ────────────────────────────
-- The same rule as "employees update by matrix", so the two writes `useChangeShift`
-- makes are allowed to the same people or refused to the same people. `esh_write`
-- (admin, everything) stays; DELETE stays admin-only, because the history is a record.
drop policy if exists "employee_shift_history insert by matrix" on public.employee_shift_history;
create policy "employee_shift_history insert by matrix"
  on public.employee_shift_history
  for insert to authenticated
  with check (public.has_action((select auth.uid()), 'workforce.manage', array['admin']::app_role[]));

drop policy if exists "employee_shift_history update by matrix" on public.employee_shift_history;
create policy "employee_shift_history update by matrix"
  on public.employee_shift_history
  for update to authenticated
  using (public.has_action((select auth.uid()), 'workforce.manage', array['admin']::app_role[]))
  with check (public.has_action((select auth.uid()), 'workforce.manage', array['admin']::app_role[]));
