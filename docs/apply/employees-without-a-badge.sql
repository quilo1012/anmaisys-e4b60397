-- Os empregados que não se conseguem registar. SÓ LEITURA — nada aqui escreve.
--
-- Porque é que isto bloqueia tudo: o registo é por número de crachá. O
-- `employee-signin` recebe `employee_ref` + password + convite e grava
-- `employees.user_id` nessa ficha exata. Sem `employee_ref`, não há por onde a pessoa
-- se identificar — e `my_employee_id()` devolve null, por isso `answer_overtime`
-- recusa com "No employee record is linked to this login". O QR Code não muda nada
-- disto: leva a pessoa a um formulário que ela não consegue preencher.
--
-- O docstring do `employee-signin` diz 209 ativos, 158 com crachá. Estes números são
-- de quando foi escrito; o Bloco 1 diz quantos são hoje.
--
-- NÃO HÁ SEGUNDA FONTE DE CRACHÁS DENTRO DA APP. A tabela `employees` tem um único
-- campo que serve (`employee_ref`); as outras colunas são
-- full_name, email, department, position, shift_group, shift_pattern_id,
-- employment_type, started_on, left_on, manager_id, notes, sheet_aliases, source,
-- current_line_id, headcount_area_id, user_id. Nenhuma é um número de crachá.
-- Portanto o mapeamento tem de vir de fora: RH, o TimeMoto, ou quem imprime os
-- crachás. A coluna `source` diz de onde veio cada ficha, e é por aí que se sabe a
-- quem perguntar.

-- ── Bloco 1 · o tamanho do problema ────────────────────────────────────────
select
  count(*)                                             as ativos,
  count(*) filter (where employee_ref is not null)     as com_cracha,
  count(*) filter (where employee_ref is null)         as sem_cracha,
  count(*) filter (where user_id is not null)          as ja_registados,
  count(*) filter (where user_id is null
                     and employee_ref is not null)     as podem_registar_se_hoje
from public.employees
where active;

-- ── Bloco 2 · quem são, e o que a ficha deles já tem ───────────────────────
-- Tudo o que existe para cada um, para decidir de onde vem o número. Nada é inventado
-- e nada é alterado: isto é a lista para levar a quem tem a fonte verdadeira.
select
  e.id,
  e.full_name,
  e.department,
  e.shift_group,
  e.position,
  e.employment_type,
  e.started_on,
  e.email,
  e.source,                       -- de onde veio a ficha; diz a quem perguntar
  e.sheet_aliases,                -- como a planilha lhe chama
  (e.user_id is not null)         as ja_tem_login,
  e.notes
from public.employees e
where e.active
  and e.employee_ref is null
order by e.department nulls last, e.full_name;

-- ── Bloco 3 · homónimos, antes de alguém pensar em casar por nome ──────────
-- Este sistema tem quatro "Lucas". Casar por nome é como se atribui o crachá de uma
-- pessoa a outra, e o resultado é alguém a responder overtime pela ficha errada —
-- com o `employee_ref` já gravado, e sem nada no ecrã que o denuncie.
select lower(btrim(split_part(full_name, ' ', 1))) as primeiro_nome,
       count(*) as quantos,
       string_agg(full_name, ' | ' order by full_name) as quem
from public.employees
where active
group by 1
having count(*) > 1
order by 2 desc, 1;

-- ── Bloco 4 · o formato dos crachás que já existem ─────────────────────────
-- Para que os 51 que faltam sigam o mesmo formato e não um inventado agora.
select employee_ref, full_name, department
from public.employees
where active and employee_ref is not null
order by employee_ref
limit 20;
