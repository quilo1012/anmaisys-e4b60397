-- APLICAR-86 — o QR e o botão "Create account" do ecrã de entrada passam a levar o código.
--
-- PORQUÊ ESTE FICHEIRO SOZINHO. A 18/10/2026 o ecrã de entrada em produção pede
-- `rpc/signup_invite_code` e recebe 404: a função não existe, porque o
-- APLICAR-78-a-89.sql nunca foi colado. O ecrã trata o 404 como "não há código" — o QR
-- leva só `/signup` e o campo Invite code chega vazio. O código do frontend está certo
-- desde 11/10; falta isto na base.
--
-- É o BLOCO 86 do pacote, byte a byte (um teste prende-o). Colar o APLICAR-78-a-89.sql
-- mais tarde não faz mal: é `create or replace` e o mesmo texto.
--
-- Como aplicar: Lovable → More → Cloud → SQL editor, colar o ficheiro inteiro, Run.
-- A última linha mostra se o código está disponível ao ecrã de entrada (só diz sim/não,
-- não mostra o código).

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

-- O PostgREST passa a ver a função sem esperar pela próxima recarga da cache.
notify pgrst, 'reload schema';

-- Verificação: true = o ecrã de entrada vai receber um código; false = o registo está
-- fechado, o código expirou ou está vazio (Settings → Sign-up no ecrã de admin).
select public.signup_invite_code() is not null as login_screen_gets_a_code;
