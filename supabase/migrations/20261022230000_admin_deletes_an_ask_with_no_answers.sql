-- Um gestor de overtime pode apagar um pedido que ninguém tocou.
--
-- Pedido sem respostas e sem linhas no quadro: apaga-se. Com respostas ou com pessoas
-- no quadro: recusa-se, e a saída é cancelar, que guarda o registo. Apagar esses
-- deixava horas no quadro sem explicação e perdia quem já tinha dito que sim.
create or replace function public.delete_overtime_ask(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.can_manage_overtime(auth.uid()) then
    raise exception 'Only an overtime manager can delete an ask' using errcode = '42501';
  end if;
  if exists (select 1 from public.overtime_responses where request_id = p_request_id)
     or exists (select 1 from public.daily_allocations where overtime_request_id = p_request_id) then
    raise exception 'This ask has answers or people on the board. Cancel it instead.' using errcode = 'P0001';
  end if;
  delete from public.overtime_requests where id = p_request_id;
  if not found then
    raise exception 'This overtime ask no longer exists.' using errcode = 'P0002';
  end if;
end;
$$;

revoke all on function public.delete_overtime_ask(uuid) from public, anon;
grant execute on function public.delete_overtime_ask(uuid) to authenticated;
