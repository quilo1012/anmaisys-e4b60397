-- APLICAR — tudo o que faltava em producao a 12/10/2026, num so ficheiro.
--
-- Sondado a 12/10/2026 com a chave publicavel, so leitura (nada foi executado):
--   em falta: BLOCO 79 (signup_invite_for_tablet), 81 (link_me_by_employee_ref),
--             82 (my_employee_id ainda responde sem login: o incidente de 11/10),
--             86 (signup_invite_code), 87 (overtime_responses.answered_for_date),
--             88 (link_me_by_email), 89 (employees.timemoto_user_id),
--             90 (my_attendance), 91 (login_link_candidates)
--   ja aplicados: 83-84 (o papel employee existe), 85 (admin_update_auth_email)
--   78 e 80 nao se conseguem sondar de fora; vao incluidos porque sao seguros de repetir.
--
-- Os blocos sao copias byte a byte do APPLY-ALL-IN-ORDER.sql (um teste prende-o).
-- 83 e 84 ficam de fora de proposito: ja estao aplicados, e o 84 nao pode correr na
-- mesma transaccao que o 83.
--
-- Verificado numa base local com as migracoes reais: aplica de ponta a ponta e aplica
-- uma segunda vez sem erro.
--
-- DEPOIS DE COLAR, correr um de cada vez, e cada um tem de dizer ALL TESTS PASSED:
--   supabase/tests/no_anonymous_overtime_reads_test.sql
--   supabase/tests/identity_by_badge_test.sql
--   supabase/tests/an_employee_sees_only_their_own_test.sql
--   supabase/tests/a_supervisor_links_a_login_test.sql
-- ================================================================
-- BLOCO 78
-- 20261009090000_a_tablet_is_a_place_not_a_person.sql
-- ================================================================

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


-- ================================================================
-- BLOCO 79
-- 20261010080000_the_tablets_qr_may_carry_the_code.sql
-- ================================================================

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

-- ================================================================
-- BLOCO 80
-- 20261010090000_the_office_can_write_the_attendance_its_board_writes.sql
-- ================================================================

-- The office places people on the headcount board, and the board's second write was refused.
--
-- `employee_attendance` was created on 31/07, three days after the office role got its
-- additive "office_admin all" policies, and it only ever had the admin one. Since the
-- board started mirroring each placement into attendance (so the finance close sees the
-- same day the board shows), every placement by a production_office_admin writes
-- `daily_allocations` fine and then fails here:
--
--   new row violates row-level security policy for table "employee_attendance"
--
-- thirteen times on 09/10 between 21:26 and 21:49, all from /dashboard/headcount. The
-- board keeps the placement and payroll never hears about it.
--
-- Same additive policy the office has on the other operational tables: OR'd with the
-- admin one, so no other role changes.

drop policy if exists "office_admin all" on public.employee_attendance;
create policy "office_admin all" on public.employee_attendance
  for all to authenticated
  using (public.has_role(auth.uid(), 'production_office_admin'::app_role))
  with check (public.has_role(auth.uid(), 'production_office_admin'::app_role));


-- ================================================================
-- BLOCO 81
-- 20261010100000_you_say_who_you_are_with_the_number_on_your_badge.sql
-- ================================================================

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
  -- Sem sessão não se liga nada.
  --
  -- O `grant` só dá isto ao papel `authenticated`, por isso o anon nunca chega cá. Mas
  -- a linha fica: sem esta guarda, um `auth.uid()` nulo passa as três verificações
  -- seguintes, escreve `user_id = null` sobre uma linha que já o tinha, e DEVOLVE a
  -- ficha do funcionário a quem a pediu. Um grant acrescentado por distracção numa
  -- migração futura transformava um erro de permissões numa fuga de dados, e esta
  -- base já teve exactamente essa espécie de acidente.
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'P0001';
  end if;

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
      -- A janela de 24 horas tem de valer na ESCRITA e não só na leitura.
      --
      -- Somando sempre, o contador nunca recomeçava: quem falhasse cinco vezes numa
      -- segunda-feira voltava na quarta, passava a porta (o `last_fail` já estava
      -- fora da janela), falhava uma vez — e a soma punha 6, com `last_fail` outra
      -- vez dentro da janela. A partir daí tinha UMA tentativa por dia em vez de
      -- cinco, para sempre, e nenhum ecrã onde alguém limpasse aquilo.
      set fails = case
            when public.identity_link_attempts.last_fail > now() - interval '24 hours'
              then public.identity_link_attempts.fails + 1
            else 1
          end,
          last_fail = now();
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


-- ================================================================
-- BLOCO 82
-- 20261011090000_the_public_was_never_invited.sql
-- ================================================================

-- Two hundred and seven people's names, read without logging in.
--
-- Postgres grants EXECUTE on a new function to PUBLIC. Nothing in 20261006180000
-- takes that away: it ends with eight lines of
--
--     grant execute on function public.<name> to authenticated;
--
-- and a grant does not narrow what PUBLIC already holds. `check_invite_code` in
-- 20260723140000 gets this right — `REVOKE ALL ... FROM public` first, then the grant
-- — and these eight were written without it.
--
-- Measured against production on 11/10/2026 with the publishable key, which is in the
-- JavaScript every visitor downloads, and no session at all:
--
--     POST /rest/v1/rpc/overtime_unlinked_names   200   207 rows
--                                                       id, full_name, department, shift_group
--     POST /rest/v1/rpc/overtime_reliability      200   rows per employee, attendance among them
--     POST /rest/v1/rpc/overtime_roster           200   []
--     POST /rest/v1/rpc/my_employee_id            200   null
--
-- The last two are empty only because they read `auth.uid()`, which anonymous callers
-- do not have. That is luck, not a boundary: `overtime_reliability` takes a date and
-- answers for everybody, and it answered.
--
-- These functions are all SECURITY DEFINER, so the grant IS the boundary. There is no
-- RLS underneath to catch this — that is the point of definer rights, and the reason
-- the revoke is not optional.
--
-- NOT a fix for who among the signed-in may call them: 20261010100000 narrows
-- `overtime_unlinked_names` and `link_me_to_employee` away from `authenticated`, and
-- that stands. This closes the other door, which that migration left untouched —
-- revoking from `authenticated` while PUBLIC still holds EXECUTE changes nothing at
-- all, and both were written by the same hand on the same day.
--
-- Idempotent, and safe to run before or after 20261010100000.

