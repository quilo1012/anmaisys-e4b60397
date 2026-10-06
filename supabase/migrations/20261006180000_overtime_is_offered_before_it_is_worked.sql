-- 10 · Overtime is offered before it is worked.
--
-- `overtime_entries` records hours AFTER the fact, copied from the payroll sheet, and
-- a trigger refuses hand-written rows. Nothing in the schema says what happened
-- BEFORE: who was asked, who said yes, who the supervisor picked, who then failed to
-- turn up. That is the part the floor actually fights over, and it lived in WhatsApp.
--
-- Three tables, one per moment:
--   overtime_requests   the supervisor's ask — "Saturday 14:00–22:00, I need 4"
--   overtime_responses  one row per person per ask — yes/no, then accepted/reserve/declined
--   overtime_outcomes   what the person did on the day — turned up, sick, no-show
--
-- Hours are NOT recorded here. When the day is over, the hours arrive from TimeMoto
-- as they do for every other day; this module only knows who was supposed to be in.
--
-- Idempotent throughout. Safe to run twice.

-- ---------------------------------------------------------------------------
-- 1. The ask
-- ---------------------------------------------------------------------------
create table if not exists public.overtime_requests (
  id            uuid primary key default gen_random_uuid(),
  on_date       date not null,
  starts_at     time not null,
  ends_at       time not null,
  -- How many people the supervisor needs. Not how many will say yes.
  headcount     integer not null check (headcount > 0),
  -- Who sees it. Null = every active employee.
  department    text,
  shift_group   text,
  note          text,
  status        text not null default 'open' check (status in ('open', 'closed', 'cancelled')),
  created_by    uuid not null references auth.users(id),
  created_at    timestamptz not null default now(),
  closed_at     timestamptz,
  constraint overtime_requests_ends_after_starts check (ends_at <> starts_at)
);

create index if not exists overtime_requests_on_date_idx on public.overtime_requests (on_date desc);

-- ---------------------------------------------------------------------------
-- 2. The answer, then the decision
-- ---------------------------------------------------------------------------
create table if not exists public.overtime_responses (
  id            uuid primary key default gen_random_uuid(),
  request_id    uuid not null references public.overtime_requests(id) on delete cascade,
  employee_id   uuid not null references public.employees(id) on delete cascade,
  -- What the person said. 'no' is kept, so the supervisor knows who has seen it.
  answer        text not null check (answer in ('yes', 'no')),
  -- What the supervisor did with a 'yes'. Null until decided.
  decision      text check (decision in ('accepted', 'reserve', 'declined')),
  answered_at   timestamptz not null default now(),
  decided_at    timestamptz,
  decided_by    uuid references auth.users(id),
  -- One answer per person per ask. Changing your mind is an UPDATE, not a second row.
  constraint overtime_responses_one_per_person unique (request_id, employee_id)
);

create index if not exists overtime_responses_request_idx on public.overtime_responses (request_id);
create index if not exists overtime_responses_employee_idx on public.overtime_responses (employee_id);

