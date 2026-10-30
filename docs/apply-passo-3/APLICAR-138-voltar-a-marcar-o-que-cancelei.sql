-- APLICAR 138 — uma marcação cancelada a tempo pode ser marcada outra vez por quem a cancelou.
--
-- PT: Colar no SQL editor do PMSYSTEM (More → Cloud → SQL editor), o ficheiro inteiro.
-- É o BLOCO 138 do APPLY-ALL-IN-ORDER.sql, byte a byte. Não depende do 137 nem do 128.
--
-- Porquê: a 27/10 a Rosana (E129) marcou seg 02/11, 06:00–18:00, e cancelou-a ela própria
-- doze minutos depois, a tempo. A 29/10 quis ir afinal, e o cartão só dizia "Cancelled by
-- you", sem nada para carregar: um cancelamento guarda decision = 'accepted' como registo
-- do que foi combinado, e o answer_overtime recusa qualquer resposta com uma decisão.
--
-- O que muda: cria UMA função nova, rebook_my_overtime. Não altera nenhuma das existentes,
-- nem tabelas, políticas ou dados. Só desfaz um cancelamento feito pela própria pessoa, a
-- tempo, num pedido aberto que ainda não começou; depois o sim passa pelo answer_overtime
-- com todas as verificações de sempre (equipa, bloqueio, rota, descanso, capacidade). Um
-- cancelamento tardio, ou registado pelo supervisor, mantém-se. Pode colar-se duas vezes.
--
-- Depois de colar: correr VERIFY-138-voltar-a-marcar.sql (só lê) e
-- supabase/tests/a_booking_cancelled_in_time_can_be_taken_back_test.sql (desfaz tudo no fim).
--
-- EN: Paste the whole file; it is BLOCO 138. It adds one function, rebook_my_overtime, and
-- changes nothing else. Then run VERIFY-138-voltar-a-marcar.sql.

-- ================================================================
-- BLOCO 138
-- 20261029230000_a_booking_cancelled_in_time_can_be_taken_back.sql
-- ================================================================
-- A booking the employee cancelled in time can be taken back by them, while the ask is open.
--
-- WHAT HAPPENED. 27/10/2026 10:41: Rosana (E129) said yes to Mon 02/11, 06:00–18:00 and
-- was booked. At 10:53 she cancelled it herself, in time (cancelled_in_time). On 29/10
-- she wanted to go after all, and My Overtime had nothing to press: the card read
-- "Cancelled by you", and answer_overtime refuses any answer once a decision stands —
-- a cancellation keeps decision = 'accepted' on purpose, as the record of what was
-- agreed (BLOCO 129). There was no way back short of asking a supervisor.
--
-- THE RULE. Only what the cancellation rules already treat as free can be undone by
-- the employee:
--   * a cancellation they made themselves (overtime_outcomes.recorded_by is their login).
--     One a supervisor recorded stays theirs to undo, from the desk;
--   * made in time. A late cancellation stands: it is what the late-cancel block counts,
--     and taking the booking back must not wipe it;
--   * on an ask that is open and has not started.
-- Then the yes goes through answer_overtime and every check a first yes meets: crew and
-- department, the no-show / late-cancel block, rota clash, rest between shifts, not
-- started, capacity under the ask's row lock — and, once BLOCO 128 is in, overlap with
-- another booking. It comes back booked if a place is free, otherwise on the reserve
-- list, never confirmed past the headcount. If anything refuses, nothing is changed: the
-- whole call is one transaction, so the cancellation is still there.
--
-- WHAT IT WRITES. The booking is removed and made again, so the audit reads, in order:
-- answered_no and removed_from_overtime (the cancelled booking cleared), outcome_removed
-- (the cancellation, with who recorded it and when, kept in old_value), then answered_yes
-- and assigned / placed_on_reserve. The original yes and the cancellation stay in
-- overtime_audit; nothing is deleted from it.
--
-- NOT CHANGED: answer_overtime, cancel_my_overtime, leave_my_reserve, record_overtime_outcome,
-- the board bridge and the bells. Their own triggers do what they always do with a booking
-- that is removed and made again (the board row comes back, the supervisor is told "is
-- coming in", reminders are planned again).
--
-- Idempotent: create or replace.

create or replace function public.rebook_my_overtime(p_request_id uuid)
returns public.overtime_responses
language plpgsql security definer set search_path = public
as $$
declare
  v_emp     uuid := public.my_employee_id();
  v_resp    public.overtime_responses;
  v_outcome public.overtime_outcomes;
  v_req     public.overtime_requests;
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

  select * into v_outcome from public.overtime_outcomes where response_id = v_resp.id for update;
  if v_resp.decision is distinct from 'accepted'
     or v_outcome.outcome is null
     or v_outcome.outcome not in ('cancelled_in_time', 'cancelled_late') then
    raise exception 'Only a booking you cancelled can be booked again this way' using errcode = 'P0001';
  end if;
  if v_outcome.recorded_by is distinct from auth.uid() then
    raise exception 'Your supervisor cancelled this booking. Message them if you can still come.'
      using errcode = 'P0001';
  end if;
  if v_outcome.outcome = 'cancelled_late' then
    raise exception 'You cancelled this late, so the cancellation stands. Message your supervisor if you can still come.'
      using errcode = 'P0001';
  end if;

  -- Said here, before anything is cleared, so the person reads the reason and not a guard's.
  select * into v_req from public.overtime_requests where id = p_request_id for update;
  if v_req.id is null or v_req.status <> 'open' then
    raise exception 'This overtime is no longer open' using errcode = 'P0001';
  end if;
  if (v_req.on_date + v_req.starts_at) <= (now() at time zone 'Europe/London') then
    raise exception 'This overtime has already started' using errcode = 'P0001';
  end if;

  -- The cancelled booking is cleared: a plain no, as leaving the reserve is (BLOCO 137).
  update public.overtime_responses
     set answer = 'no', decision = null, decided_at = null, decided_by = null
   where id = v_resp.id;
  delete from public.overtime_outcomes where response_id = v_resp.id;

  -- And the yes again, through the one door every yes uses.
  return public.answer_overtime(p_request_id, 'yes');
end;
$$;

revoke all on function public.rebook_my_overtime(uuid) from public, anon;
grant execute on function public.rebook_my_overtime(uuid) to authenticated;

notify pgrst, 'reload schema';
