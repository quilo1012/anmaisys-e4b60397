-- DADOS — junta três registos duplicados de pessoas no registo activo de cada uma.
-- Não é uma migração: corre uma vez, no SQL editor do Lovable (More -> Cloud -> SQL editor).
--
-- Decidido pelo dono a 12/10/2026: são a mesma pessoa.
--   Ketlyn         (138bbce4, inactivo desde 12/10) -> Ketlyn Amorin    (ace3c8a4)
--   FELIPE ARAUJO  (2d8b9bab, inactivo desde 12/10) -> FELIPE DE ARAUJO (1a221d70)
--   Vitor Dantos   (97dacdd6, inactivo desde 11/10) -> Vitor Dantas     (7f4b2d1a)
--
-- Porquê: os três registos antigos foram desactivados sem levar consigo as marcações.
-- O board só desenha pessoas activas, por isso esses dias ficaram sem a pessoa. Por
-- exemplo, o Vitor desapareceu do Day board de 2 a 11/10 e o Felipe do Night de 1/10.
--
-- O que muda, nas quatro tabelas onde o registo antigo aparece (contado a 12/10):
--   daily_allocations    19 + 7 + 23  -> passam para o registo activo
--   employee_attendance  19 + 8 + 23  -> idem
--   attendance_days       0 + 0 + 63  -> idem (TimeMoto do Vitor)
--   leave_requests        0 + 1 + 0   -> idem (a folga aprovada do Felipe a 14/09)
-- employee_shift_history fica onde está: descreve o registo antigo, e o activo tem o seu.
--
-- Quando as duas pessoas têm uma linha no mesmo dia e no mesmo turno, fica uma só:
--   Ketlyn 11/10 Day e 12/10 Day, Vitor 11/10 Day: as duas linhas dizem o mesmo
--     (mesmo estado, mesma coluna). Fica a do registo activo; o sheet_name do antigo
--     passa para ela se ela não tiver nenhum.
--   Felipe 14/09 Night: o antigo diz "holiday", com uma folga APROVADA a 10/09 03:51; o
--     activo diz "assigned Line 2", feito 12 minutos depois. Não há marcação do TimeMoto
--     nessa noite. Decisão do dono: fica a folga. Sai a linha da Line 2 e o "present".
--   Felipe 09/08: a presença diz "present" nos dois. Fica a do activo.
--
-- Cada linha apagada fica copiada, inteira, num registo de audit_logs
-- (action = 'employee_records_merged'), um por pessoa. Nada se perde sem rasto.
--
-- PÁRA SEM MUDAR NADA se a base já não estiver como foi revista a 12/10: um registo em
-- falta, o antigo reactivado, ou um número diferente de dias em conflito. O board é
-- editado ao mesmo tempo que isto se prepara. Se parar, não forçar: pedir nova revisão.
--
-- Tudo numa transacção: ou fica tudo, ou não fica nada.

begin;

create temp table merge_pair (
  old_id uuid primary key,
  new_id uuid not null unique,
  label  text not null
) on commit drop;

insert into merge_pair values
  ('138bbce4-3331-4ad6-9282-2ca740800dca', 'ace3c8a4-c2be-437c-8ae9-c901ff62aa6b', 'Ketlyn -> Ketlyn Amorin'),
  ('2d8b9bab-fe33-40e5-9fbd-e0738cdcf072', '1a221d70-5322-45aa-83f9-292d1e616713', 'FELIPE ARAUJO -> FELIPE DE ARAUJO'),
  ('97dacdd6-c902-479b-a41c-367e6244d5cb', '7f4b2d1a-5ae3-4601-a413-d8da45c22a7f', 'Vitor Dantos -> Vitor Dantas');

-- The one conflict the owner settled against the active record.
create temp table old_wins (old_id uuid, on_date date) on commit drop;
insert into old_wins values ('2d8b9bab-fe33-40e5-9fbd-e0738cdcf072', '2026-09-14');

-- ---------------------------------------------------------------------------
-- 0. Is the database still the one that was reviewed?
-- ---------------------------------------------------------------------------
do $$
declare
  r record;
  n int;
begin
  select count(*) into n
    from merge_pair p
    join public.employees o  on o.id  = p.old_id
    join public.employees nw on nw.id = p.new_id;
  if n <> 3 then
    raise exception 'PAROU: % de 3 pares encontrados. Nada mudou.', n;
  end if;

  select count(*) into n
    from public.daily_allocations a join merge_pair p on a.employee_id = p.old_id;
  if n = 0 then
    raise exception 'JÁ FOI APLICADO: os registos antigos já não têm marcações. Nada mudou.';
  end if;

  for r in
    select p.label, o.active as old_active, nw.active as new_active
      from merge_pair p
      join public.employees o  on o.id  = p.old_id
      join public.employees nw on nw.id = p.new_id
  loop
    if r.old_active or not r.new_active then
      raise exception 'PAROU: % — o antigo tem de estar inactivo e o novo activo. Nada mudou.', r.label;
    end if;
  end loop;

  select count(*) into n
    from public.daily_allocations a
    join merge_pair p on a.employee_id = p.old_id
    join public.daily_allocations b
      on b.employee_id = p.new_id and b.on_date = a.on_date and b.shift = a.shift;
  if n <> 4 then
    raise exception 'PAROU: % dias em conflito no board, foram revistos 4. O board mudou desde 12/10. Nada mudou.', n;
  end if;

  select count(*) into n
    from public.employee_attendance a
    join merge_pair p on a.employee_id = p.old_id
    join public.employee_attendance b
      on b.employee_id = p.new_id and b.on_date = a.on_date;
  if n <> 4 then
    raise exception 'PAROU: % dias em conflito na presença, foram revistos 4. Nada mudou.', n;
  end if;

  select count(*) into n
    from public.attendance_days a
    join merge_pair p on a.employee_id = p.old_id
    join public.attendance_days b
      on b.employee_id = p.new_id and b.on_date = a.on_date;
  if n <> 0 then
    raise exception 'PAROU: % dias do TimeMoto nos dois registos, foram revistos 0. Nada mudou.', n;
  end if;
