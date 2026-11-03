-- Overtime confirmado que não está no Headcount Board — SÓ LEITURA.
--
-- Porquê: a 01/11 o Yuri Correa recebeu "is coming in" para seg 02/11, 06:00–18:00, e a
-- coluna Overtime do board não o tinha. A base escreve a marcação no board sozinha
-- (overtime_board_apply), mas com `on conflict do nothing`: quem já tinha uma linha nesse
-- dia e turno (dia copiado, importação, ausência) fica com ela e a marcação não aparece.
--
-- Colar no Lovable → More → Cloud → SQL editor e correr. Não escreve nada.
-- Uma linha por marcação confirmada (accepted, sem cancelamento) de hoje em diante que
-- não está a trabalhar no board certo, com o motivo:
--   sem_linha            nada no board para essa pessoa nesse dia/turno
--   linha_<status>       já lá estava como holiday / sick / unpaid / training
--   noutro_board         está, mas no outro turno
-- Vazio = tudo certo. Para pôr alguém no board: o próprio board mostra agora a faixa
-- "booked for overtime and not on this board" com o botão Put in Overtime (PR do 03/11).

with booked as (
  select r.id as response_id, r.employee_id, q.id as request_id,
         q.on_date, q.starts_at, q.ends_at,
         public.overtime_board_shift(q.on_date, q.starts_at) as board_shift,
         case when q.starts_at < time '06:00' then q.on_date - 1 else q.on_date end as board_date
    from public.overtime_responses r
    join public.overtime_requests q on q.id = r.request_id
   where r.decision = 'accepted'
     and q.status <> 'cancelled'
     and q.on_date >= (now() at time zone 'Europe/London')::date - 1
     and not exists (select 1 from public.overtime_outcomes o
                      where o.response_id = r.id and o.outcome <> 'attended')
)
select b.on_date, to_char(b.starts_at, 'HH24:MI') || '–' || to_char(b.ends_at, 'HH24:MI') as horas,
       b.board_date, b.board_shift, e.full_name,
       case
         when here.status is null and other.status is not null then 'noutro_board (' || other.shift || ')'
         when here.status is null then 'sem_linha'
         else 'linha_' || here.status
       end as motivo,
       here.overtime_request_id is not null as linha_e_do_pedido
  from booked b
  join public.employees e on e.id = b.employee_id
  left join public.daily_allocations here
         on here.employee_id = b.employee_id and here.on_date = b.board_date and here.shift = b.board_shift
  left join public.daily_allocations other
         on other.employee_id = b.employee_id and other.on_date = b.board_date and other.shift <> b.board_shift
        and other.status in ('assigned', 'overtime')
 where here.status is null or here.status not in ('assigned', 'overtime')
 order by b.on_date, b.starts_at, e.full_name;
