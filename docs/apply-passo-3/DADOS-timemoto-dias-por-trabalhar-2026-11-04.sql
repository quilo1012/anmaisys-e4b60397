-- DADOS (não é um BLOCO) — tirar os dias do TimeMoto que foram importados antes de acontecer.
--
-- ================================================================
-- JÁ APLICADO a 04/11/2026 (sondado: restantes = 0, 990 linhas no backup).
-- NÃO COLAR DE NOVO. Depois do próximo import do TimeMoto, os dias a partir de 03/11
-- sem nada registado são faltas VERDADEIRAS, e este script apagava-as. Por isso o
-- bloco de baixo recusa correr quando o backup já existe.
-- ================================================================
--
-- PT: Era para colar no SQL editor do PMSYSTEM (More → Cloud → SQL editor), uma vez.
-- Não é uma migração: é uma limpeza de dados feita uma vez.
--
-- Porquê: o import de 02/11/2026 trouxe o período inteiro do TimeMoto, até 08/11. Os
-- dias ainda por trabalhar vinham com o horário e zero trabalhado, que é exatamente o
-- aspeto de uma falta. A My Attendance mostrou ~165 pessoas "Absent" de 3 a 8/11 (o
-- board dizia que estavam a trabalhar) e somou 12 h "short" por cada turno ainda por vir.
-- Lido em produção a 04/11: 990 linhas destas, de 03/11 a 08/11, todas source = timemoto.
-- O import já não as escreve (PR "TimeMoto days not worked yet are not absences").
--
-- O que faz: copia essas linhas para _bkp_attendance_days_20261104 e só depois as apaga.
-- Apaga APENAS dias de 03/11 em diante sem entrada, sem saída, sem minutos trabalhados e
-- sem ausência. Um dia com qualquer registo fica. O próximo import do TimeMoto, feito
-- depois desses dias, traz o registo verdadeiro.
--
-- EN: One-off data fix. Backs up, then deletes attendance_days rows from 2026-11-03 on
-- that hold only a schedule (no clock-in/out, no worked minutes, no absence).

do $$
begin
  if to_regclass('public._bkp_attendance_days_20261104') is not null then
    raise exception 'Já aplicado a 04/11/2026 — não colar de novo (apagaria faltas verdadeiras).';
  end if;
end $$;

create table public._bkp_attendance_days_20261104 as
  select * from public.attendance_days where false;

insert into public._bkp_attendance_days_20261104
select d.* from public.attendance_days d
 where d.on_date >= date '2026-11-03'
   and d.source = 'timemoto'
   and coalesce(d.worked_minutes, 0) = 0
   and d.absence_name is null
   and d.start_time is null
   and d.end_time is null
   and not exists (select 1 from public._bkp_attendance_days_20261104 b where b.id = d.id);

delete from public.attendance_days d
 where d.on_date >= date '2026-11-03'
   and d.source = 'timemoto'
   and coalesce(d.worked_minutes, 0) = 0
   and d.absence_name is null
   and d.start_time is null
   and d.end_time is null;

-- O backup fica fora da API.
revoke all on public._bkp_attendance_days_20261104 from anon, authenticated;
alter table public._bkp_attendance_days_20261104 enable row level security;

-- Deu, a 04/11/2026: no backup 990; restantes 0.
select (select count(*) from public._bkp_attendance_days_20261104) as no_backup,
       (select count(*) from public.attendance_days d
         where d.on_date >= date '2026-11-03' and d.source = 'timemoto'
           and coalesce(d.worked_minutes, 0) = 0 and d.absence_name is null
           and d.start_time is null and d.end_time is null) as restantes;
