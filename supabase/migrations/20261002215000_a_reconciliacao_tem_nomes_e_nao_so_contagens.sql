-- A reconciliacao board <-> relogio, com nomes em vez de contagens.
--
-- `v_board_clock_status` ja responde "quantos discordam neste dia e neste board".
-- Esta responde "quem", e e read-only de proposito: board e relogio sao duas verdades
-- separadas e nenhuma corrige a outra. Nao ha aqui nada que sincronize, repare ou
-- substitua -- e a decisao de 02/10/2026.
--
-- A REGRA E A MESMA, LITERALMENTE. As duas primeiras ramificacoes sao
-- `no_board_sem_horas` e `picou_fora_do_board` da vista de contagem, com as linhas no
-- lugar do `count(*)`. Isso e o ponto: o detalhe tem de somar exactamente ao numero
-- que o badge mostra, ou o ecra e o badge dizem coisas diferentes sobre o mesmo dia,
-- que e a falha que este modulo ja cometeu duas vezes. Verificado nos 123 pares
-- (on_date, shift): 712 = 712, zero desacordos.
--
-- Tres sentidos, e o terceiro nao e uma divergencia:
--
--   planned_not_clocked   no board, conhecido do relogio, e nao picou
--   clocked_not_planned   picou, e deste board, e nao esta no board
--   not_comparable        no board, e o relogio nunca o viu
--
-- O terceiro existe porque sem ele os outros dois nao se podem ler. 113 dos 211
-- activos nao tem registo nenhum no relogio, e 62 dos 64 da crew da noite -- por isso
-- "zero divergencias" na noite nao quer dizer que o board estava certo, quer dizer que
-- nao havia ninguem para comparar. Contar essa gente como divergencia seria acusar
-- alguem de faltar com base numa linha que nunca existiu; esconde-la seria deixar o
-- numero parecer solido. Fica a vista, fora da conta.
--
-- Dias sem relogio nenhum nao entram: nao ha comparacao a fazer, e o badge conta 0 por
-- essa mesma razao. 30 dos 82 dias de board estao nesse caso.

create or replace view public.v_board_clock_reconciliation
with (security_invoker = true) as
with dias as (
  select distinct on_date, shift from daily_allocations
),
-- Quem alguma vez apareceu no relogio, e nao quem picou nesse dia. A ausencia de uma
-- linha so diz alguma coisa sobre quem o relogio conhece.
cobertos as (select distinct employee_id from attendance_days),
crew as (
  select id as employee_id,
         case when shift_group = 'Night' then 'Night' else 'Day' end as board
  from employees where active
),
com_relogio as (select on_date, count(*) n from attendance_days group by on_date),
board as (
  select da.on_date, da.shift, da.employee_id, da.status
  from daily_allocations da
  where da.status in ('assigned','overtime')
)
select b.on_date, b.shift, b.employee_id,
       'planned_not_clocked'::text as kind,
       b.status as board_status,
       coalesce(ad.worked_minutes, 0)::int as worked_minutes
from board b
join com_relogio cr on cr.on_date = b.on_date
join cobertos c on c.employee_id = b.employee_id
left join attendance_days ad on ad.on_date = b.on_date and ad.employee_id = b.employee_id
where coalesce(ad.worked_minutes, 0) = 0

union all

select d.on_date, d.shift, ad.employee_id,
       'clocked_not_planned'::text,
       null::text,
       ad.worked_minutes::int
from dias d
join com_relogio cr on cr.on_date = d.on_date
join attendance_days ad on ad.on_date = d.on_date and coalesce(ad.worked_minutes,0) > 0
join crew cw on cw.employee_id = ad.employee_id and cw.board = d.shift
where not exists (
  select 1 from board b
  where b.on_date = d.on_date and b.shift = d.shift and b.employee_id = ad.employee_id
)

union all

select b.on_date, b.shift, b.employee_id,
       'not_comparable'::text,
       b.status,
       null::int
from board b
join com_relogio cr on cr.on_date = b.on_date
where not exists (select 1 from cobertos c where c.employee_id = b.employee_id);

revoke all on public.v_board_clock_reconciliation from public, anon;
grant select on public.v_board_clock_reconciliation to authenticated;

comment on view public.v_board_clock_reconciliation is
  'Quem discorda entre o board e o relogio, por dia e por board. Read-only: as duas fontes sao separadas e nenhuma corrige a outra. As duas primeiras kinds somam ao differs de v_board_clock_status; not_comparable fica de fora da conta de proposito.';