-- ---------------------------------------------------------------------------
-- 3. What happened on the day
-- ---------------------------------------------------------------------------
create table if not exists public.overtime_outcomes (
  response_id   uuid primary key references public.overtime_responses(id) on delete cascade,
  outcome       text not null check (outcome in (
                  'attended', 'no_show', 'called_sick', 'cancelled_in_time', 'cancelled_late')),
  note          text,
  recorded_by   uuid not null references auth.users(id),
  recorded_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- 4. Who may do what
-- ---------------------------------------------------------------------------
alter table public.overtime_requests  enable row level security;
alter table public.overtime_responses enable row level security;
alter table public.overtime_outcomes  enable row level security;

-- The roles that run overtime. Mirrors `overtime.manage` in src/lib/permissions.ts;
-- the two lists must agree or the screen promises what the database refuses. The
-- `supervisor` enum value is retired and deliberately absent: the people who run the
-- floor sign in as manager or production_office_admin.
create or replace function public.can_manage_overtime(uid uuid)
returns boolean
language sql stable security definer set search_path = public
as $$
  -- Through has_action, so an override saved on the Permissions Matrix screen
  -- counts here too. The array is the baseline: the same three the matrix carries.
  select public.has_action(uid, 'overtime.manage',
           array['admin','manager','production_office_admin']::app_role[]);
$$;

-- The employee row that belongs to the signed-in person, if any.
create or replace function public.my_employee_id()
returns uuid
language sql stable security definer set search_path = public
as $$
  select id from public.employees where user_id = auth.uid() and active limit 1;
$$;

drop policy if exists "overtime_requests_read"   on public.overtime_requests;
drop policy if exists "overtime_requests_manage" on public.overtime_requests;
create policy "overtime_requests_read" on public.overtime_requests
  for select to authenticated using (true);
create policy "overtime_requests_manage" on public.overtime_requests
  for all to authenticated
  using (public.can_manage_overtime(auth.uid()))
  with check (public.can_manage_overtime(auth.uid()));

drop policy if exists "overtime_responses_read"     on public.overtime_responses;
drop policy if exists "overtime_responses_own"      on public.overtime_responses;
drop policy if exists "overtime_responses_decide"   on public.overtime_responses;
-- Everybody signed in can see the list. The floor already knows who put their hand
-- up; hiding it here would only move the argument back to WhatsApp.
create policy "overtime_responses_read" on public.overtime_responses
  for select to authenticated using (true);
-- A person writes only their own answer, and only while the ask is open.
create policy "overtime_responses_own" on public.overtime_responses
  for insert to authenticated
  with check (
    employee_id = public.my_employee_id()
    and exists (select 1 from public.overtime_requests r
                 where r.id = request_id and r.status = 'open')
  );
-- Managers may change anything: the decision, or an answer on behalf of somebody
-- who has no login and said yes at the desk.
create policy "overtime_responses_decide" on public.overtime_responses
  for all to authenticated
  using (public.can_manage_overtime(auth.uid()))
  with check (public.can_manage_overtime(auth.uid()));

drop policy if exists "overtime_outcomes_read"   on public.overtime_outcomes;
drop policy if exists "overtime_outcomes_manage" on public.overtime_outcomes;
create policy "overtime_outcomes_read" on public.overtime_outcomes
  for select to authenticated using (true);
create policy "overtime_outcomes_manage" on public.overtime_outcomes
  for all to authenticated
  using (public.can_manage_overtime(auth.uid()))
  with check (public.can_manage_overtime(auth.uid()));

-- ---------------------------------------------------------------------------
-- 5. Answering — the one write an employee makes
-- ---------------------------------------------------------------------------
-- An UPSERT behind a function rather than a raw upsert from the screen, so the rules
-- live in one place: you can change 'no' to 'yes' while the ask is open; you cannot
-- change anything once the supervisor has decided on you.
create or replace function public.answer_overtime(p_request_id uuid, p_answer text)
returns public.overtime_responses
language plpgsql security definer set search_path = public
as $$
declare
  v_emp uuid := public.my_employee_id();
  v_row public.overtime_responses;
begin
  if v_emp is null then
    raise exception 'No employee record is linked to this login' using errcode = 'P0001';
  end if;
  if p_answer not in ('yes', 'no') then
    raise exception 'Answer must be yes or no' using errcode = 'P0001';
  end if;
  if not exists (select 1 from public.overtime_requests where id = p_request_id and status = 'open') then
    raise exception 'This overtime is no longer open' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.overtime_responses
              where request_id = p_request_id and employee_id = v_emp and decision is not null) then
    raise exception 'The supervisor has already decided on your answer' using errcode = 'P0001';
  end if;

  insert into public.overtime_responses (request_id, employee_id, answer)
  values (p_request_id, v_emp, p_answer)
  on conflict (request_id, employee_id)
  do update set answer = excluded.answer, answered_at = now()
  returning * into v_row;
  return v_row;
end;
$$;

-- ---------------------------------------------------------------------------
-- 6. Linking a login to an employee row
-- ---------------------------------------------------------------------------
-- Employees mostly have no login: `employees.user_id` is null for nearly everybody.
-- The sign-up page (invite code) creates the login; this links it to the person, once,
-- and only to a row nobody else holds. If the row has an email, it has to match.
create or replace function public.link_me_to_employee(p_employee_id uuid)
returns public.employees
language plpgsql security definer set search_path = public
as $$
declare
  v_email text;
  v_row   public.employees;
begin
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

-- ---------------------------------------------------------------------------
-- 6b. Names, without the roster
-- ---------------------------------------------------------------------------
-- `employees` is readable only behind `workforce.view` (admin). That is right for a
-- table with emails, reporting lines and a notes field — and it means neither the
-- manager posting an ask nor the operator answering it can read it. These three
-- functions hand out only what the screens need: an id, a name, a department and a
-- shift. No email, no notes, no manager. A printed rota on the wall says as much.

-- Active people, for the manager choosing. Gated on the same permission as the screen.
create or replace function public.overtime_roster()
returns table (id uuid, full_name text, department text, shift_group text)
language sql stable security definer set search_path = public
as $$
  select e.id, e.full_name, e.department, e.shift_group
    from public.employees e
   where e.active
     and public.can_manage_overtime(auth.uid())
   order by e.full_name;
$$;