revoke all on function public.answer_overtime(uuid, text)      from public;
revoke all on function public.link_me_to_employee(uuid)        from public;
revoke all on function public.overtime_reliability(date)       from public;
revoke all on function public.can_manage_overtime(uuid)        from public;
revoke all on function public.my_employee_id()                 from public;
revoke all on function public.overtime_roster()                from public;
revoke all on function public.my_overtime_identity()           from public;
revoke all on function public.overtime_unlinked_names()        from public;

-- Put back exactly what 20261006180000 meant to give, since REVOKE ... FROM public
-- also takes it from every role that only had it through PUBLIC. Named one by one so
-- this file says, on its own, who may call what.
--
-- `overtime_unlinked_names` and `link_me_to_employee` are deliberately absent: they
-- are revoked from `authenticated` by 20261010100000, and re-granting them here would
-- undo that migration from behind. If that one has not run yet, the screen that needs
-- them is the old "pick your name" one, which is the hole it exists to close.
grant execute on function public.answer_overtime(uuid, text)   to authenticated;
grant execute on function public.overtime_reliability(date)    to authenticated;
grant execute on function public.can_manage_overtime(uuid)     to authenticated;
grant execute on function public.my_employee_id()              to authenticated;
grant execute on function public.overtime_roster()             to authenticated;
grant execute on function public.my_overtime_identity()        to authenticated;

-- The two the floor's push needs, and the two the sign-up page calls before anybody
-- has a session. Listed here so the next person does not have to guess which of these
-- being anonymous is deliberate: these four are, the eight above were not.
revoke all on function public.overtime_push_targets(uuid, uuid[]) from public;
grant execute on function public.overtime_push_targets(uuid, uuid[]) to authenticated;


-- ================================================================
-- BLOCO 85
-- 20261011220000_a_generated_column_only_follows.sql
-- ================================================================
--
-- CORRIGE UM APPROVE QUE FALHA. Cole este sozinho se so quiser isso: nao
-- depende de nenhum dos blocos acima e e idempotente.
--

-- A coluna que só segue, e a função que tentava escrevê-la.
--
-- O `admin_update_auth_email` existe desde 12/07/2026 e até 11/10/2026 não tinha um
-- único chamador — nem no `src/`, nem numa edge function, nem num trigger. Uma função
-- que ninguém chama nunca falha, por isso ninguém soube que ela estava partida.
--
-- No fim do corpo ela faz:
--
--     update auth.identities
--        set identity_data = ... , email = normalized, ...
--
-- e o `auth.identities.email` é, no GoTrue de hoje, uma coluna GERADA a partir de
-- `identity_data->>'email'`. O Postgres recusa a instrução inteira com
--
--     column "email" can only be updated to DEFAULT        (SQLSTATE 428C9)
--
-- Como o `update auth.users` que confirma o endereço vem ANTES, e tudo isto corre numa
-- transacção, a recusa desfaz também essa confirmação. O efeito visível era um Approve
-- que falhava por completo e uma pessoa que continuava sem conseguir entrar.
--
-- O QUE ESTA MIGRAÇÃO FAZ, E PORQUE NÃO SE LIMITA A APAGAR A LINHA. Não consegui ler o
-- `attgenerated` desta base a partir de onde trabalho — o esquema `auth` não é servido
-- pelo PostgREST. Apagar a linha é certo num esquema onde a coluna é gerada e deixa-a
-- desactualizada num esquema antigo onde ela seja uma coluna normal. Por isso a coluna
-- é escrita apenas quando for escrevível, e a pergunta é feita ao catálogo em vez de
-- ser adivinhada. O `execute` é o que importa: uma instrução estática seria planeada
-- mesmo no ramo que não corre, e voltava a rebentar.
--
-- O `identity_data` é actualizado nos dois casos, que é o que o GoTrue lê.

create or replace function public.admin_update_auth_email(_user_id uuid, _new_email text)
returns void
language plpgsql
security definer
set search_path = public, auth
as $$
declare
  normalized text := lower(trim(_new_email));
begin
  if not (public.has_role(auth.uid(), 'admin') or public.has_role(auth.uid(), 'manager')) then
    raise exception 'Only admins or managers may update operator emails';
  end if;

  if exists (select 1 from auth.users where lower(email) = normalized and id <> _user_id) then
    raise exception 'This email is already in use by another login';
  end if;

  update auth.users
  set email = normalized,
      raw_user_meta_data = coalesce(raw_user_meta_data, '{}'::jsonb) || jsonb_build_object('email', normalized),
      email_confirmed_at = coalesce(email_confirmed_at, now()),
      confirmation_token = coalesce(confirmation_token, ''),
      email_change = '',
      email_change_token_new = '',
      email_change_token_current = '',
      recovery_token = coalesce(recovery_token, ''),
      reauthentication_token = coalesce(reauthentication_token, ''),
      updated_at = now()
  where id = _user_id;

  if not found then
    raise exception 'Auth user not found';
  end if;

  -- O que o GoTrue lê. A coluna gerada segue isto sozinha.
  update auth.identities
  set identity_data = coalesce(identity_data, '{}'::jsonb) || jsonb_build_object('email', normalized),
      updated_at = now()
  where user_id = _user_id and provider = 'email';

  -- E só se a coluna for mesmo escrevível. `attgenerated = ''` quer dizer coluna
  -- normal; numa coluna gerada vale 's' e este ramo não corre.
  if exists (
    select 1 from pg_attribute
     where attrelid = 'auth.identities'::regclass
       and attname = 'email'
       and attgenerated = ''
       and not attisdropped
  ) then
    execute 'update auth.identities set email = $1 where user_id = $2 and provider = ''email'''
      using normalized, _user_id;
  end if;
