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
