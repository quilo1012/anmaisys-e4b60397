-- Anybody with an account could become anybody who had not got one yet.
--
-- The floor's registration ends on a screen headed "Who are you?" that lists every
-- active employee nobody has claimed — name and department — and offers a button
-- saying "That's me". `link_me_to_employee` then binds the login to whichever row was
-- picked, and its only identity guard is
--
--     and (email is null or lower(email) = lower(coalesce(v_email, '')))
--
-- which does not bite: almost no row in `employees` carries an email. That is the
-- whole reason the badge door exists. So the check passes vacuously, and the person
-- holding a freshly created account chooses who they are from a dropdown.
--
-- What makes it worse than it sounds is what comes after. A linked account answers
-- overtime as that person, and `self_signup_role` is 'operator', so an account is
-- active the moment it is made. The invite code is the only thing between a stranger
-- and the list.
--
-- THE FIX IS THE MECHANISM THAT ALREADY EXISTS. `employee-signin` has never had this
-- problem: it takes the number on the badge, finds the one row that carries it, and
-- links that. No list, nothing to browse, nothing to choose. This gives the same rule
-- to the other door, so both ends of registration answer identity the same way.

-- ── 1. Enumeration has to cost something ───────────────────────────────────
--
-- A badge number is short, and without this the dropdown is merely replaced by a
-- guessing game with the same prize. Five wrong answers and this login is done
-- guessing; the person goes to a supervisor, which is where somebody who genuinely
-- does not know their own number was always going to end up.
--
-- Keyed by the login, not by the badge: the attacker controls which numbers they try,
-- but making another account costs them another invite code.
create table if not exists public.identity_link_attempts (
  user_id    uuid primary key references auth.users(id) on delete cascade,
  fails      integer not null default 0,
  last_fail  timestamptz
);
alter table public.identity_link_attempts enable row level security;
-- No policy, deliberately: the counter is nobody's business but the function's, and a
-- security definer function reads it regardless of RLS. A caller who could read this
-- would learn how close somebody else is to being locked out.
revoke all on public.identity_link_attempts from anon, authenticated;

comment on table public.identity_link_attempts is
  'Failed attempts to claim an employee row by badge number, per login. Five and the '
  'login must go to a supervisor. Not readable by anybody; see link_me_by_employee_ref.';

-- ── 2. The badge says who you are ──────────────────────────────────────────
create or replace function public.link_me_by_employee_ref(p_ref text)
returns public.employees
language plpgsql security definer set search_path = public
as $$
declare
  v_ref   text := upper(trim(coalesce(p_ref, '')));
  v_fails   integer;
  v_matches integer;
  v_row   public.employees;
begin
  if v_ref = '' then
    raise exception 'Enter the number on your badge' using errcode = 'P0001';
  end if;

  -- A tablet is a place, not a person — the same refusal `link_me_to_employee` gained,
  -- repeated here because this is a second door into the same room.
  if exists (select 1 from public.operator_line_accounts o where o.user_id = auth.uid()) then
    raise exception 'This is a shared line tablet, not a personal account. Register on your own phone.'
      using errcode = 'P0001';
  end if;

  if public.my_employee_id() is not null then
    raise exception 'This login is already linked to an employee' using errcode = 'P0001';
  end if;

  -- Counted over a day, not for ever. Without the window this is a permanent lockout
  -- with no way out: the message sends people to a supervisor, and there is no screen
  -- where a supervisor can link an account or clear a counter. Telling somebody to do
  -- something nobody can do is worse than making them wait until tomorrow.
  select fails into v_fails
    from public.identity_link_attempts
   where user_id = auth.uid()
     and last_fail > now() - interval '24 hours';
  if coalesce(v_fails, 0) >= 5 then
    raise exception 'Too many wrong tries. Try again tomorrow, or ask your supervisor.'
      using errcode = 'P0001';
  end if;

  -- Resolved to ONE row before anything is written.
  --
  -- The first draft updated by the badge number directly, and `update ... returning *
  -- into v_row` does not complain when the WHERE matches more than one row: it writes
  -- to all of them and hands back the first. Two active unclaimed rows whose numbers
  -- differ only by case or a stray space — and normalising with upper(trim(...)) is
  -- exactly what makes those two equal here — would both have been linked to this one
  -- login. That is the failure this function exists to prevent, introduced by the
  -- function itself.
  --
  -- `into strict` raises on 0 or 2+ rather than guessing, and the count is taken
  -- before the write so nothing is half-done when it is wrong.
  select count(*) into v_matches
    from public.employees
   where upper(trim(employee_ref)) = v_ref and active and user_id is null;

  if v_matches = 1 then
    update public.employees
       set user_id = auth.uid()
     where upper(trim(employee_ref)) = v_ref
       and active
       and user_id is null
    returning * into v_row;
  elsif v_matches > 1 then
    -- Two people cannot both be you. Nobody is linked, and this needs a human.
    raise exception 'That badge number matches more than one record. Ask your supervisor.'
      using errcode = 'P0001';
  end if;

  if v_row.id is null then
    insert into public.identity_link_attempts (user_id, fails, last_fail)
    values (auth.uid(), 1, now())
    on conflict (user_id) do update
      set fails = public.identity_link_attempts.fails + 1, last_fail = now();
    -- One message for every miss. Saying "no such badge" and "already taken"
    -- separately would turn this into a tool for finding out who has registered.
    raise exception 'That badge number is not available. Check it, or ask your supervisor.'
      using errcode = 'P0001';
  end if;

  delete from public.identity_link_attempts where user_id = auth.uid();
  return v_row;
end;
$$;

revoke all on function public.link_me_by_employee_ref(text) from public;
grant execute on function public.link_me_by_employee_ref(text) to authenticated;

-- ── 3. Close the old door, not just the signpost to it ─────────────────────
--
-- Changing the screen is not enough while the functions behind it stay callable. Both
-- halves of the old flow have to go, and the first draft of this migration took only
-- the first — which would have left the hole open to anyone willing to call the RPC
-- directly instead of using the screen.
--
-- The list: the roster of unclaimed people, name and department, one `rpc()` away for
-- anybody with a login. Granted so a new login could find itself; nobody finds
-- themselves that way any more.
revoke execute on function public.overtime_unlinked_names() from authenticated;

-- The door itself: `link_me_to_employee` takes an employee **id** and links this login
-- to it, with no check that the id is yours. Without the list it is less convenient,
-- not less possible — `overtime_roster()` is granted to the same callers and carries
-- ids. Revoked, so the only way in is the badge.
--
-- `employee-signin` is unaffected: it runs with the service role, which grants do not
-- gate. Admins are unaffected for the same reason wherever they act through one.
revoke execute on function public.link_me_to_employee(uuid) from authenticated;

comment on function public.link_me_by_employee_ref(text) is
  'Link this login to the employee whose badge number this is, if that row is active '
  'and unclaimed. One identity, no list, five misses and the login is locked out of '
  'trying. Replaces picking a name from overtime_unlinked_names().';
