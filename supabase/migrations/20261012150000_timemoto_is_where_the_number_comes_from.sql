-- O TimeMoto passa a ser de onde vem o número.
--
-- Decidido a 12/10/2026: o relógio já é o sistema onde toda a gente desta fábrica tem
-- um identificador estável, e este tinha os seus — 51 fichas sem `employee_ref`
-- nenhum, nomes escritos de maneiras diferentes em três sítios, e uma lista de
-- `sheet_aliases` curada à mão porque emparelhar por nome nunca funcionou.
--
-- Isto é só o esquema. A IMPORTAÇÃO é um passo à parte e precisa do export do
-- TimeMoto; sem ele estas colunas ficam vazias e nada muda, que é o estado correcto
-- para uma coluna que ainda não tem dados.
--
-- DEPOIS DE IMPORTAR, e só então, as fichas sem número herdam o do relógio:
--
--     update public.employees
--        set employee_ref = timemoto_user_id
--      where employee_ref is null and timemoto_user_id is not null;
--
-- Não está aqui de propósito. Posta nesta migração corria uma vez, a zero linhas,
-- antes de os dados existirem — e depois nunca mais. Pertence ao passo da importação.
--
-- Levanta a instrução de 2026 de não preencher as 51 fichas sem `employee_ref`, que
-- foi levantada explicitamente ao tomar esta decisão. Quem já tem número MANTÉM o
-- seu: a linha acima só toca no que está vazio.

alter table public.employees
  add column if not exists timemoto_user_id  text,
  add column if not exists timemoto_username text;

-- Dois funcionários com o mesmo id de relógio é um erro de importação, e é melhor que
-- a importação falhe do que fique silenciosamente a apontar duas fichas ao mesmo
-- picar. Parcial, porque vazio é o estado normal enquanto não houver export.
create unique index if not exists employees_timemoto_user_id_key
  on public.employees (timemoto_user_id)
  where timemoto_user_id is not null;

comment on column public.employees.timemoto_user_id is
  'O identificador desta pessoa no TimeMoto. E a fonte do numero: as fichas sem '
  'employee_ref herdam-no na importacao. Ver 20261012150000.';
comment on column public.employees.timemoto_username is
  'O nome de utilizador no TimeMoto, para a importacao poder ser conferida por um '
  'humano sem abrir os dois sistemas lado a lado.';
