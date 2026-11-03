-- APLICAR 142 — o registo automático exige o código de convite, verificado na base.
--
-- PT: Colar no SQL editor do PMSYSTEM (More → Cloud → SQL editor), o ficheiro inteiro.
-- É o BLOCO 142 do APPLY-ALL-IN-ORDER.sql, byte a byte. Não depende do 141.
--
-- Porquê (auditoria 02/11, SEC-002): o código de convite só era verificado no browser. Um
-- POST directo a /auth/v1/signup com self_signup:"true" e sem código criava uma conta
-- activa com o papel automático (self_signup_role). Hoje só o email que nunca chega o
-- travava; ligar o Auto-confirm abria-o.
--
-- O que muda: só a função handle_new_user. Um registo próprio só recebe o papel automático
-- se o código que a página envia (invite_code) for aceite por check_invite_code nesse
-- momento; senão fica inactivo e sem papel, e o admin é avisado como na fila de sempre.
-- O primeiro utilizador, as contas criadas pelo admin e os dados existentes não mudam.
-- Pode colar-se duas vezes.
--
-- ANTES de colar: a página de registo nova (PR com este bloco) tem de estar publicada —
-- é ela que envia o invite_code. Colado antes, quem se regista honestamente fica na fila
-- até ser aprovado.
--
-- Depois de colar: correr VERIFY-142-registo-com-codigo.sql (só lê) e
-- supabase/tests/a_self_signup_needs_its_invite_code_test.sql (desfaz tudo no fim).
--
-- EN: Paste the whole file; it is BLOCO 142. It replaces handle_new_user only, so a self
-- sign-up gets the automatic role only with an invite code the database accepts. Publish
-- the sign-up page that sends `invite_code` first. Then run VERIFY-142.

-- ================================================================
-- BLOCO 142
-- 20261103100000_a_self_signup_carries_its_invite_code.sql
-- ================================================================
-- A self sign-up carries its invite code, and the database checks it.
--
-- WHAT WAS WRONG. Audit 2026-11-02, SEC-002. The invite code was checked only in the
-- browser (SignUp.tsx calls check_invite_code, then auth.signUp). handle_new_user decided
-- from the metadata the browser sends: `self_signup: "true"` and a self_signup_role set
-- on signup_config, and the account was born active with that role. Anyone could POST
-- /auth/v1/signup with that metadata and no code at all. Today only the email that never
-- arrives stops them; turning Auto-confirm on would have opened it.
--
-- WHAT CHANGES. The sign-up page now sends the code it checked as `invite_code` in the
-- same metadata. A self sign-up gets the automatic role only when check_invite_code
-- accepts that code at the moment the account is made. Otherwise it lands as the queue
-- always did — inactive, no role, an admin told "pending approval".
--
-- WHAT DOES NOT CHANGE. The first account is still the admin. Accounts made by an admin
-- (create-user, create-operator-account, tablet-signin: service role, no self_signup)
-- keep the path they had. With self_signup_role null nothing changes at all.
--
-- ORDER. The page that sends `invite_code` must be live before this is pasted, or honest
-- sign-ups wait in the queue for an admin until it is. Idempotent.

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
  code_ok boolean := public.check_invite_code(coalesce(new.raw_user_meta_data->>'invite_code', ''));
  granted public.app_role;
  display_name text := coalesce(new.raw_user_meta_data->>'name', new.email);
begin
  select not exists (select 1 from public.profiles for update) into is_first_user;
  granted := case when is_self and code_ok then auto_role end;

  insert into public.profiles (id, name, email, active)
  values (
    new.id,
    display_name,
    new.email,
    case when is_self and not is_first_user and granted is null then false else true end
  );

  if is_first_user then
    insert into public.user_roles (user_id, role) values (new.id, 'admin');
  elsif granted is not null then
    insert into public.user_roles (user_id, role) values (new.id, granted)
    on conflict do nothing;
  end if;

  if is_self and not is_first_user then
    if granted is null then
      insert into public.notifications (user_id, title, body, priority, action_url)
      select ur.user_id,
             'New account pending approval',
             display_name || case when auto_role is not null and not code_ok
                                  then ' registered without a valid invite code and needs a role.'
                                  else ' registered and needs a role.' end,
             'high',
             '/users/manage'
        from public.user_roles ur where ur.role = 'admin';
    else
      insert into public.notifications (user_id, title, body, priority, action_url)
      select ur.user_id,
             'New ' || granted::text || ' account',
             display_name || ' registered with the invite link and is active.',
             'low',
             '/users/manage'
        from public.user_roles ur where ur.role = 'admin';
    end if;
  end if;

  return new;
end;
$function$;