end;
$$;

-- Os mesmos acessos de 20260726240000, reafirmados para o estado final não depender de
-- o CREATE OR REPLACE preservar ACLs.
revoke execute on function public.admin_update_auth_email(uuid, text) from public;
revoke execute on function public.admin_update_auth_email(uuid, text) from anon;
grant  execute on function public.admin_update_auth_email(uuid, text) to authenticated;


-- ================================================================
-- BLOCO 86
-- 20261011230000_the_invite_code_rides_the_link.sql
-- ================================================================
--
-- O botao "Create account" passa a levar o codigo. LEIA O CABECALHO: o codigo
-- deixa de ser segredo de proposito. O que trava o registo passa a ser o
-- interruptor "Allow new users to register" e o "New accounts start as".
--

-- O código de convite passa a viajar no link.
--
-- DECISÃO DELIBERADA, TOMADA A 11/10/2026, com a consequência dita em voz alta: a
-- partir daqui o código deixa de ser um segredo. Qualquer pessoa que abra o ecrã de
-- entrada pode lê-lo, porque é de lá que o botão "Create account" o vai buscar. Quem
-- quiser registar-se consegue.
--
-- Porque é que isso é aceitável aqui: o código nunca foi a fechadura. Era um papel
-- afixado ao pé do relógio de ponto, numa fábrica onde já se entra com crachá. Custava
-- uma chamada ao supervisor às seis da manhã e não impedia ninguém que lá estivesse.
--
-- AS DUAS FECHADURAS A SÉRIO FICAM, e são estas:
--
--   signup_config.enabled           desligado, esta função devolve null e não há registo
--   signup_config.invite_expires_at passado, idem
--   signup_config.self_signup_role  null  -> a conta nasce SEM papel e sem acesso,
--                                            à espera de um admin
--                                   'employee' -> nasce activa, só com My Overtime
--
-- Quem puser `self_signup_role` em 'employee' está a decidir que qualquer pessoa que
-- abra o site fica com uma conta activa. É uma escolha legítima numa rede de fábrica e
-- não é uma escolha que esta migração faça por ninguém.
--
-- SUBSTITUI o `signup_invite_for_tablet` (20261010080000), que dava o código só a uma
-- sessão de conta de linha. Essa restrição deixa de fazer sentido quando o ecrã público
-- passa a mostrá-lo, e uma função `security definer` sem chamadores é precisamente o
-- que esteve partido em silêncio durante três meses nesta base — por isso é removida em
-- vez de ficar.

create or replace function public.signup_invite_code()
returns text
language sql
stable
security definer
set search_path = public
as $$
  select c.invite_code
    from public.signup_config c
   where c.id = true
     and c.enabled
     and coalesce(c.invite_code, '') <> ''
     and (c.invite_expires_at is null or c.invite_expires_at > now())
$$;

comment on function public.signup_invite_code() is
  'O codigo de convite em vigor, ou null se o registo estiver fechado ou o codigo '
  'expirado. E legivel por anon de proposito: o ecra de entrada poe-no no link do '
  '"Create account". Ver 20261011230000 para a decisao e para o que continua a travar.';

revoke all on function public.signup_invite_code() from public;
grant execute on function public.signup_invite_code() to anon, authenticated;

-- A versão anterior, que ninguém passa a chamar.
drop function if exists public.signup_invite_for_tablet();

-- ================================================================
-- BLOCO 87
-- 20261012080000_an_answer_remembers_the_shift_it_was_given_to.sql
-- ================================================================
--
-- PERMITE CORRIGIR A DATA E AS HORAS DE UM PEDIDO JA FEITO sem apagar os sins.
-- Independente dos blocos acima e idempotente: pode ser colado sozinho.
--

-- Uma resposta passa a lembrar-se do turno a que foi dada.
--
-- As horas de um pedido são escritas à mão em dois campos `type="time"`. Não há conta
-- nenhuma a derivá-las, por isso um engano fica lá: a 13/10/2026 havia um pedido para
-- as 18:00-14:00 -- vinte horas -- onde era 18:00-06:00. Corrigi-lo obrigava a cancelar
-- o pedido e a recomeçar, e com ele iam embora os sins verdadeiros.
--
-- A partir daqui corrigir é permitido e NAO apaga respostas. Quem ja tinha respondido
-- fica assinalado, para o supervisor saber a quem tem de ligar. Para isso a resposta
-- tem de saber a que turno foi dada, porque o pedido ja nao sabe -- foi ele que mudou.
--
-- TRES COLUNAS E NAO UMA FRASE. Guardar "13/10 18:00-06:00" como texto obrigava a base
-- e o ecra a escrever a hora da mesma maneira para sempre; na primeira vez que um
-- devolvesse 06:00:00 e o outro 06:00, TODA a gente aparecia como tendo respondido a
-- outro turno e o aviso deixava de querer dizer alguma coisa. Comparar campo a campo
-- nao tem esse problema.
--
-- As respostas que ja existem ficam com null, e null quer dizer "nao se sabe", nao
-- "igual". O ecra nao assinala nada nesse caso -- ver `answeredForDifferentHours`.
-- Nao e feito backfill: inventar que uma resposta antiga foi dada ao turno actual era
-- afirmar precisamente aquilo que estas colunas existem para nao ter de adivinhar.

