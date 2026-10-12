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
