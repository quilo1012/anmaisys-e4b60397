-- An ask holds only the places it has.
--
-- WHAT WAS THERE. `overtime_requests.headcount` was a number on a card and nothing
-- else. Accepting is the supervisor's `decision = 'accepted'` on `overtime_responses`,
-- a plain update, and nothing — not the database, not the screen — counted it against
-- the headcount. Two supervisors on two screens, or one on a stale one, could accept a
-- fifth person onto an ask for four, and the board then carried five overtime rows for
-- four places. Lowering the headcount below the people already accepted did the same
-- from the other side: the card said "4 of 2 picked" and nobody was told.
--
-- And the floor could not see how many places were left: the read policy on
-- `overtime_responses` shows an employee only their own row, so their phone could
-- say "4 people needed" but never "1 place left".
--
-- WHAT THIS DOES.
--   1. `overtime_places_taken(ask)` — the one count: accepted and still coming. Somebody
--      accepted who then dropped out (an outcome other than 'attended') no longer holds
--      a place, which is the same rule `record_overtime_outcome` uses when it promotes
--      the reserve into the gap.
--   2. A trigger on `overtime_responses` refuses an accept that would go past the
--      headcount. It locks the ask row first, so two accepts racing for the last place
--      are served one after the other and the second is refused. It applies to everyone,
--      the supervisor included: the way to take a sixth person is to raise the headcount,
--      which the card shows, not to overfill it, which nothing showed.
--   3. A trigger on `overtime_requests` refuses lowering the headcount below the people
--      already accepted. Nobody's place is taken away by an edit; the supervisor moves
--      someone to reserve first, and then they are the one who tells them.
--   4. `overtime_places(ids[])` — taken and headcount per ask, for any signed-in person.
--      Counts only, never names: an employee learns "1 place left", not who has the rest.
--
-- No column, no change to who may read or write what.

create or replace function public.overtime_places_taken(p_request_id uuid)
returns integer
language sql stable security definer set search_path = public
as $$
  select count(*)::int
    from public.overtime_responses r
   where r.request_id = p_request_id
     and r.decision = 'accepted'
     and not exists (select 1 from public.overtime_outcomes o
                      where o.response_id = r.id and o.outcome <> 'attended');
$$;

revoke all on function public.overtime_places_taken(uuid) from public, anon;
grant execute on function public.overtime_places_taken(uuid) to authenticated;

-- 2. An accept past the headcount is refused.
create or replace function public.overtime_response_capacity_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_headcount integer;
  v_taken     integer;
begin
  if new.decision is distinct from 'accepted' then return new; end if;
  if tg_op = 'UPDATE' and old.decision = 'accepted' and old.request_id = new.request_id then
    return new;
  end if;

  -- One accept at a time per ask: the second waits here for the first to commit.
  select headcount into v_headcount
    from public.overtime_requests where id = new.request_id for update;
  if v_headcount is null then return new; end if;  -- the FK reports a missing ask

  select count(*)::int into v_taken
    from public.overtime_responses r
   where r.request_id = new.request_id
     and r.decision = 'accepted'
     and r.id <> new.id
     and not exists (select 1 from public.overtime_outcomes o
                      where o.response_id = r.id and o.outcome <> 'attended');

  if v_taken >= v_headcount then
    raise exception 'All % places on this overtime are filled. Put them on reserve, or raise the number of people needed first.',
      v_headcount using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.overtime_response_capacity_guard() from public, anon, authenticated;

drop trigger if exists overtime_response_capacity_guard_t on public.overtime_responses;
create trigger overtime_response_capacity_guard_t
  before insert or update of decision, request_id on public.overtime_responses
  for each row execute function public.overtime_response_capacity_guard();

-- 3. The headcount cannot drop below the people already in.
create or replace function public.overtime_request_headcount_guard()
returns trigger
language plpgsql security definer set search_path = public
as $$
declare
  v_taken integer;
begin
  if new.headcount >= old.headcount then return new; end if;
  v_taken := public.overtime_places_taken(new.id);
  if new.headcount < v_taken then
    raise exception '% people are already accepted on this overtime, so it can''t need fewer than %. Move someone to reserve first.',
      v_taken, v_taken using errcode = 'P0001';
  end if;
  return new;
end;
$$;

revoke all on function public.overtime_request_headcount_guard() from public, anon, authenticated;

drop trigger if exists overtime_request_headcount_guard_t on public.overtime_requests;
create trigger overtime_request_headcount_guard_t
  before update of headcount on public.overtime_requests
  for each row execute function public.overtime_request_headcount_guard();

-- 4. Places per ask, for the floor.
create or replace function public.overtime_places(p_request_ids uuid[])
returns table (request_id uuid, taken integer, headcount integer)
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = '42501';
  end if;
  if coalesce(array_length(p_request_ids, 1), 0) > 200 then
    raise exception 'At most 200 asks a call' using errcode = 'P0001';
  end if;
  return query
    select q.id, public.overtime_places_taken(q.id), q.headcount
      from public.overtime_requests q
     where q.id = any(p_request_ids);
end;
$$;

revoke all on function public.overtime_places(uuid[]) from public, anon;
grant execute on function public.overtime_places(uuid[]) to authenticated;
