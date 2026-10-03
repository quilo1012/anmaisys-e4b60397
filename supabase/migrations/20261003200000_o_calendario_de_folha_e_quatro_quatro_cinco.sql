-- O calendário de folha é 4-4-5, e de dezembro em diante não era.
--
-- A migração de 07/08 corrigiu setembro para os trinta e cinco dias certos e deixou
-- escrito que os períodos seguintes eram "only a floor" e que "December may move".
-- Move: 07/12-03/01 são vinte e oito dias onde o trimestre Out+Nov+Dez pede trinta e
-- cinco. E o `generate_series` de 28 em 28 que veio a seguir não tem a semana extra
-- de todo, por isso os dezassete períodos de 2027 e 2028 afastam-se do calendário
-- cerca de um dia por mês — é essa deriva que põe `January 2028` em duas linhas e
-- deixa sete períodos com um nome que não corresponde ao mês em que acabam.
--
-- 4-4-5 quer dizer trimestres de noventa e um dias: quatro semanas, quatro, cinco.
-- Confirmado contra os dados: Jul+Ago+Set 2026 são 28+28+35, e todo o período de
-- fevereiro a novembro de 2026 já cai exactamente onde a regra o põe. O que falta é
-- daí para a frente.
--
-- Importa para o fecho porque `expectedShifts` conta os dias da rota dentro do
-- intervalo do período. Um período com a duração errada dá um devido errado a toda
-- a gente, e é o devido que alimenta o `shiftBalance` e o cartão "Shifts short".
--
-- Nada antes de 07/12/2026 é tocado: todos os períodos já decorridos ficam como
-- estão. Os três períodos de 2026 que nunca foram criados (12/01-08/02, 13/04-10/05
-- e 11/05-07/06) continuam por criar — não têm um único turno, linha de relógio nem
-- marca manual lá dentro, por isso são arrumação e não correcção.

-- Guarda: se alguém tiver lançado overtime num período que isto substitui, parar.
-- Hoje `overtime_entries` está vazia, mas uma migração corre quando corre.
DO $$
DECLARE n integer;
BEGIN
  SELECT count(*) INTO n
    FROM public.overtime_entries o
    JOIN public.workforce_payroll_periods p ON p.id = o.period_id
   WHERE p.start_date >= DATE '2026-12-07';
  IF n > 0 THEN
    RAISE EXCEPTION 'Overtime lancado em % periodo(s) a partir de 07/12/2026. Resolver antes de remexer no calendario.', n;
  END IF;
END $$;

-- December 2026 é o período de cinco semanas do seu trimestre. Só o fim muda, por
-- isso nada se desloca para trás.
UPDATE public.workforce_payroll_periods
   SET end_date = DATE '2027-01-10'
 WHERE start_date = DATE '2026-12-07';

-- De 04/01/2027 em diante vinha do `generate_series` de 28 em 28. Substituir inteiro
-- é mais seguro do que acertar datas uma a uma, e são todos períodos futuros.
DELETE FROM public.workforce_payroll_periods WHERE start_date >= DATE '2027-01-04';

-- Nome = mês em que o período começa, que é a regra que os períodos correctos de
-- junho de 2026 em diante já seguem.
INSERT INTO public.workforce_payroll_periods (name, start_date, end_date) VALUES
  ('January 2027',   DATE '2027-01-11', DATE '2027-02-07'),  -- 28d
  ('February 2027',  DATE '2027-02-08', DATE '2027-03-07'),  -- 28d
  ('March 2027',     DATE '2027-03-08', DATE '2027-04-11'),  -- 35d
  ('April 2027',     DATE '2027-04-12', DATE '2027-05-09'),  -- 28d
  ('May 2027',       DATE '2027-05-10', DATE '2027-06-06'),  -- 28d
  ('June 2027',      DATE '2027-06-07', DATE '2027-07-11'),  -- 35d
  ('July 2027',      DATE '2027-07-12', DATE '2027-08-08'),  -- 28d
  ('August 2027',    DATE '2027-08-09', DATE '2027-09-05'),  -- 28d
  ('September 2027', DATE '2027-09-06', DATE '2027-10-10'),  -- 35d
  ('October 2027',   DATE '2027-10-11', DATE '2027-11-07'),  -- 28d
  ('November 2027',  DATE '2027-11-08', DATE '2027-12-05'),  -- 28d
  ('December 2027',  DATE '2027-12-06', DATE '2028-01-09'),  -- 35d
  ('January 2028',   DATE '2028-01-10', DATE '2028-02-06'),  -- 28d
  ('February 2028',  DATE '2028-02-07', DATE '2028-03-05'),  -- 28d
  ('March 2028',     DATE '2028-03-06', DATE '2028-04-09'),  -- 35d
  ('April 2028',     DATE '2028-04-10', DATE '2028-05-07'),  -- 28d
  ('May 2028',       DATE '2028-05-08', DATE '2028-06-04'),  -- 28d
  ('June 2028',      DATE '2028-06-05', DATE '2028-07-09');  -- 35d