alter table public.overtime_responses
  add column if not exists answered_for_date       date,
  add column if not exists answered_for_starts_at  time,
  add column if not exists answered_for_ends_at    time;

comment on column public.overtime_responses.answered_for_date is
  'O turno que a pessoa tinha a frente quando respondeu. Null nas respostas anteriores '
  'a 20261012080000, e null quer dizer "nao se sabe". Ver staleOvertimeAnswer.ts.';

-- O `answer_overtime` ja tem a linha do pedido carregada em v_req, por isso isto e so
-- dizer-lhe que a guarde. O resto da funcao fica como estava em 20261007090000.
create or replace function public.answer_overtime(p_request_id uuid, p_answer text)
returns public.overtime_responses
language plpgsql security definer set search_path = public
as $$
declare
  v_emp     uuid := public.my_employee_id();
  v_req     public.overtime_requests;
  v_dept    text;
  v_shift   text;
  v_row     public.overtime_responses;
  v_block   record;
begin
  if v_emp is null then
    raise exception 'No employee record is linked to this login' using errcode = 'P0001';
  end if;
  if p_answer not in ('yes', 'no') then
    raise exception 'Answer must be yes or no' using errcode = 'P0001';
  end if;

  select * into v_req from public.overtime_requests where id = p_request_id;
  if v_req.id is null or v_req.status <> 'open' then
    raise exception 'This overtime is no longer open' using errcode = 'P0001';
  end if;

  -- Who the answerer is, as the ask measures them.
  select department, shift_group into v_dept, v_shift
    from public.employees where id = v_emp;

  if v_req.department is not null and v_req.department is distinct from v_dept then
    raise exception 'This overtime is for % and you are not in it', v_req.department
      using errcode = 'P0001';
  end if;
  if v_req.shift_group is not null and v_req.shift_group is distinct from v_shift then
    raise exception 'This overtime is for the % crew', v_req.shift_group
      using errcode = 'P0001';
  end if;

  if exists (select 1 from public.overtime_responses
              where request_id = p_request_id and employee_id = v_emp and decision is not null) then
    raise exception 'The supervisor has already decided on your answer' using errcode = 'P0001';
  end if;
  -- A "no" is always allowed: it is information, not a request.
  if p_answer = 'yes' then
    select * into v_block from public.overtime_block_for(v_emp);
    if v_block.blocked_until is not null then
      raise exception 'You can''t sign up for overtime until %. (Missed overtime on %.)',
        to_char(v_block.blocked_until, 'DD/MM'), to_char(v_block.on_date, 'DD/MM')
        using errcode = 'P0001';
    end if;
  end if;

  insert into public.overtime_responses (
    request_id, employee_id, answer,
    answered_for_date, answered_for_starts_at, answered_for_ends_at)
  values (
    p_request_id, v_emp, p_answer,
    v_req.on_date, v_req.starts_at, v_req.ends_at)
  on conflict (request_id, employee_id)
  do update set answer    = excluded.answer,
                answered_at = now(),
                -- Mudar de ideias e responder ao turno de AGORA, por isso o
                -- instantaneo anda com a resposta e nao fica no primeiro valor.
                answered_for_date      = excluded.answered_for_date,
                answered_for_starts_at = excluded.answered_for_starts_at,
                answered_for_ends_at   = excluded.answered_for_ends_at
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.answer_overtime(uuid, text) from public;
grant execute on function public.answer_overtime(uuid, text) to authenticated;


-- ================================================================
-- BLOCO 88
-- 20261012140000_the_email_you_signed_in_with_says_who_you_are.sql
-- ================================================================
--
-- LIGA A CONTA SOZINHA quando o email da sessao esta na ficha. Independente
-- e idempotente; pode ser colado sozinho.
--

-- O email com que entraste diz quem tu és.
--
-- Hoje um funcionário que acaba de criar conta tem de escrever o número do crachá.
-- Muitos não o sabem de cor, 51 fichas não têm número nenhum, e a mensagem manda
-- falar com um supervisor que até agora não tinha onde carregar.
--
-- A ficha do funcionário já tem `email`. Quando esse email é o MESMO com que a pessoa
-- iniciou sessão, não há nada a adivinhar: o GoTrue já verificou que ela controla
-- aquela caixa de correio, e é por isso que esta função não aceita um email como
-- argumento. Aceitar um transformava isto em "escreve o email do teu colega e ficas
-- com a ficha dele". Sem argumento, a única forma de reclamar uma ficha é ter entrado
-- com o email que está nela.
--
-- EXACTAMENTE UMA LINHA, ou nada. Dois funcionários com o mesmo email na ficha é um
-- erro de dados que ninguém deve resolver por sorteio, e a função recusa-se a
-- escolher — a pessoa cai no crachá, como antes.
--
-- NÃO MEXE NO CONTADOR DE TENTATIVAS. O `link_me_by_employee_ref` conta as falhas
-- porque ali a pessoa está a adivinhar um número. Aqui não escreveu nada: isto corre
-- sozinho quando a página abre. Gastar-lhe uma das cinco tentativas por uma coisa que
-- ela não fez era tirar-lhe o recurso de que vai precisar a seguir.

