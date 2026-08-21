-- Reparação: o dia 21/08/2026 foi preenchido no board NIGHT e pertence ao DAY,
-- e por isso as 57 pessoas saíram marcadas como "overtime".
--
-- CAUSA (verificada no código):
--
--   `isOffRota` (src/lib/rotaStatus.ts:57) diz que alguém está fora da rota quando
--   a rota não cobre o dia **ou** quando a crew não é a do board:
--
--       onThisBoard = boardShiftFor(shift_group) === shift
--       boardShiftFor: 'Night' → 'Night'; tudo o resto → 'Day'
--
--   No board Night, toda a gente que não é crew Night dá `onThisBoard = false`.
--   `statusForPlacement` grava então `overtime` — de propósito, porque uma sexta à
--   noite não é a rota de ninguém. Com o dia inteiro no board errado, isso deixa de
--   ser a exceção e passa a ser toda a gente: 57 de uma vez, crews misturadas
--   (FRI-MON, LAB, sem badge), num dia que a rota delas cobre.
--
--   A marca é pegajosa (rotaStatus.ts:81): sobrevive a arrastar, a copiar e a
--   importar. Só o botão de estado (`explicit`) a tira. Por isso não se desfez
--   sozinha e não se desfaz mudando o board — as linhas têm de ser corrigidas.
--
-- ORDEM. O bloco 0 é só leitura. Os blocos 1 e 2 escrevem; o 2 é o que corrige o dia.
-- Correr o 1 antes do 2 importa: o 2 recompõe o `status` a partir da rota, e o 1 é o
-- que garante que a rota que a app lê e a que o ecrã mostra dizem o mesmo.


-- ── Bloco 0 · o que lá está, sem escrever nada ──────────────────────────────
select da.shift, da.status, coalesce(e.shift_group, '(sem crew)') as crew, count(*)
from daily_allocations da
join employees e on e.id = da.employee_id
where da.on_date = date '2026-08-21'
group by 1, 2, 3
order by 1, 2, 3;
-- Espera-se: quase tudo em shift='Night'. As linhas com crew='Night' são as únicas
-- que lá pertencem — o bloco 2 deixa-as em paz.


-- ── Bloco 1 · pôr a história de acordo com o que o ecrã mostra ──────────────
-- A regra do overtime lê `employee_shift_history` (resolveShiftOn); os ecrãs leem
-- `employees`. Havia um terceiro sítio a mudar a rota sem deixar registo — o painel
-- do Workforce — e por isso as duas podem discordar. Só de hoje em diante: os dias
-- passados ficam com a história que tinham, porque reescrever o passado mudava como
-- um dia já pago foi julgado.
insert into employee_shift_history (employee_id, shift_group, shift_pattern_id, effective_from, note)
select e.id, e.shift_group, e.shift_pattern_id, date '2026-08-21',
       'Reposto: o painel do Workforce mudava a rota sem deixar registo'
from employees e
join lateral (
  select h.shift_group, h.shift_pattern_id
  from employee_shift_history h
  where h.employee_id = e.id and h.effective_from <= date '2026-08-21'
  order by h.effective_from desc
  limit 1
) ultima on true
where e.active
  and (ultima.shift_pattern_id is distinct from e.shift_pattern_id
    or ultima.shift_group     is distinct from e.shift_group)
on conflict (employee_id, effective_from) do update
  set shift_group      = excluded.shift_group,
      shift_pattern_id = excluded.shift_pattern_id,
      note             = excluded.note
returning employee_id;


-- ── Bloco 2 · mover o dia para o board certo e desfazer o overtime ──────────
-- Move quem não é crew Night. Também apanha shift='Weekend', que a tabela aceita e
-- o board não tem separador para mostrar — linhas gravadas e depois invisíveis.
--
-- O status é recomposto pela regra da app, não apagado: no board Day, quem tem uma
-- rota que cobre a sexta volta a 'assigned'; quem tem uma rota que NÃO a cobre fica
-- em 'overtime', porque aí a marca é verdadeira — é uma chamada num dia de folga.
-- Quem não tem rota nenhuma volta a 'assigned' (desconhecido não é "fora da rota",
-- rotaStatus.ts:49). Ausências, doença e férias não são tocadas.
--
-- `is_leader` só sobrevive se a coluna não tiver já um líder no board de destino: o
-- índice `daily_allocations_one_leader_per_area` recusa o segundo, e recusa a
-- instrução inteira — um dia perdido por um quadrado.
--
-- `employee_attendance` não é tocada: 'assigned' e 'overtime' dão ambos 'present'
-- (src/lib/attendanceFromBoard.ts:35), portanto já está certa.
update daily_allocations da
set shift = 'Day',
    status = case
      when da.status = 'overtime'
       and (sp.id is null or 5 = any(sp.days)) then 'assigned'   -- 5 = sexta
      else da.status
    end,
    is_leader = coalesce(da.is_leader, false) and not exists (
      select 1 from daily_allocations x
      where x.on_date = da.on_date and x.shift = 'Day'
        and x.area_id is not distinct from da.area_id
        and x.is_leader and x.employee_id <> da.employee_id
    )
from employees e
left join shift_patterns sp on sp.id = e.shift_pattern_id
where da.employee_id = e.id
  and da.on_date = date '2026-08-21'
  and da.shift in ('Night', 'Weekend')
  and coalesce(e.shift_group, '') <> 'Night'
  -- Ninguém pode ter duas linhas no mesmo dia e board: a chave
  -- (on_date, shift, employee_id) é única, e a instrução inteira falharia.
  and not exists (
    select 1 from daily_allocations d2
    where d2.on_date = da.on_date and d2.shift = 'Day'
      and d2.employee_id = da.employee_id
  )
returning e.full_name, da.status, da.area_id, da.is_leader;


-- ── Bloco 3 · quem NÃO foi movido, e porquê ────────────────────────────────
-- Nada é deixado para trás em silêncio. Duas razões possíveis: já tinha linha no
-- board Day (conflito), ou é mesmo crew Night e está no sítio certo.
select e.full_name, coalesce(e.shift_group,'(sem crew)') as crew, da.shift, da.status,
       case when e.shift_group = 'Night' then 'crew Night — fica'
            else 'ja tinha linha no board Day' end as porque
from daily_allocations da
join employees e on e.id = da.employee_id
where da.on_date = date '2026-08-21' and da.shift <> 'Day'
order by 2, 1;


-- ── Bloco 4 · contar o que ficou ───────────────────────────────────────────
select shift, status, count(*)
from daily_allocations
where on_date = date '2026-08-21'
group by 1, 2 order by 1, 2;
