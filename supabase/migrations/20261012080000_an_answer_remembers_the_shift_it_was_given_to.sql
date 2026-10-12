-- Uma resposta passa a lembrar-se do turno a que foi dada.
--
-- As horas de um pedido são escritas à mão em dois campos `type="time"`. Não há conta
-- nenhuma a derivá-las, por isso um engano fica lá: a 13/10/2026 havia um pedido para
-- as 18:00-14:00 -- vinte horas -- onde era 18:00-06:00. Corrigi-lo obrigava a cancelar
-- o pedido e a recomeçar, e com ele iam embora os sins verdadeiros.
--
-- A partir daqui corrigir é permitido e NAO apaga respostas. Quem ja tinha respondido
-- fica assinalado, para o supervisor saber a quem tem de ligar. Para isso a resposta
-- tem de saber a que turno foi dada, porque o pedido ja nao sabe -- foi ele que mudou.
--
-- TRES COLUNAS E NAO UMA FRASE. Guardar "13/10 18:00-06:00" como texto obrigava a base
-- e o ecra a escrever a hora da mesma maneira para sempre; na primeira vez que um
-- devolvesse 06:00:00 e o outro 06:00, TODA a gente aparecia como tendo respondido a
-- outro turno e o aviso deixava de querer dizer alguma coisa. Comparar campo a campo
-- nao tem esse problema.
--
-- As respostas que ja existem ficam com null, e null quer dizer "nao se sabe", nao
-- "igual". O ecra nao assinala nada nesse caso -- ver `answeredForDifferentHours`.
-- Nao e feito backfill: inventar que uma resposta antiga foi dada ao turno actual era
-- afirmar precisamente aquilo que estas colunas existem para nao ter de adivinhar.

alter table public.overtime_responses
  add column if not exists answered_for_date       date,
  add column if not exists answered_for_starts_at  time,
  add column if not exists answered_for_ends_at    time;

comment on column public.overtime_responses.answered_for_date is
  'O turno que a pessoa tinha a frente quando respondeu. Null nas respostas anteriores '
  'a 20261012080000, e null quer dizer "nao se sabe". Ver staleOvertimeAnswer.ts.';

-- O `answer_overtime` ja tem a linha do pedido carregada em v_req, por isso isto e so
-- dizer-lhe que a guarde. O resto da funcao fica como estava em 20261007090000.
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

  -- Who the answerer is, as the ask measures them.
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
  -- A "no" is always allowed: it is information, not a request.
  if p_answer = 'yes' then
    select * into v_block from public.overtime_block_for(v_emp);
    if v_block.blocked_until is not null then
      raise exception 'You can''t sign up for overtime until %. (Missed overtime on %.)',
        to_char(v_block.blocked_until, 'DD/MM'), to_char(v_block.on_date, 'DD/MM')
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
                -- Mudar de ideias e responder ao turno de AGORA, por isso o
                -- instantaneo anda com a resposta e nao fica no primeiro valor.
                answered_for_date      = excluded.answered_for_date,
                answered_for_starts_at = excluded.answered_for_starts_at,
                answered_for_ends_at   = excluded.answered_for_ends_at
  returning * into v_row;
  return v_row;
end;
$$;

revoke all on function public.answer_overtime(uuid, text) from public;
grant execute on function public.answer_overtime(uuid, text) to authenticated;
