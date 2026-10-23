-- Um "sim" não pode caber em horas que a pessoa já tem marcadas.
--
-- Antes, um employee confirmado das 06:00 às 18:00 podia responder "sim" a um
-- pedido das 06:00 às 14:00 no mesmo dia. O ecrã já esconde esses pedidos, mas a
-- base de dados aceitava o sim. Esta verificação fecha isso no servidor.
--
-- Conta como marcada uma resposta com decision = 'accepted' que não tenha sido
-- cancelada (overtime_outcomes com cancelled_in_time / cancelled_late). Um pedido
-- que acaba depois da meia-noite vai até ao dia seguinte, como no ecrã.
-- Um "não" continua sempre permitido.
--
-- O resto da função fica igual ao que está em produção.

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
  v_s       timestamp;
  v_e       timestamp;
  v_clash   text;
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

  if p_answer = 'yes' then
    select * into v_block from public.overtime_block_for(v_emp);
    if v_block.blocked_until is not null then
      raise exception 'You can''t sign up for overtime until %. (Missed overtime on %.)',
        to_char(v_block.blocked_until, 'DD/MM'), to_char(v_block.on_date, 'DD/MM')
        using errcode = 'P0001';
    end if;

    -- Horas já marcadas que se sobrepõem a este pedido.
    v_s := v_req.on_date + v_req.starts_at;
    v_e := v_req.on_date + v_req.ends_at
           + case when v_req.ends_at <= v_req.starts_at then interval '1 day' else interval '0' end;
    select to_char(o.on_date, 'DD/MM') || ' ' || to_char(o.starts_at, 'HH24:MI') || '–' || to_char(o.ends_at, 'HH24:MI')
      into v_clash
      from public.overtime_responses r
      join public.overtime_requests o on o.id = r.request_id
     where r.employee_id = v_emp
       and r.decision = 'accepted'
       and o.id <> p_request_id
       and not exists (select 1 from public.overtime_outcomes oc
                        where oc.response_id = r.id
                          and oc.outcome in ('cancelled_in_time', 'cancelled_late'))
       and (o.on_date + o.starts_at) < v_e
       and (o.on_date + o.ends_at
            + case when o.ends_at <= o.starts_at then interval '1 day' else interval '0' end) > v_s
     limit 1;
    if v_clash is not null then
      raise exception 'You are already booked for overtime on %. This one overlaps it.', v_clash
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
                answered_for_date      = excluded.answered_for_date,
                answered_for_starts_at = excluded.answered_for_starts_at,
                answered_for_ends_at   = excluded.answered_for_ends_at
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.answer_overtime(uuid, text) from public;
grant execute on function public.answer_overtime(uuid, text) to authenticated;
