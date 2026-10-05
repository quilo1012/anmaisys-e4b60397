-- A cobertura do relogio mede a ultima PICAGEM, nao o dia mais longe que o import cobre.
--
-- Medido na base a 05/10/2026. A view dava `last_on_date = 2026-10-11`, seis dias a
-- FRENTE de hoje, porque `last_on_date` era `max(on_date)` e o `attendance_days` tinha
-- 210 linhas datadas depois de hoje:
--
--   dia     linhas  worked_minutes>0  start_time  scheduled_minutes>0
--   06/10     35           0              0              0
--   07/10     35           0              0              0
--   08/10     35           0              0              0
--   09/10     35           0              0             32
--   10/10     35           0              0             32
--   11/10     35           0              0             35
--
-- Seis dias, 35 pessoas cada, todas `source = 'timemoto'`, todas escritas de uma vez a
-- 03/10 as 07:15:48. **Zero minutos trabalhados e zero horas de entrada**: o que o
-- import trouxe foi o HORARIO PREVISTO, nao picagens.
--
-- Nenhuma dessas linhas e uma picagem, e o `max(on_date)` contava-as. O
-- `ClockCoverageNote` — que tres ecras leem (Attendance, Leave, Production Headcount)
-- — dizia por isso "The clock was last imported for 11 Oct 2026", e o `Math.max(0, …)`
-- da app transformava os -6 dias em zero, que nessa nota se escreve "today". A nota
-- existe exactamente para impedir que se leia mal o relogio.
--
-- A app ja foi corrigida para nunca mais chamar "today" a uma data futura (PR #537,
-- `coverageFrom` + `daysAhead`). Isso era o remendo; isto e a correccao: a pergunta
-- certa feita no sitio onde esta escrita.
--
-- **O que conta como picagem.** Uma linha tem conteudo de relogio quando tem minutos
-- trabalhados, OU uma hora de entrada, OU uma ausencia registada. A ausencia conta de
-- proposito: o TimeMoto sabe alguma coisa daquele dia e disse-a, portanto o import
-- CHEGA la. O que nao conta e uma linha so com `scheduled_minutes`, que e o turno que
-- a pessoa devia fazer e nao noticia nenhuma sobre o que fez.
--
-- `rows_total` fica a contar a tabela inteira, que e o que o nome diz. Nenhum ecra o
-- mostra hoje; serve de controlo, e um dia em que `rows_total` cresce sem o
-- `employees_covered` crescer e precisamente este caso a acontecer outra vez.
--
-- **Medido na base, antes e depois de aplicar isto:**
--
--   last_on_date        2026-10-11  ->  2026-10-03   (de seis dias A FRENTE para dois atras)
--   first_on_date       2026-06-08  ->  2026-06-08   (igual)
--   employees_covered           99  ->  99           (igual)
--   rows_total                7108      dos quais 3228 (45%) sao linhas so com horario
--
-- O `employees_covered` NAO se move, e vale dizer porque: suspeitei que o "99 de 211"
-- estivesse inflado pelas linhas de horario, e nao esta — quem so tem horario previsto
-- tambem tem picagem noutro dia qualquer. O que estava errado era a data, so a data.
--
-- As colunas, os nomes, a ordem e os tipos ficam iguais: `CREATE OR REPLACE VIEW`
-- exige-o, e e a razao pela qual **nao ha codigo acoplado a esta migracao** — o
-- `useClockCoverage` e o unico leitor na app e nao muda uma linha. Pode ser aplicada
-- antes ou depois de qualquer merge.

CREATE OR REPLACE VIEW public.v_timemoto_coverage AS
WITH picado AS (
  SELECT on_date, employee_id
  FROM attendance_days
  WHERE worked_minutes > 0
     OR start_time IS NOT NULL
     OR absence_name IS NOT NULL
)
SELECT
  (SELECT max(on_date) FROM picado)                AS last_on_date,
  (SELECT min(on_date) FROM picado)                AS first_on_date,
  (SELECT count(DISTINCT employee_id) FROM picado) AS employees_covered,
  (SELECT count(*) FROM employees WHERE active)    AS active_employees,
  (SELECT count(*) FROM attendance_days)           AS rows_total;

COMMENT ON VIEW public.v_timemoto_coverage IS
  'Onde o relogio do TimeMoto esta, para os ecras que leem numeros assentes nele. Conta so linhas com picagem ou ausencia registada: uma linha so com horario previsto e um plano, e ja fez a nota dizer "today" sobre uma data seis dias no futuro.';

-- Reafirmado em vez de assumido. O `CREATE OR REPLACE VIEW` preserva os privilegios
-- que a view ja tinha, portanto um GRANT a mais que alguem tenha dado sobrevive a isto
-- sem aparecer no ficheiro. Uma view sem RLS propria le a tabela com os direitos de
-- quem a criou — foi uma view assim que ja expos 508 ordens de trabalho ao `anon`
-- nesta base — e o `anon` nao tem nada que saber onde esta o relogio da fabrica.
REVOKE ALL ON public.v_timemoto_coverage FROM PUBLIC;
REVOKE ALL ON public.v_timemoto_coverage FROM anon;
GRANT SELECT ON public.v_timemoto_coverage TO authenticated;
