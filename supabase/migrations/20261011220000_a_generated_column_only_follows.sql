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
