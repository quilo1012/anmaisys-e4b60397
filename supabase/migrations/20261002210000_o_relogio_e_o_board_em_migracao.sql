-- As tres pecas que o Lote 2A le, postas em migracao.
--
-- Foram aplicadas a produção a 02/10 e nunca foram escritas aqui. O frontend do 2A
-- ficou dependente de tres objectos que o repositorio nao sabia que existiam: numa
-- base nova, ou numa branch de preview, o `useClockCoverage` apanha um erro de
-- relacao inexistente e as tres telas passam a dizer para sempre que a cobertura nao
-- pode ser lida — que e, ironicamente, o unico modo de falha que o 2A existe para
-- tornar visivel.
--
-- Tudo com CREATE OR REPLACE: em produção isto e um no-op, numa base vazia cria.
--
-- A regra que estas tres peças implementam, e que nao pode mudar sem uma decisao:
-- o board (`daily_allocations`) e o relogio (`attendance_days`) sao dois registos
-- separados e nenhum corrige o outro. Nada aqui escreve nada. Sao leituras.

-- ---------------------------------------------------------------------------
-- 1. Onde chegou o relogio.
-- ---------------------------------------------------------------------------
-- Uma linha so. A distancia ate hoje NAO e calculada aqui de proposito: o "ha quantos
-- dias" mede-se contra a data operacional, que e a da app (`currentShift`), e a meia
-- noite e meia a base e a app discordariam sobre que dia e hoje.
CREATE OR REPLACE VIEW public.v_timemoto_coverage AS
SELECT
  (SELECT max(on_date) FROM attendance_days)               AS last_on_date,
  (SELECT min(on_date) FROM attendance_days)               AS first_on_date,
  (SELECT count(DISTINCT employee_id) FROM attendance_days) AS employees_covered,
  (SELECT count(*) FROM employees WHERE active)             AS active_employees,
  (SELECT count(*) FROM attendance_days)                    AS rows_total;

-- ---------------------------------------------------------------------------
-- 2. O veredicto de um board num dia.
-- ---------------------------------------------------------------------------
-- Quatro numeros e uma palavra. A palavra sozinha nao chega para por num ecra — ver
-- `src/lib/boardClockStatus.ts`, que decide o que eles querem dizer e tem os testes.
--
-- Duas regras que custaram a acertar e que nao se mexem sem ler isto:
--
-- 1. `deste_board` repete a regra da app (`boardShiftFor`): shift_group 'Night' vai
--    para o board Night, tudo o resto para o Day. Sem ela, a malta do dia que picou
--    contava como divergencia do board da noite — 55 por dia, todas falsas.
-- 2. `cobertos` exclui quem nunca apareceu no relogio. A ausencia de uma linha para
--    quem nunca esteve no TimeMoto nao diz nada sobre essa pessoa, e conta-la seria
--    reportar como divergencia o facto de o relogio nao a cobrir.
CREATE OR REPLACE FUNCTION public.fn_board_clock_status(p_date date, p_shift text)
RETURNS TABLE(status text, clock_rows integer, covered_people integer, differs integer)
LANGUAGE sql
STABLE
SET search_path TO 'public', 'pg_temp'
AS $function$
  WITH cobertos AS (
    SELECT DISTINCT ad.employee_id AS eid FROM attendance_days ad
  ),
  deste_board AS (
    SELECT e.id AS eid FROM employees e
    WHERE e.active
      AND (CASE WHEN e.shift_group = 'Night' THEN 'Night' ELSE 'Day' END) = p_shift
  ),
  relogio AS (
    SELECT ad.employee_id AS eid, COALESCE(ad.worked_minutes, 0) AS mins
    FROM attendance_days ad WHERE ad.on_date = p_date
  ),
  board AS (
    SELECT da.employee_id AS eid
    FROM daily_allocations da
    WHERE da.on_date = p_date AND da.shift = p_shift
      AND da.status IN ('assigned', 'overtime')
  ),
  discordam AS (
    SELECT b.eid FROM board b
    JOIN cobertos c ON c.eid = b.eid
    LEFT JOIN relogio r ON r.eid = b.eid
    WHERE COALESCE(r.mins, 0) = 0
    UNION
    SELECT r.eid FROM relogio r
    JOIN deste_board d ON d.eid = r.eid
    WHERE r.mins > 0 AND NOT EXISTS (SELECT 1 FROM board b WHERE b.eid = r.eid)
  )
  SELECT
    CASE WHEN (SELECT count(*) FROM relogio) = 0 THEN 'planned'
         WHEN (SELECT count(*) FROM discordam) = 0 THEN 'clocked'
         ELSE 'differs' END,
    (SELECT count(*) FROM relogio)::int,
    (SELECT count(*) FROM board b JOIN cobertos c ON c.eid = b.eid)::int,
    -- Sem relogio nesse dia nao ha nada para comparar: zero, nao o numero de pessoas
    -- por confirmar, que se leria como um veredito.
    CASE WHEN (SELECT count(*) FROM relogio) = 0 THEN 0
         ELSE (SELECT count(*) FROM discordam)::int END
