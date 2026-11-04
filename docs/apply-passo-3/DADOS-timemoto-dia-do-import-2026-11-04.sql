-- TimeMoto: o dia do import (e depois) sem nada picado não é uma falta. 04/11/2026.
--
-- PORQUÊ. O TimeMoto exporta o período inteiro: um dia que ainda não aconteceu, ou o
-- próprio dia do import antes de a pessoa picar, vem com o horário e nada trabalhado,
-- igual a uma falta. O import de 02/11 gravou assim 2 a 8 de novembro. A limpeza
-- DADOS-timemoto-dias-por-trabalhar-2026-11-04.sql apagou de 03/11 em diante, mas o
-- próprio dia 02/11 ficou: Wilton Azevedo (e quem mais não tinha picado à hora da
-- exportação) aparece "Absent" em My Attendance enquanto o board o tinha a trabalhar.
--
-- A REGRA (do dono, 04/11): até ao dia do import vale o TimeMoto; daí em diante, o que
-- não foi picado vale o board. O import já faz isto desde 66a02f68. Isto acerta o que
-- ficou gravado antes.
--
-- O QUE APAGA. Só linhas do TimeMoto, de imports desde 02/11, cuja data é o dia do
-- import ou depois, sem entrada, sem saída, sem minutos e sem ausência. Uma linha com
-- entrada, saída, minutos ou ausência fica. Dias anteriores ao dia do import ficam
-- (são faltas registadas). Cópia de segurança primeiro, numa tabela fechada.
--
-- Colar uma vez. A segunda vez pára sozinha.

do $$
begin
  if to_regclass('public._bkp_attendance_days_20261104_dia_import') is not null then
    raise exception 'Já aplicado — não colar de novo.';
  end if;
end $$;

create table public._bkp_attendance_days_20261104_dia_import as
  select d.* from public.attendance_days d
   where d.source = 'timemoto'
     and d.imported_at >= timestamptz '2026-11-02 00:00:00 Europe/London'
     and d.on_date >= (d.imported_at at time zone 'Europe/London')::date
     and coalesce(d.worked_minutes, 0) = 0
     and d.absence_name is null
     and d.start_time is null
     and d.end_time is null;

revoke all on public._bkp_attendance_days_20261104_dia_import from anon, authenticated;
alter table public._bkp_attendance_days_20261104_dia_import enable row level security;

delete from public.attendance_days d
 using public._bkp_attendance_days_20261104_dia_import b
 where d.id = b.id;

-- Resultado: quantas linhas saíram, por dia, e quantas pessoas.
select 'apagadas' as o_que, b.on_date::text as dia, count(*) as linhas, count(distinct b.employee_id) as pessoas
  from public._bkp_attendance_days_20261104_dia_import b
 group by b.on_date
union all
select 'restam (deve ser 0)', null, count(*), count(distinct d.employee_id)
  from public.attendance_days d
 where d.source = 'timemoto'
   and d.imported_at >= timestamptz '2026-11-02 00:00:00 Europe/London'
   and d.on_date >= (d.imported_at at time zone 'Europe/London')::date
   and coalesce(d.worked_minutes, 0) = 0
   and d.absence_name is null and d.start_time is null and d.end_time is null
order by 1, 2;
