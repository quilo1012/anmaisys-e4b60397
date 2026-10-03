-- Um dia nao pode pertencer a dois periodos de folha.
--
-- O calendario 4-4-5 acabou de ser reposto a mao, e nada na base impedia que
-- voltasse a sair do sitio. O que correu mal hoje foi um `generate_series` de 28
-- em 28 dias que escreveu dezassete periodos desalinhados sem dar erro nenhum:
-- as datas ficaram erradas em silencio e so se notou ao olhar para o ecra de
-- fecho semanas depois.
--
-- Estas duas restricoes nao impedem datas erradas -- impedem a classe de erro que
-- custa dinheiro. Um dia dentro de dois periodos e trabalho contado duas vezes
-- num documento de onde se paga, e um periodo que acaba antes de comecar faz o
-- `expectedShifts` devolver zero dias de rota, o que se le como "ninguem tinha
-- de vir trabalhar".
--
-- O que estas restricoes NAO fazem, de proposito:
--
--   * Nao verificam a duracao. Vinte e oito ou trinta e cinco dias e a regra de
--     hoje, nao uma lei: um ano de transicao ou uma mudanca de calendario podem
--     precisar de outra coisa, e uma restricao que bloqueie o negocio e pior do
--     que o defeito que evita. A verificacao da duracao vive nas consultas, onde
--     e barata de mudar.
--   * Nao impedem BURACOS. Um periodo em falta nao e detectavel por restricao --
--     a base nao sabe que devia la estar alguma coisa. Para isso e preciso olhar,
--     e a consulta que olha esta em `claude/periodos-de-folha-2026-10-03.md`.
--
-- Verificado contra a producao antes de escrever: zero pares sobrepostos, zero
-- periodos com fim antes do inicio, nas vinte e oito linhas. Nenhum dado
-- existente e recusado por isto.

-- `daterange(a, b, '[]')` inclui as duas pontas: um periodo que acaba a 10/01 e
-- outro que comeca a 10/01 SAO um conflito, que e exactamente o que se quer.
ALTER TABLE public.workforce_payroll_periods
  ADD CONSTRAINT workforce_payroll_periods_sem_sobreposicao
  EXCLUDE USING gist (daterange(start_date, end_date, '[]') WITH &&);

ALTER TABLE public.workforce_payroll_periods
  ADD CONSTRAINT workforce_payroll_periods_fim_depois_do_inicio
  CHECK (end_date >= start_date);

COMMENT ON CONSTRAINT workforce_payroll_periods_sem_sobreposicao
  ON public.workforce_payroll_periods IS
  'Um dia so pode estar num periodo. Dois periodos a cobrir o mesmo dia e trabalho contado duas vezes num documento de onde se paga.';