create or replace function public.link_me_by_email()
returns public.employees
language plpgsql security definer set search_path = public
as $$
declare
  v_email   text := lower(trim(coalesce(auth.jwt() ->> 'email', '')));
  v_matches integer;
  v_row     public.employees;
begin
  if auth.uid() is null then
    raise exception 'Sign in first' using errcode = 'P0001';
  end if;

  -- Um tablet é um sítio, não uma pessoa. A mesma recusa das outras duas portas: um
  -- turno inteiro entra nesta conta, e ligá-la a alguém faz de toda a gente essa
  -- pessoa. Ver 20261009090000.
  if exists (select 1 from public.operator_line_accounts o where o.user_id = auth.uid()) then
    raise exception 'This is a shared line tablet, not a personal account.'
      using errcode = 'P0001';
  end if;

  if public.my_employee_id() is not null then
    raise exception 'This login is already linked to an employee' using errcode = 'P0001';
  end if;

  -- Contas de crachá vivem em `@employee.pmsystem.local`, um domínio onde ninguém
  -- recebe nada e que ninguém escolheu. Não é prova de identidade de pessoa nenhuma.
  if v_email = '' or v_email like '%@employee.pmsystem.local' then
    raise exception 'No work email on this login' using errcode = 'P0001';
  end if;

  select count(*) into v_matches
    from public.employees
   where lower(trim(email)) = v_email and active and user_id is null;

  if v_matches <> 1 then
    -- Zero: o email não está em ficha nenhuma, ou a ficha já foi reclamada.
    -- Dois ou mais: erro de dados, e ninguém escolhe por sorteio.
    raise exception 'No single employee record matches this email' using errcode = 'P0001';
  end if;

  update public.employees
     set user_id = auth.uid()
   where lower(trim(email)) = v_email
     and active
     and user_id is null
  returning * into v_row;

  if v_row.id is null then
    -- Outra sessão chegou primeiro entre a contagem e a escrita.
    raise exception 'No single employee record matches this email' using errcode = 'P0001';
  end if;

  -- A tentativa falhada do crachá, se a houve, deixa de interessar: a pessoa está
  -- ligada e o contador não serve para mais nada.
  delete from public.identity_link_attempts where user_id = auth.uid();
  return v_row;
end;
$$;

revoke all on function public.link_me_by_email() from public;
grant execute on function public.link_me_by_email() to authenticated;

comment on function public.link_me_by_email() is
  'Liga este login ao funcionario cujo email e o da SESSAO, se houver exactamente uma '
  'ficha activa e por reclamar com esse email. Nao aceita argumento de proposito: '
  'quem nao controla a caixa de correio nao reclama a ficha. Ver 20261012140000.';


-- ================================================================
-- BLOCO 89
-- 20261012150000_timemoto_is_where_the_number_comes_from.sql
-- ================================================================
--
-- SO O ESQUEMA. As colunas ficam vazias ate haver importacao do TimeMoto.
--

-- O TimeMoto passa a ser de onde vem o número.
--
-- Decidido a 12/10/2026: o relógio já é o sistema onde toda a gente desta fábrica tem
-- um identificador estável, e este tinha os seus — 51 fichas sem `employee_ref`
-- nenhum, nomes escritos de maneiras diferentes em três sítios, e uma lista de
-- `sheet_aliases` curada à mão porque emparelhar por nome nunca funcionou.
--
-- Isto é só o esquema. A IMPORTAÇÃO é um passo à parte e precisa do export do
-- TimeMoto; sem ele estas colunas ficam vazias e nada muda, que é o estado correcto
-- para uma coluna que ainda não tem dados.
--
-- DEPOIS DE IMPORTAR, e só então, as fichas sem número herdam o do relógio:
--
--     update public.employees
--        set employee_ref = timemoto_user_id
--      where employee_ref is null and timemoto_user_id is not null;
--
-- Não está aqui de propósito. Posta nesta migração corria uma vez, a zero linhas,
-- antes de os dados existirem — e depois nunca mais. Pertence ao passo da importação.
--
-- Levanta a instrução de 2026 de não preencher as 51 fichas sem `employee_ref`, que
-- foi levantada explicitamente ao tomar esta decisão. Quem já tem número MANTÉM o
-- seu: a linha acima só toca no que está vazio.

alter table public.employees
  add column if not exists timemoto_user_id  text,
  add column if not exists timemoto_username text;

-- Dois funcionários com o mesmo id de relógio é um erro de importação, e é melhor que
-- a importação falhe do que fique silenciosamente a apontar duas fichas ao mesmo
-- picar. Parcial, porque vazio é o estado normal enquanto não houver export.
create unique index if not exists employees_timemoto_user_id_key
  on public.employees (timemoto_user_id)
  where timemoto_user_id is not null;

comment on column public.employees.timemoto_user_id is
  'O identificador desta pessoa no TimeMoto. E a fonte do numero: as fichas sem '
  'employee_ref herdam-no na importacao. Ver 20261012150000.';
comment on column public.employees.timemoto_username is
  'O nome de utilizador no TimeMoto, para a importacao poder ser conferida por um '
  'humano sem abrir os dois sistemas lado a lado.';

-- ================================================================
-- BLOCO 90
-- 20261012160000_an_employee_sees_only_their_own.sql
-- ================================================================
--
-- UM EMPREGADO VE SO O QUE E SEU: tecto no has_action para o papel employee, os
-- numeros de fiabilidade so para quem gere horas extra, respostas e resultados de
-- horas extra so do proprio, e a funcao my_attendance para o ecra My Attendance.
-- Independente dos blocos acima e idempotente: pode ser colado sozinho.
-- Depois, correr supabase/tests/an_employee_sees_only_their_own_test.sql.
--

