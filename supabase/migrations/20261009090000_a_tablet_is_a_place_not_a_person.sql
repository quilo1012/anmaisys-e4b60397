-- A shared tablet made itself into one employee, and everyone else into him.
--
-- `tablet-signin` takes an `account_id`: a whole line signs in as the same auth user,
-- because a tablet is a place. Overtime asks who you are through
-- `my_overtime_identity()`, which reads `employees.user_id = auth.uid()`. The two met
-- on the My Overtime screen, which offers "Pick your name once" to any login with no
-- employee attached — and `link_me_to_employee` had nothing to say about it.
--
-- The first person to use Line 1's tablet picked themselves, and the shared account
-- became Eduardo Luz. From then on the day crew's tablet read "Signed in as Eduardo
-- Luz, Night crew", showing a Night ask already answered and already accepted, and the
-- second person to try got "This login is already linked to an employee". That is why
-- the floor reported that only one employee could ever confirm overtime: he was not
-- the only one who answered, he was the only one who existed.
--
-- The screen has stopped asking (see `isSharedTabletSession`), but a screen declining
-- to offer a mistake is not the same as the mistake being impossible. This is where it
-- becomes impossible.

-- ── 1. Undo the binding that is already there ──────────────────────────────
--
-- `user_id = null` and nothing else: the employee row, the person, their history and
-- every answer they have given stay exactly as they are. What is removed is the claim
-- that a tablet in a corridor is them. Eduardo signs in on his own phone afterwards
-- and links himself properly, like everybody else.
--
-- Scoped by the account table rather than by a name, so it also catches any other line
-- this has quietly happened to.
update public.employees e
   set user_id = null
 where e.user_id in (select o.user_id from public.operator_line_accounts o);

-- ── 2. Refuse to do it again ───────────────────────────────────────────────
--
-- Carried verbatim from 20261006180000 with one clause added. `create or replace`
-- rewrites the whole body, so every existing guard — already linked, already taken,
-- email must match — is reproduced here on purpose rather than assumed to survive.
create or replace function public.link_me_to_employee(p_employee_id uuid)
returns public.employees
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_row   public.employees;
begin
  -- The new one. A shared line account is a place and can never become a person; the
  -- message says where to go instead, because somebody is standing at the tablet
  -- reading it and "not allowed" would leave them there.
  if exists (select 1 from public.operator_line_accounts o where o.user_id = auth.uid()) then
    raise exception 'This is a shared line tablet, not a personal account. Register on your own phone.'
      using errcode = 'P0001';
  end if;

  if public.my_employee_id() is not null then
    raise exception 'This login is already linked to an employee' using errcode = 'P0001';
  end if;
  select email into v_email from auth.users where id = auth.uid();

  update public.employees
     set user_id = auth.uid()
   where id = p_employee_id
     and active
     and user_id is null
     and (email is null or lower(email) = lower(coalesce(v_email, '')))
  returning * into v_row;

  if v_row.id is null then
    raise exception 'That employee cannot be linked to this login' using errcode = 'P0001';
  end if;
  return v_row;
end;
$$;

grant execute on function public.link_me_to_employee(uuid) to authenticated;
