-- The QR people actually scan is the one that could not carry the code.
--
-- `signupQrPayload` takes an invite code and puts it in the link, so the registration
-- form opens with the box already filled. Two screens draw that QR and only one passes
-- a code: the admin's card, which is already holding it on screen. The login screen
-- passes none, because `signup_config` is `REVOKE ALL ... FROM anon` with an
-- admin-only policy and a page served to anybody cannot read the code.
--
-- That is the right rule for the login screen and it must not change. The code is the
-- only gate on self-registration, `self_signup_role` is 'operator' — a new account is
-- an active operator immediately — and `overtime_unlinked_names()` hands any logged-in
-- caller the list of unclaimed names. Publishing the code on a public page would let a
-- stranger register and then pick a real employee out of that list.
--
-- But the screen the floor actually reads is the tablet's, and a tablet is inside the
-- building and signed in. This returns the code to that session and to no other: not
-- to anon, not to an ordinary staff login, not to a tablet when sign-up is switched
-- off or the code has expired. Everywhere else it returns null and the QR carries
-- nothing, exactly as today.
--
-- Same shape as `check_invite_code`, which has answered yes/no about this column to
-- anon since July: security definer over a table nobody else may read, with the whole
-- decision inside it.

create or replace function public.signup_invite_for_tablet()
returns text
language sql stable security definer set search_path = public
as $$
  select c.invite_code
    from public.signup_config c
   where c.id
     and c.enabled
     and c.invite_code is not null
     -- The same expiry `check_invite_code` enforces. A code this hands out that the
     -- validator would then reject is a QR that walks somebody into a refusal.
     and (c.invite_expires_at is null or now() < c.invite_expires_at)
     -- The whole guard: this caller is a shared line tablet.
     and exists (
       select 1 from public.operator_line_accounts o
        where o.user_id = auth.uid()
     );
$$;

revoke all on function public.signup_invite_for_tablet() from public;
-- `authenticated` only, and never `anon`: the guard above is what narrows it to
-- tablets, and an anon caller has no `auth.uid()` to match in the first place.
grant execute on function public.signup_invite_for_tablet() to authenticated;

comment on function public.signup_invite_for_tablet() is
  'The invite code, but only to a signed-in line tablet and only while sign-up is open '
  'and the code unexpired. Null for everybody else. Exists so the tablet QR can open '
  'registration with the code filled in without the code reaching a public page.';