-- An employee sees their own records, and nobody else's.
--
-- The `employee` login is the one a badge or the invite link hands out: the whole floor,
-- on their own phones. Four things let that login read past itself, and this closes all
-- four. Nothing here changes what admin, manager or the office admin can read.
--
-- 1. `has_action` honoured any Permissions-screen grant for any role. One tick of
--    `workforce.view` for the employee role would have opened `employees`, the leave
--    screens and the finance close to every badge login, in the database as well as
--    the menu. The employee role now has a CEILING: outside `overtime.respond` and
--    `attendance.view_own` a grant to it does nothing. Mirrors EMPLOYEE_CEILING in
--    src/lib/permissions.ts.
--
-- 2. `overtime_reliability()` is SECURITY DEFINER with no check on who asks. Any
--    signed-in login got every person's sick and absent count for the month — health
--    data, one row per employee. It now answers only to whoever runs overtime.
--
-- 3. `overtime_responses` and `overtime_outcomes` were readable by every signed-in login
--    (`using (true)`, decided 06/10: "the floor already knows who put their hand up").
--    Reversed on 12/10 at the owner's request: every yes, no, no-show and called-sick
--    reached every employee's device, and My Overtime only ever used the caller's own.
--    A person now reads their own rows; whoever runs overtime reads all of them.
--    Every function that reads these tables for somebody else is SECURITY DEFINER
--    (answer_overtime, record_overtime_outcome, overtime_block_for, the board bridge),
--    so none of them is narrowed by this.
--
-- 4. My Attendance needs the caller's own clock, marks, plan and leave, and those
--    tables are readable by staff only. Rather than a self-read policy on each of five
--    tables — five more doors, two of them on tables no migration in this repository
--    creates — one function returns the caller's own rows and nothing else. It
--    calculates nothing: the screen runs the same TypeScript the finance close runs
--    (`countDaysAway`, `buildClose`, `leaveBalance`), so the two cannot disagree.
--
-- Idempotent and independent of BLOCOS 88–89. Paste after BLOCO 89.

-- ---------------------------------------------------------------------------
-- 1. The employee ceiling, in the one function every matrix check goes through
-- ---------------------------------------------------------------------------
create or replace function public.has_action(
  _uid uuid,
  _action text,
  _baseline app_role[]
)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.user_roles ur
    left join public.role_permission_overrides o
      on o.role = ur.role and o.action = _action
    where ur.user_id = _uid
      and case
            when ur.role = 'admin'::app_role then true
            -- The ceiling comes before the override on purpose: a grant beyond it
            -- must do nothing, not merely be outvoted by the baseline.
            when ur.role = 'employee'::app_role
             and _action <> all (array['overtime.respond', 'attendance.view_own'])
              then false
            else coalesce(o.allowed, ur.role = any (_baseline))
          end
  );
$$;

revoke all on function public.has_action(uuid, text, app_role[]) from public;
grant execute on function public.has_action(uuid, text, app_role[]) to authenticated;

-- ---------------------------------------------------------------------------
-- 2. The reliability numbers answer only to whoever runs overtime
-- ---------------------------------------------------------------------------
-- The body is 20261006220000's, the current one (with `blocked_until`), unchanged but
-- for the last line. Same signature and columns, so `create or replace` keeps grants.
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

-- ---------------------------------------------------------------------------
-- 3. Answers and outcomes: your own, or all of them if you run overtime
-- ---------------------------------------------------------------------------
drop policy if exists "overtime_responses_read" on public.overtime_responses;
create policy "overtime_responses_read" on public.overtime_responses
  for select to authenticated
  using (employee_id = public.my_employee_id() or public.can_manage_overtime(auth.uid()));

drop policy if exists "overtime_outcomes_read" on public.overtime_outcomes;
create policy "overtime_outcomes_read" on public.overtime_outcomes
  for select to authenticated
  using (
    public.can_manage_overtime(auth.uid())
    or exists (select 1 from public.overtime_responses r
                where r.id = response_id and r.employee_id = public.my_employee_id())
  );

-- ---------------------------------------------------------------------------
-- 4. My Attendance: the caller's own rows, from the records that already exist
-- ---------------------------------------------------------------------------
-- No employee id is taken from the caller. Whose rows these are is decided here, from
-- the session, by `my_employee_id()` — a URL or a request body cannot name somebody else.
--
-- `null` means the login is not linked to an employee yet; the screen says so rather
-- than drawing an empty month.
create or replace function public.my_attendance(p_from date, p_to date)
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
declare
  v_emp        uuid;
  v_year_from  date;
