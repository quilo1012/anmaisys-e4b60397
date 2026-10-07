-- An invite that never expires is a door left open.
--
-- The invite code is one string, pasted into a WhatsApp group, and it stays valid until
-- an admin remembers to change it. Nobody remembers. The overtime module is about to
-- send that link to 211 people, which is 211 phones it can be forwarded from.
--
-- One column: when the code stops working. Null keeps today's behaviour, so nothing
-- changes until an admin sets a date; the settings card proposes seven days whenever a
-- new code is generated. check_invite_code is the only reader and gains the one clause.
--
-- Idempotent.

alter table public.signup_config
  add column if not exists invite_expires_at timestamptz;

create or replace function public.check_invite_code(code text)
returns boolean
language sql security definer set search_path = public
as $$
  select coalesce(bool_or(
           enabled
           and invite_code is not null
           and invite_code = code
           and (invite_expires_at is null or now() < invite_expires_at)
         ), false)
    from public.signup_config
   where id;
$$;

revoke all on function public.check_invite_code(text) from public;
grant execute on function public.check_invite_code(text) to anon, authenticated;
