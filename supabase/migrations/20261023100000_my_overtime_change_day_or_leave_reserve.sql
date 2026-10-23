-- Duas coisas que a pessoa pode fazer sozinha com a sua propria reserva de overtime.
--
-- 1. swap_my_overtime(p_from, p_to): trocar de dia. Tudo ou nada, numa transaccao:
--    responde "sim" ao pedido novo (answer_overtime) e, so se ficar confirmado,
--    cancela o antigo (cancel_my_overtime, com a mesma regra de em tempo/tarde).
--    Se o pedido novo ficar por decidir pelo supervisor, ou estiver cheio ate
--    a reserva, levanta excepcao e nada e' cancelado.
--
-- 2. leave_my_reserve(p_request_id): sair da lista de reserva. Nao e' cancelamento:
--    nao ha turno marcado, por isso nao toca no quadro nem conta como falta.
--    Guarda answer = 'no' (a pessoa deixou de querer), que e' sempre permitido.

create or replace function public.swap_my_overtime(p_from uuid, p_to uuid, p_note text default null)
returns table(outcome text, promoted_response_id uuid, promoted_employee_id uuid)
language plpgsql security definer set search_path = public
as $$
declare
  v_emp      uuid := public.my_employee_id();
  v_resp     public.overtime_responses;
  v_new      public.overtime_responses;
begin
  if v_emp is null then
    raise exception 'Your login is not linked to an employee record' using errcode = '42501';
  end if;
  if p_from = p_to then
    raise exception 'Pick a different day' using errcode = 'P0001';
  end if;

  select * into v_resp from public.overtime_responses
   where request_id = p_from and employee_id = v_emp;
  if v_resp.id is null or v_resp.decision is distinct from 'accepted' then
    raise exception 'Only a confirmed booking can be moved' using errcode = '42501';
  end if;

  -- Responde ao dia novo como qualquer outra resposta (valida bloqueios e pertenca).
  perform public.answer_overtime(p_to, 'yes');
  select * into v_new from public.overtime_responses
   where request_id = p_to and employee_id = v_emp;
  if v_new.decision is distinct from 'accepted' then
    raise exception 'The new day is not confirmed yet, so your current booking was kept'
      using errcode = 'P0001';
  end if;

  return query select * from public.cancel_my_overtime(p_from, coalesce(p_note, 'Troca de dia'));
end;
$$;

revoke all on function public.swap_my_overtime(uuid, uuid, text) from public;
grant execute on function public.swap_my_overtime(uuid, uuid, text) to authenticated;

create or replace function public.leave_my_reserve(p_request_id uuid)
returns void
language plpgsql security definer set search_path = public
as $$
declare
  v_emp uuid := public.my_employee_id();
  v_resp public.overtime_responses;
begin
  if v_emp is null then
    raise exception 'Your login is not linked to an employee record' using errcode = '42501';
  end if;
  select * into v_resp from public.overtime_responses
   where request_id = p_request_id and employee_id = v_emp
   for update;
  if v_resp.id is null then
    raise exception 'You have no answer on this overtime ask' using errcode = '42501';
  end if;
  if v_resp.decision is distinct from 'reserve' then
    raise exception 'Only a place on the reserve list can be left this way' using errcode = '42501';
  end if;
  update public.overtime_responses set answer = 'no' where id = v_resp.id;
end;
$$;

revoke all on function public.leave_my_reserve(uuid) from public;
grant execute on function public.leave_my_reserve(uuid) to authenticated;