begin
  if auth.uid() is null then
    raise exception 'Sign in to see your attendance' using errcode = '42501';
  end if;
  -- The baseline is `attendance.view_own` in src/lib/permissions.ts, and must stay so.
  if not public.has_action(auth.uid(), 'attendance.view_own',
           array['admin','manager','production_office_admin','engineer',
                 'maintenance_manager','warehouse','quality_supervisor','employee']::app_role[]) then
    raise exception 'Not allowed to see attendance' using errcode = '42501';
  end if;
  if p_from is null or p_to is null or p_to < p_from then
    raise exception 'The range must start on or before the day it ends' using errcode = '22023';
  end if;
  if p_to - p_from > 400 then
    raise exception 'Pick a range of at most 400 days' using errcode = '22023';
  end if;

  v_emp := public.my_employee_id();
  if v_emp is null then
    return null;
  end if;

  -- Two leave years either side of today, so the balance can be counted whatever
  -- "today" the screen uses; `leaveBalance` keeps only the current one.
  v_year_from := make_date(extract(year from current_date)::int - 1, 8, 1);

  return jsonb_build_object(
    'me', (
      select jsonb_build_object(
        'id', e.id, 'full_name', e.full_name, 'employee_ref', e.employee_ref,
        'department', e.department, 'position', e.position,
        'shift_group', e.shift_group, 'started_on', e.started_on)
        from public.employees e where e.id = v_emp),
    'pattern', (
      select jsonb_build_object(
        'name', p.name, 'days', p.days, 'starts_at', p.starts_at, 'ends_at', p.ends_at,
        'break_minutes', p.break_minutes, 'annual_leave_days', p.annual_leave_days)
        from public.employees e join public.shift_patterns p on p.id = e.shift_pattern_id
       where e.id = v_emp),
    'clocks', coalesce((
      select jsonb_agg(jsonb_build_object(
               'on_date', d.on_date, 'start_time', d.start_time, 'end_time', d.end_time,
               'worked_minutes', d.worked_minutes, 'balance_minutes', d.balance_minutes,
               'scheduled_minutes', d.scheduled_minutes,
               'overtime_adj_minutes', d.overtime_adj_minutes,
               'absence_name', d.absence_name) order by d.on_date)
        from public.attendance_days d
       where d.employee_id = v_emp and d.on_date between p_from and p_to), '[]'::jsonb),
    -- How far the clock record reaches for this person. A rostered day after it is
    -- "no record yet", never "absent".
    'clocked_to', (select max(d.on_date) from public.attendance_days d where d.employee_id = v_emp),
    'clocks_imported_at', (select max(d.imported_at) from public.attendance_days d where d.employee_id = v_emp),
    'marks', coalesce((
      select jsonb_agg(jsonb_build_object('on_date', a.on_date, 'status', a.status) order by a.on_date)
        from public.employee_attendance a
       where a.employee_id = v_emp and a.on_date between p_from and p_to), '[]'::jsonb),
    'holiday_marks', coalesce((
      select jsonb_agg(a.on_date order by a.on_date)
        from public.employee_attendance a
       where a.employee_id = v_emp and a.status = 'holiday'
         and a.on_date between v_year_from and v_year_from + interval '3 years'), '[]'::jsonb),
    'board', coalesce((
      select jsonb_agg(jsonb_build_object(
               'on_date', b.on_date, 'shift', b.shift, 'status', b.status,
               'half_day', b.half_day) order by b.on_date)
        from public.daily_allocations b
       where b.employee_id = v_emp and b.on_date between p_from and p_to), '[]'::jsonb),
    'requests', coalesce((
      select jsonb_agg(jsonb_build_object(
               'kind', r.kind, 'start_date', r.start_date, 'end_date', r.end_date,
               'status', r.status, 'working_days', r.working_days) order by r.start_date)
        from public.leave_requests r
       where r.employee_id = v_emp
         and r.start_date <= p_to and r.end_date >= p_from), '[]'::jsonb),
    -- Hours payroll recorded for this person, per period. The figure that is paid.
    'payroll', coalesce((
      select jsonb_agg(jsonb_build_object('period_id', o.period_id, 'hours', o.hours))
        from public.overtime_entries o
        join public.workforce_payroll_periods w on w.id = o.period_id
       where o.employee_id = v_emp
         and w.start_date <= p_to and w.end_date >= p_from), '[]'::jsonb),
    -- The calendar, not anybody's data: the selector needs it, and the table is
    -- readable by admin alone.
    'periods', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'name', w.name, 'start_date', w.start_date, 'end_date', w.end_date)
               order by w.start_date)
        from public.workforce_payroll_periods w
       where w.start_date <= current_date + 120), '[]'::jsonb)
  );
end;
$$;

revoke all on function public.my_attendance(date, date) from public;
grant execute on function public.my_attendance(date, date) to authenticated;

-- ================================================================
-- BLOCO 91
-- 20261012170000_a_supervisor_links_a_login_to_its_person.sql
-- ================================================================
--
-- O SUPERVISOR LIGA UM LOGIN A PESSOA CERTA: o ecra Link accounts (admin e
-- manager). Precisa do BLOCO 90 antes (o tecto do papel employee no has_action).
-- Idempotente. Depois, correr supabase/tests/a_supervisor_links_a_login_test.sql.
--

-- A supervisor links a login to the person it belongs to.
--
-- "Which badge is yours?" ends with "your supervisor can link your account — they have
-- the list". There was no list. Nobody had a screen to set `employees.user_id`, so a
-- person who did not know their badge number, whose record has none (51 of them), or
-- whose email is not on their record had no way in at all.
--
-- Who may: `employees.link_login`, admin and manager — the people who already manage
-- accounts (`users.manage`). The office admin's role excludes Users by definition, and
-- the employee's ceiling (`has_action`, 20261012160000) excludes it by construction.
--
-- What it will not do, each for a reason already written down elsewhere:
--   - link a shared line tablet account (a place, not a person — 20261009090000);
--   - link a login that is already somebody, or a record already claimed — a second
--     link is a correction, and a correction is unlink then link, both audited;
--   - choose between two records: it takes ids, picked by a human, never a name.
--
-- The suggestion in `login_link_candidates()` is only that. It names a record when
-- exactly one active, unclaimed record carries the login's email, or failing that the
-- login's name; a person still presses Link.
--
-- Every link and unlink is written to `audit_logs`.
--
-- Idempotent. Paste after BLOCO 90, whose employee ceiling it relies on.