$function$;

-- ---------------------------------------------------------------------------
-- 3. O mesmo veredicto, para todos os dias de uma vez.
-- ---------------------------------------------------------------------------
-- A funcao responde por um dia; esta responde pelos 82. A app usa a vista para o badge
-- e as duas tem de concordar — foram verificadas nos 123 pares, nas quatro colunas,
-- com zero discordancias.
CREATE OR REPLACE VIEW public.v_board_clock_status AS
WITH dias AS (
  SELECT DISTINCT on_date, shift FROM daily_allocations
),
cobertos AS (
  SELECT DISTINCT employee_id FROM attendance_days
),
crew AS (
  SELECT id AS employee_id,
         CASE WHEN shift_group = 'Night' THEN 'Night' ELSE 'Day' END AS board
  FROM employees WHERE active
),
cnt AS (
  SELECT on_date, count(*) AS clock_rows FROM attendance_days GROUP BY on_date
),
no_board_sem_horas AS (
  SELECT d.on_date, d.shift, count(*) AS n
  FROM dias d
  JOIN daily_allocations da
    ON da.on_date = d.on_date AND da.shift = d.shift
   AND da.status = ANY (ARRAY['assigned'::text, 'overtime'::text])
  JOIN cobertos c ON c.employee_id = da.employee_id
  LEFT JOIN attendance_days ad ON ad.on_date = d.on_date AND ad.employee_id = da.employee_id
  WHERE COALESCE(ad.worked_minutes, 0) = 0
  GROUP BY d.on_date, d.shift
),
picou_fora_do_board AS (
  SELECT d.on_date, d.shift, count(*) AS n
  FROM dias d
  JOIN attendance_days ad ON ad.on_date = d.on_date AND COALESCE(ad.worked_minutes, 0) > 0
  JOIN crew cw ON cw.employee_id = ad.employee_id AND cw.board = d.shift
  WHERE NOT EXISTS (
    SELECT 1 FROM daily_allocations da
    WHERE da.on_date = d.on_date AND da.shift = d.shift AND da.employee_id = ad.employee_id
      AND da.status = ANY (ARRAY['assigned'::text, 'overtime'::text])
  )
  GROUP BY d.on_date, d.shift
),
cov AS (
  SELECT d.on_date, d.shift, count(*) AS covered_people
  FROM dias d
  JOIN daily_allocations da
    ON da.on_date = d.on_date AND da.shift = d.shift
   AND da.status = ANY (ARRAY['assigned'::text, 'overtime'::text])
  JOIN cobertos c ON c.employee_id = da.employee_id
  GROUP BY d.on_date, d.shift
)
SELECT
  d.on_date,
  d.shift,
  COALESCE(cnt.clock_rows, 0::bigint)::integer     AS clock_rows,
  COALESCE(cov.covered_people, 0::bigint)::integer AS covered_people,
  CASE WHEN COALESCE(cnt.clock_rows, 0::bigint) = 0 THEN 0
       ELSE (COALESCE(a.n, 0::bigint) + COALESCE(b.n, 0::bigint))::integer END AS differs,
  CASE WHEN COALESCE(cnt.clock_rows, 0::bigint) = 0 THEN 'planned'::text
       WHEN (COALESCE(a.n, 0::bigint) + COALESCE(b.n, 0::bigint)) = 0 THEN 'clocked'::text
       ELSE 'differs'::text END AS status
FROM dias d
LEFT JOIN cnt ON cnt.on_date = d.on_date
LEFT JOIN cov ON cov.on_date = d.on_date AND cov.shift = d.shift
LEFT JOIN no_board_sem_horas a ON a.on_date = d.on_date AND a.shift = d.shift
LEFT JOIN picou_fora_do_board b ON b.on_date = d.on_date AND b.shift = d.shift;

GRANT SELECT ON public.v_timemoto_coverage  TO authenticated;
GRANT SELECT ON public.v_board_clock_status TO authenticated;
GRANT EXECUTE ON FUNCTION public.fn_board_clock_status(date, text) TO authenticated;
