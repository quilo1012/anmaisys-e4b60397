-- A floor login does not wait in a queue.
--
-- Self sign-ups land pending — no role, inactive — and an admin activates each one by
-- hand. Right for a login that will see production figures; wrong for the 211 people
-- the overtime link is about to reach, who need to do exactly one thing: say yes or no.
-- An operator login can see its own asks and its own answers, and nothing an admin
-- would mind it seeing. Two hundred approvals would mean two hundred people who could
-- not answer this week's overtime.
--
-- One setting on signup_config: the role a self sign-up starts with. Null (today's
-- value, and the default) keeps the queue. 'operator' makes the account active with
-- that role on creation. Admins still hear about it — a quieter notification, with the
-- name and the role — and can deactivate as before. handle_new_user is the only reader.
--
-- Idempotent.

alter table public.signup_config
  add column if not exists self_signup_role public.app_role;

-- What the sign-up page tells the person to expect. Anonymous, because they are not
-- signed in yet; returns the role name or null, nothing else.
create or replace function public.self_signup_role()
returns text
language sql stable security definer set search_path = public
as $$
  select self_signup_role::text from public.signup_config where id;
$$;
revoke all on function public.self_signup_role() from public;
grant execute on function public.self_signup_role() to anon, authenticated;

create or replace function public.handle_new_user()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'public'
as $function$
declare
  is_first_user boolean;
  is_self boolean := (new.raw_user_meta_data->>'self_signup' = 'true');
  auto_role public.app_role := (select self_signup_role from public.signup_config where id);
  display_name text := coalesce(new.raw_user_meta_data->>'name', new.email);
begin
  select not exists (select 1 from public.profiles for update) into is_first_user;

  insert into public.profiles (id, name, email, active)
  values (
    new.id,
    display_name,
    new.email,
    case when is_self and not is_first_user and auto_role is null then false else true end
  );

  if is_first_user then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  elsif is_self and auto_role is not null then
    insert into public.user_roles (user_id, role) values (new.id, auto_role)
    on conflict do nothing;
  end if;

  if is_self and not is_first_user then
    if auto_role is null then
      insert into public.notifications (user_id, title, body, priority, action_url)
      select ur.user_id,
             'New account pending approval',
             display_name || ' registered and needs a role.',
             'high',
             '/users/manage'
        from public.user_roles ur where ur.role = 'admin';
    else
      insert into public.notifications (user_id, title, body, priority, action_url)
      select ur.user_id,
             'New ' || auto_role::text || ' account',
             display_name || ' registered with the invite link and is active.',
             'low',
             '/users/manage'
        from public.user_roles ur where ur.role = 'admin';
    end if;
  end if;

  return new;
end;
$function$;