-- The list: logins that are nobody yet, records nobody has claimed, and who is linked.
create or replace function public.login_link_candidates()
returns jsonb
language plpgsql stable security definer set search_path = public
as $$
begin
  if auth.uid() is null
     or not public.has_action(auth.uid(), 'employees.link_login', array['admin','manager']::app_role[]) then
    raise exception 'Not allowed to link accounts' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'logins', coalesce((
      select jsonb_agg(jsonb_build_object(
               'user_id', u.id,
               'email', u.email,
               'name', p.name,
               'roles', (select coalesce(jsonb_agg(ur.role order by ur.role), '[]'::jsonb)
                           from public.user_roles ur where ur.user_id = u.id),
               'created_at', u.created_at,
               'suggested_employee_id', (
                 select coalesce(
                   (select min(e.id::text)::uuid from public.employees e
                     where e.active and e.user_id is null
                       and lower(trim(e.email)) = lower(trim(u.email))
                    having count(*) = 1),
                   (select min(e.id::text)::uuid from public.employees e
                     where e.active and e.user_id is null and p.name is not null
                       and lower(trim(e.full_name)) = lower(trim(p.name))
                    having count(*) = 1)))
             ) order by u.created_at desc)
        from auth.users u
        left join public.profiles p on p.id = u.id
       where not exists (select 1 from public.employees e where e.user_id = u.id)
         and not exists (select 1 from public.operator_line_accounts o where o.user_id = u.id)
         and coalesce(p.active, true)), '[]'::jsonb),
    'employees', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', e.id, 'full_name', e.full_name, 'employee_ref', e.employee_ref,
               'department', e.department, 'shift_group', e.shift_group) order by e.full_name)
        from public.employees e
       where e.active and e.user_id is null), '[]'::jsonb),
    'linked', coalesce((
      select jsonb_agg(jsonb_build_object(
               'employee_id', e.id, 'full_name', e.full_name, 'employee_ref', e.employee_ref,
               'department', e.department, 'user_id', e.user_id, 'email', u.email) order by e.full_name)
        from public.employees e
        join auth.users u on u.id = e.user_id), '[]'::jsonb)
  );
end;
$$;

create or replace function public.link_login_to_employee(p_user_id uuid, p_employee_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_row     public.employees;
  v_already text;
  v_name    text;
begin
  if auth.uid() is null
     or not public.has_action(auth.uid(), 'employees.link_login', array['admin','manager']::app_role[]) then
    raise exception 'Not allowed to link accounts' using errcode = '42501';
  end if;
  if p_user_id is null or p_employee_id is null then
    raise exception 'Pick both the login and the person' using errcode = '22023';
  end if;
  if not exists (select 1 from auth.users where id = p_user_id) then
    raise exception 'That login no longer exists' using errcode = 'P0001';
  end if;
  if exists (select 1 from public.operator_line_accounts o where o.user_id = p_user_id) then
    raise exception 'That is a shared line tablet, not a person. It cannot be linked to anybody.'
      using errcode = 'P0001';
  end if;

  -- Two supervisors linking the same login at once must not give it two people.
  perform pg_advisory_xact_lock(hashtext('link_login:' || p_user_id::text));

  select full_name into v_already from public.employees where user_id = p_user_id limit 1;
  if v_already is not null then
    raise exception 'That login is already linked to %. Unlink it first.', v_already
      using errcode = 'P0001';
  end if;

  update public.employees
     set user_id = p_user_id
   where id = p_employee_id and active and user_id is null
  returning * into v_row;
  if v_row.id is null then
    raise exception 'That person is already linked to a login, or is no longer active.'
      using errcode = 'P0001';
  end if;

  -- Wrong badge guesses no longer matter once the person is linked. The table comes
  -- with BLOCO 81, which may not have been pasted yet.
  if to_regclass('public.identity_link_attempts') is not null then
    execute 'delete from public.identity_link_attempts where user_id = $1' using p_user_id;
  end if;

  select coalesce(p.name, 'Unknown') into v_name from public.profiles p where p.id = auth.uid();
  insert into public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  values (auth.uid(), coalesce(v_name, 'Unknown'), 'employee.login_linked', 'employee', v_row.id::text,
          jsonb_build_object('employee', v_row.full_name, 'employee_ref', v_row.employee_ref,
                             'login', (select email from auth.users where id = p_user_id),
                             'user_id', p_user_id));
end;
$$;

create or replace function public.unlink_login_from_employee(p_employee_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_row  public.employees;
  v_was  uuid;
  v_name text;
begin
  if auth.uid() is null
     or not public.has_action(auth.uid(), 'employees.link_login', array['admin','manager']::app_role[]) then
    raise exception 'Not allowed to link accounts' using errcode = '42501';
  end if;

  select user_id into v_was from public.employees where id = p_employee_id for update;
  if v_was is null then
    raise exception 'That person is not linked to a login' using errcode = 'P0001';
  end if;

  update public.employees set user_id = null where id = p_employee_id returning * into v_row;

  select coalesce(p.name, 'Unknown') into v_name from public.profiles p where p.id = auth.uid();
  insert into public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  values (auth.uid(), coalesce(v_name, 'Unknown'), 'employee.login_unlinked', 'employee', v_row.id::text,
          jsonb_build_object('employee', v_row.full_name, 'employee_ref', v_row.employee_ref,
                             'login', (select email from auth.users where id = v_was),
                             'user_id', v_was));
end;
$$;

revoke all on function public.login_link_candidates() from public;
revoke all on function public.link_login_to_employee(uuid, uuid) from public;
revoke all on function public.unlink_login_from_employee(uuid) from public;
grant execute on function public.login_link_candidates() to authenticated;
grant execute on function public.link_login_to_employee(uuid, uuid) to authenticated;
grant execute on function public.unlink_login_from_employee(uuid) to authenticated;