-- The caller's own row. Null when the login is not linked to anybody yet.
create or replace function public.my_overtime_identity()
returns table (id uuid, full_name text, department text, shift_group text)
language sql stable security definer set search_path = public
as $$
  select e.id, e.full_name, e.department, e.shift_group
    from public.employees e
   where e.user_id = auth.uid() and e.active
   limit 1;
$$;

-- Names nobody has claimed yet, for the first visit. Any login may read this list:
-- it is how a new login finds itself, and it holds no more than a name and a department.
create or replace function public.overtime_unlinked_names()
returns table (id uuid, full_name text, department text, shift_group text)
language sql stable security definer set search_path = public
as $$
  select e.id, e.full_name, e.department, e.shift_group
    from public.employees e
   where e.active and e.user_id is null
   order by e.full_name;
$$;

-- ---------------------------------------------------------------------------
-- 7. The number beside the name
-- ---------------------------------------------------------------------------
-- How many times, this calendar month, each person did not turn up — from the three
-- places the factory records it: the headcount board (`employee_attendance`), the
-- TimeMoto import (`attendance_days`) and overtime they had accepted (`overtime_outcomes`).
-- Booked holiday is not an absence and is not counted. The 60-day column is overtime
-- only: accepted shifts, and how many of those were actually worked.
create or replace function public.overtime_reliability(p_month date default current_date)
returns table (
  employee_id        uuid,
  sick_this_month    integer,
  absent_this_month  integer,
  ot_accepted_60d    integer,
  ot_attended_60d    integer
)
language sql stable security definer set search_path = public
as $$
  with bounds as (
    select date_trunc('month', p_month)::date                       as m_from,
           (date_trunc('month', p_month) + interval '1 month')::date as m_to,
           (current_date - 60)                                        as d60
  ),
  board as (
    select a.employee_id,
           count(*) filter (where a.status = 'sick')                       as sick,
           count(*) filter (where a.status in ('unpaid', 'absent', 'awol')) as absent
      from public.employee_attendance a, bounds b
     where a.on_date >= b.m_from and a.on_date < b.m_to
     group by a.employee_id
  ),
  clocks as (
    select d.employee_id,
           count(*) filter (where d.absence_name ~* 'sick')                                 as sick,
           count(*) filter (where d.absence_name is not null
                              and d.absence_name !~* 'sick'
                              and d.absence_name !~* 'holiday|vacation|annual')               as absent
      from public.attendance_days d, bounds b
     where d.on_date >= b.m_from and d.on_date < b.m_to
     group by d.employee_id
  ),
  ot_month as (
    select r.employee_id,
           count(*) filter (where o.outcome = 'called_sick')                          as sick,
           count(*) filter (where o.outcome in ('no_show', 'cancelled_late'))          as absent
      from public.overtime_outcomes o
      join public.overtime_responses r on r.id = o.response_id
      join public.overtime_requests q on q.id = r.request_id, bounds b
     where q.on_date >= b.m_from and q.on_date < b.m_to
     group by r.employee_id
  ),
  ot_60 as (
    select r.employee_id,
           count(*)                                            as accepted,
           count(*) filter (where o.outcome = 'attended')      as attended
      from public.overtime_responses r
      join public.overtime_requests q on q.id = r.request_id
      left join public.overtime_outcomes o on o.response_id = r.id, bounds b
     where r.decision = 'accepted' and q.on_date >= b.d60 and q.on_date <= current_date
     group by r.employee_id
  ),
  ids as (
    select employee_id from board
    union select employee_id from clocks
    union select employee_id from ot_month
    union select employee_id from ot_60
  )
  select i.employee_id,
         coalesce(b.sick, 0) + coalesce(c.sick, 0) + coalesce(m.sick, 0),
         coalesce(b.absent, 0) + coalesce(c.absent, 0) + coalesce(m.absent, 0),
         coalesce(s.accepted, 0),
         coalesce(s.attended, 0)
    from ids i
    left join board    b on b.employee_id = i.employee_id
    left join clocks   c on c.employee_id = i.employee_id
    left join ot_month m on m.employee_id = i.employee_id
    left join ot_60    s on s.employee_id = i.employee_id;
$$;

grant execute on function public.answer_overtime(uuid, text)       to authenticated;
grant execute on function public.link_me_to_employee(uuid)         to authenticated;
grant execute on function public.overtime_reliability(date)        to authenticated;
grant execute on function public.can_manage_overtime(uuid)         to authenticated;
grant execute on function public.my_employee_id()                  to authenticated;
grant execute on function public.overtime_roster()                 to authenticated;
grant execute on function public.my_overtime_identity()            to authenticated;
grant execute on function public.overtime_unlinked_names()         to authenticated;