end $$;

-- ---------------------------------------------------------------------------
-- 1. Which row of each conflicting pair goes
-- ---------------------------------------------------------------------------
create temp table drop_alloc on commit drop as
select case when w.old_id is not null then b.id else a.id end as id
  from public.daily_allocations a
  join merge_pair p on a.employee_id = p.old_id
  join public.daily_allocations b
    on b.employee_id = p.new_id and b.on_date = a.on_date and b.shift = a.shift
  left join old_wins w on w.old_id = p.old_id and w.on_date = a.on_date;

create temp table drop_att on commit drop as
select case when w.old_id is not null then b.id else a.id end as id
  from public.employee_attendance a
  join merge_pair p on a.employee_id = p.old_id
  join public.employee_attendance b
    on b.employee_id = p.new_id and b.on_date = a.on_date
  left join old_wins w on w.old_id = p.old_id and w.on_date = a.on_date;

-- The active record's row stays; it keeps the sheet's spelling if it had none.
update public.daily_allocations b
   set sheet_name = a.sheet_name
  from public.daily_allocations a
  join merge_pair p on a.employee_id = p.old_id
 where b.employee_id = p.new_id and b.on_date = a.on_date and b.shift = a.shift
   and b.sheet_name is null and a.sheet_name is not null
   and b.id not in (select id from drop_alloc);

-- ---------------------------------------------------------------------------
-- 2. The audit trail, before anything is deleted or moved
-- ---------------------------------------------------------------------------
insert into public.audit_logs (action, entity_type, entity_id, user_name, details)
select 'employee_records_merged', 'employee', p.new_id::text,
       'SQL editor: DADOS-juntar-3-duplicados.sql',
       jsonb_build_object(
         'from_employee_id', p.old_id,
         'from_name', o.full_name,
         'into_name', nw.full_name,
         'decided', 'Owner, 12/10/2026: same person. Felipe 14/09: the approved holiday stands.',
         'allocations_moved', (select coalesce(jsonb_agg(a.id order by a.on_date), '[]'::jsonb)
                                 from public.daily_allocations a
                                where a.employee_id = p.old_id
                                  and a.id not in (select id from drop_alloc)),
         'allocations_dropped', (select coalesce(jsonb_agg(to_jsonb(a) order by a.on_date), '[]'::jsonb)
                                   from public.daily_allocations a
                                  where a.employee_id in (p.old_id, p.new_id)
                                    and a.id in (select id from drop_alloc)),
         'attendance_moved', (select count(*) from public.employee_attendance a
                               where a.employee_id = p.old_id and a.id not in (select id from drop_att)),
         'attendance_dropped', (select coalesce(jsonb_agg(to_jsonb(a) order by a.on_date), '[]'::jsonb)
                                  from public.employee_attendance a
                                 where a.employee_id in (p.old_id, p.new_id)
                                   and a.id in (select id from drop_att)),
         'timemoto_days_moved', (select count(*) from public.attendance_days a where a.employee_id = p.old_id),
         'leave_requests_moved', (select coalesce(jsonb_agg(l.id), '[]'::jsonb)
                                    from public.leave_requests l where l.employee_id = p.old_id)
       )
  from merge_pair p
  join public.employees o  on o.id  = p.old_id
  join public.employees nw on nw.id = p.new_id;

-- ---------------------------------------------------------------------------
-- 3. Drop the losing rows, then move everything else across
-- ---------------------------------------------------------------------------
delete from public.daily_allocations   where id in (select id from drop_alloc);
delete from public.employee_attendance where id in (select id from drop_att);

update public.daily_allocations a   set employee_id = p.new_id from merge_pair p where a.employee_id = p.old_id;
update public.employee_attendance a set employee_id = p.new_id from merge_pair p where a.employee_id = p.old_id;
update public.attendance_days a     set employee_id = p.new_id from merge_pair p where a.employee_id = p.old_id;
update public.leave_requests l      set employee_id = p.new_id from merge_pair p where l.employee_id = p.old_id;

commit;

-- ---------------------------------------------------------------------------
-- 4. What it did. Expected: every "left_on_old" column 0, and the totals
--    Ketlyn Amorin 22 board days, FELIPE DE ARAUJO 45, Vitor Dantas 24.
-- ---------------------------------------------------------------------------
select nw.full_name,
       (select count(*) from public.daily_allocations   where employee_id = p.old_id) as board_left_on_old,
       (select count(*) from public.employee_attendance where employee_id = p.old_id) as attendance_left_on_old,
       (select count(*) from public.attendance_days     where employee_id = p.old_id) as timemoto_left_on_old,
       (select count(*) from public.leave_requests      where employee_id = p.old_id) as leave_left_on_old,
       (select count(*) from public.daily_allocations   where employee_id = p.new_id) as board_days_now
  from (values
    ('138bbce4-3331-4ad6-9282-2ca740800dca'::uuid, 'ace3c8a4-c2be-437c-8ae9-c901ff62aa6b'::uuid),
    ('2d8b9bab-fe33-40e5-9fbd-e0738cdcf072'::uuid, '1a221d70-5322-45aa-83f9-292d1e616713'::uuid),
    ('97dacdd6-c902-479b-a41c-367e6244d5cb'::uuid, '7f4b2d1a-5ae3-4601-a413-d8da45c22a7f'::uuid)
  ) as p(old_id, new_id)
  join public.employees nw on nw.id = p.new_id
 order by nw.full_name;
