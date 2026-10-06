-- An ask tells the people it is for.
--
-- Posting an overtime ask wrote a row and nothing else. Whoever did not open the app
-- that day never knew, and "first to answer" quietly became "first to look". The push
-- goes out from the manager's screen through `send-push`, which already writes the
-- in-app bell and web-pushes to anyone who turned it on. What the screen lacked was
-- the list of logins to send to: `employees` is admin-only, so a manager could not
-- read user_id off it.
--
-- This hands out exactly that — user ids, nothing else — and only to somebody who can
-- manage overtime. With no employee list it returns the ask's audience (department and
-- shift as the ask narrows them, every linked employee otherwise). With a list it
-- returns those people's logins, for "you're in" and "you're on reserve".
--
-- Idempotent.

create or replace function public.overtime_push_targets(
  p_request_id  uuid,
  p_employee_ids uuid[] default null
)
returns setof uuid
language sql stable security definer set search_path = public
as $$
  select distinct e.user_id
    from public.employees e
    join public.overtime_requests q on q.id = p_request_id
   where public.can_manage_overtime(auth.uid())
     and e.active
     and e.user_id is not null
     and (
       (p_employee_ids is null
        and (q.department  is null or q.department  = e.department)
        and (q.shift_group is null or q.shift_group = e.shift_group))
       or e.id = any (coalesce(p_employee_ids, '{}'::uuid[]))
     );
$$;

grant execute on function public.overtime_push_targets(uuid, uuid[]) to authenticated;
