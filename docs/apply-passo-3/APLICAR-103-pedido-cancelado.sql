-- ================================================================
-- BLOCO 103
-- 20261019090000_a_cancelled_ask_is_nobodys_fault.sql
-- ================================================================
--
-- UM PEDIDO CANCELADO NAO E CULPA DE NINGUEM: reabrir um pedido cancelado devolve
-- os aceites ao board; a fiabilidade deixa de contar pedidos cancelados como
-- "aceite e nao veio"; sai a policy que deixava escrever uma resposta sem passar
-- pelo answer_overtime. Depois do 102. Pode colar-se duas vezes.
-- Three overtime defects found in the 18/10 stabilisation pass, each read against
-- production first. Idempotent; nothing here deletes or rewrites a stored answer.
--
-- ONE. "overtime_responses_own" let an employee INSERT their own undecided answer
-- straight through PostgREST, past the department/crew audience and the no-show block
-- that only answer_overtime checks. Since block 102 a "yes" from the person's own
-- login is decided by the BEFORE trigger, so WITH CHECK (decision is null) now refuses
-- it — tested locally, with and without that trigger — and what is left is a "no"
-- written around the RPC. The app never used the policy: employees answer through
-- answer_overtime (security definer), supervisors through "overtime_responses_decide".
-- Dropped, so the RPC is the only way an employee writes an answer.
--
-- TWO. Reopening a cancelled ask left its accepted people off the board. Cancelling
-- deletes the ask's daily_allocations rows (overtime_request_to_board); nothing put
-- them back on cancelled -> open/closed, while the answers still said accepted and
-- the card showed them as picked. The board rows come back through the same
-- overtime_board_apply the decision uses, which already refuses a cancelled ask and
-- never overwrites a row the planner made.
--
-- THREE. overtime_reliability's 60-day "x of y worked" counted every accepted answer,
-- including those on asks the supervisor cancelled — read as accepted and not
-- attended, lowering the ratio and the order sortCandidates offers people in. The
-- body is 20261012160000's unchanged but for the cancelled filter in ot_60. Same
-- signature and columns, so create or replace keeps the grants.

-- ── ONE ─────────────────────────────────────────────────────────────────────
drop policy if exists "overtime_responses_own" on public.overtime_responses;

-- ── TWO ─────────────────────────────────────────────────────────────────────
create or replace function public.overtime_request_to_board()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  r record;
begin
  if new.status = 'cancelled' and old.status is distinct from 'cancelled' then
    delete from public.daily_allocations where overtime_request_id = new.id;
  elsif old.status = 'cancelled' and new.status is distinct from 'cancelled' then
    for r in select employee_id from public.overtime_responses
              where request_id = new.id and decision = 'accepted'
    loop
      perform public.overtime_board_apply(new.id, r.employee_id, true);
    end loop;
  end if;
  return new;
end;
$$;

-- ── THREE ───────────────────────────────────────────────────────────────────
create or replace function public.overtime_reliability(p_month date default current_date)
returns table (
  employee_id        uuid,
  sick_this_month    integer,
  absent_this_month  integer,
  ot_accepted_60d    integer,
  ot_attended_60d    integer,
  blocked_until      date
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
     where r.decision = 'accepted' and q.status <> 'cancelled'
       and q.on_date >= b.d60 and q.on_date <= current_date
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
         coalesce(s.attended, 0),
         (select blocked_until from public.overtime_block_for(i.employee_id))
    from ids i
    left join board    b on b.employee_id = i.employee_id
    left join clocks   c on c.employee_id = i.employee_id
    left join ot_month m on m.employee_id = i.employee_id
    left join ot_60    s on s.employee_id = i.employee_id
   -- Everybody else gets no rows: the same answer as "nobody was off this month",
   -- which is what an empty column beside a name already means on the manager's panel.
   where public.can_manage_overtime(auth.uid());
$$;

revoke all on function public.overtime_reliability(date) from public;
grant execute on function public.overtime_reliability(date) to authenticated;
