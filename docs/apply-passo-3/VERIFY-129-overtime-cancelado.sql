-- Verificação do BLOCO 129 — um overtime cancelado sai do "Where I'm working".
--
-- Só lê. Corre num único bloco que termina SEMPRE em erro de propósito: o erro é o
-- relatório (o SQL editor mostra-o), e garante que nada fica — nem a identidade
-- emprestada com `request.jwt.claims`, que de qualquer forma só vive na transacção.
-- Pode correr-se na produção a qualquer hora, antes ou depois de colar o 129.
--
-- O que confirma:
--   1. as três funções são as do BLOCO 129 (md5 do corpo, o mesmo que o teste
--      src/__tests__/thePaste129IsBlock129.test.ts calcula a partir da migração);
--   2. cada pessoa com uma reserva cancelada nos próximos 14 dias, pelos olhos dela
--      (o mesmo `my_attendance` que o telemóvel chama), já não a vê;
--   3. cada pessoa com uma reserva de pé continua a vê-la;
--   4. não há no board nenhuma linha de um pedido para uma reserva cancelada cujo turno
--      ainda não começou.
--
-- Esperado depois de colar o 129: "VERIFY 129: TUDO CERTO". Antes de colar, a 24/10 às
-- 10h, dava 3 funções erradas, 4 reservas canceladas ainda à vista (Rosana 24/10 e 26/10,
-- Karoline 25/10, Marcio 27/10) e 1 linha a mais no board (Karoline, 25/10).
--
-- EN: Read-only; always ends in a deliberate error that carries the report. After BLOCO
-- 129 the first line reads "VERIFY 129: TUDO CERTO".

do $$
declare
  v_from date := (now() at time zone 'Europe/London')::date;
  v_to   date := (now() at time zone 'Europe/London')::date + 13;
  v_log  text := '';
  v_bad  integer := 0;
  v_fp   text;
  v_page jsonb;
  v_n    integer;
  r      record;
begin
  -- 1. As funções.
  for r in
    select * from (values
      ('my_attendance',           'de107103048870fbb68d0ce05000644b'),
      ('overtime_board_apply',    '547063c3c33a4bea8788daffc85ff109'),
      ('record_overtime_outcome', '17682b7205162b14a4c4dcc1d1fb84f6')) v(fn, want)
  loop
    select md5(p.prosrc) into v_fp
      from pg_proc p join pg_namespace n on n.oid = p.pronamespace
     where n.nspname = 'public' and p.proname = r.fn;
    if v_fp is distinct from r.want then
      v_bad := v_bad + 1;
      v_log := v_log || format(E'\nFALHOU  %s não é o do BLOCO 129 (md5 %s)', r.fn, coalesce(v_fp, 'sem função'));
    else
      v_log := v_log || format(E'\nOK      %s é o do BLOCO 129', r.fn);
    end if;
  end loop;

  -- 2 e 3. Pelos olhos de cada pessoa, o que o "Where I'm working" recebe.
  for r in
    select e.user_id, e.full_name, e.employee_ref, q.on_date, q.starts_at, q.ends_at,
           exists (select 1 from public.overtime_outcomes o
                    where o.response_id = s.id
                      and o.outcome in ('cancelled_in_time', 'cancelled_late')) as cancelled
      from public.overtime_responses s
      join public.overtime_requests q on q.id = s.request_id
      join public.employees e on e.id = s.employee_id
     where s.decision = 'accepted' and q.status <> 'cancelled'
       and q.on_date between v_from and v_to
       and e.user_id is not null
     order by cancelled desc, q.on_date, e.full_name
  loop
    perform set_config('request.jwt.claims',
      json_build_object('sub', r.user_id, 'role', 'authenticated')::text, true);
    begin
      v_page := public.my_attendance(v_from, v_to);
    exception when others then
      v_log := v_log || format(E'\nNÃO VISTO  %s (%s) %s — my_attendance recusou: %s',
        r.full_name, coalesce(r.employee_ref, '—'), r.on_date, sqlerrm);
      continue;
    end;
    select count(*) into v_n
      from jsonb_array_elements(coalesce(v_page -> 'overtime', '[]'::jsonb)) x
     where (x ->> 'on_date')::date = r.on_date and (x ->> 'starts_at')::time = r.starts_at;
    if r.cancelled and v_n > 0 then
      v_bad := v_bad + 1;
      v_log := v_log || format(E'\nFALHOU  %s (%s) ainda vê o overtime cancelado de %s, %s–%s',
        r.full_name, coalesce(r.employee_ref, '—'), r.on_date, left(r.starts_at::text, 5), left(r.ends_at::text, 5));
    elsif r.cancelled then
      v_log := v_log || format(E'\nOK      %s (%s) já não vê o cancelado de %s',
        r.full_name, coalesce(r.employee_ref, '—'), r.on_date);
    elsif v_n = 0 then
      v_bad := v_bad + 1;
      v_log := v_log || format(E'\nFALHOU  %s (%s) deixou de ver a reserva de pé de %s',
        r.full_name, coalesce(r.employee_ref, '—'), r.on_date);
    end if;
  end loop;
  select count(*) into v_n
    from public.overtime_responses s
    join public.overtime_requests q on q.id = s.request_id
    join public.employees e on e.id = s.employee_id
   where s.decision = 'accepted' and q.status <> 'cancelled'
     and q.on_date between v_from and v_to and e.user_id is not null
     and not exists (select 1 from public.overtime_outcomes o
                      where o.response_id = s.id
                        and o.outcome in ('cancelled_in_time', 'cancelled_late'));
  v_log := v_log || format(E'\nINFO    %s reservas de pé nos próximos 14 dias, verificadas uma a uma', v_n);

  -- 4. O board.
  for r in
    select e.full_name, e.employee_ref, b.on_date, b.shift
      from public.daily_allocations b
      join public.overtime_responses s on s.request_id = b.overtime_request_id and s.employee_id = b.employee_id
      join public.overtime_outcomes o on o.response_id = s.id and o.outcome in ('cancelled_in_time', 'cancelled_late')
      join public.overtime_requests q on q.id = s.request_id
      join public.employees e on e.id = b.employee_id
     where (q.on_date + q.starts_at) > (now() at time zone 'Europe/London')
  loop
    v_bad := v_bad + 1;
    v_log := v_log || format(E'\nFALHOU  board: %s (%s) ainda conta em %s %s, com a reserva cancelada',
      r.full_name, coalesce(r.employee_ref, '—'), r.on_date, r.shift);
  end loop;

  if v_bad = 0 then
    raise exception 'VERIFY 129: TUDO CERTO (erro de propósito, nada foi alterado)%', v_log;
  end if;
  raise exception 'VERIFY 129: % falha(s) (erro de propósito, nada foi alterado)%', v_bad, v_log;
end $$;
