-- Conferir o "Report" da Engineer Console contra os registos.
--
-- SÓ LEITURA: um único SELECT, sem escrita. Correr no SQL editor do Lovable
-- (More → Cloud → SQL editor) ou noutro cliente com acesso de leitura.
--
-- Como usar:
--   1. Gerar o relatório (botão Report → turno e data → Generate Report) e anotar o
--      "Period" do cabeçalho, p. ex. "Period: 28/10/2026 18:00 → 29/10/2026 06:00".
--      O formato Excel traz a folha "All stops read" com as mesmas colunas e o mesmo
--      veredicto por paragem que esta query: é a comparação mais directa.
--   2. Pôr esse turno nas duas linhas marcadas com  <<<  abaixo (hora de Londres).
--   3. Correr. Cada linha é uma paragem que tocou o turno, com os minutos contados
--      pelas mesmas regras do relatório e a coluna `no_relatorio` a dizer se devia
--      aparecer nele.
--   4. Comparar:
--        - cada linha com no_relatorio = 'listed' tem de estar no ficheiro, com a
--          mesma ordem (WO-nº), a mesma linha e os mesmos minutos (±1);
--        - nenhuma outra ordem pode estar no ficheiro;
--        - 'INVERTED' tem de aparecer em "NOT VALIDATED";
--        - "Stops recorded: N stops on M work orders" no Summary = número de linhas
--          com no_relatorio diferente de 'INVERTED' / 'outside' / warehouse, e
--          ordens distintas dessas.
--   Correr pouco depois de descarregar: uma paragem aberta conta até now().
--
-- Diferença conhecida: o relatório junta exclusões sobrepostas antes de as subtrair
-- (mergeIntervals); aqui somam-se. Só diverge se duas exclusões da mesma ordem se
-- sobrepuserem — a query assinala-o em `exclusoes_sobrepostas`.

WITH win AS (
  SELECT (timestamp '2026-10-29 06:00' AT TIME ZONE 'Europe/London') AS s,   -- <<< início do turno
         (timestamp '2026-10-29 18:00' AT TIME ZONE 'Europe/London') AS e    -- <<< fim do turno
),
ev AS (
  SELECT d.id, w.id AS wo_id, w.wo_number, w.status, w.wo_type, w.description,
         COALESCE(NULLIF(btrim(w.line_at_time), ''), l.name) AS line,
         d.stopped_at, d.resumed_at, d.duration_minutes, d.stopped_reason,
         GREATEST(d.stopped_at, win.s) AS f,
         LEAST(COALESCE(d.resumed_at, now()), win.e, now()) AS t,
         win.s AS win_s, win.e AS win_e
    FROM public.downtime_events d
    JOIN public.work_orders w ON w.id = d.work_order_id
    LEFT JOIN public.lines l ON l.id = w.line_id
    CROSS JOIN win
   WHERE d.stopped_at < win.e
     AND (d.resumed_at IS NULL OR d.resumed_at > win.s OR d.stopped_at >= win.s)
),
scored AS (
  SELECT ev.*,
         EXISTS (SELECT 1 FROM public.problem_descriptions p
                  WHERE p.planned AND lower(p.name) = lower(ev.description)) AS planned_problem,
         COALESCE((
           SELECT SUM(GREATEST(0, EXTRACT(epoch FROM
                    LEAST(ev.t, COALESCE(x.ended_at, now())) - GREATEST(ev.f, x.started_at))))
             FROM public.wo_downtime_exclusions x
            WHERE x.work_order_id = ev.wo_id), 0) AS excluded_sec,
         (SELECT count(*) FROM public.wo_downtime_exclusions a
            JOIN public.wo_downtime_exclusions b
              ON a.work_order_id = b.work_order_id AND a.id < b.id
             AND a.started_at < COALESCE(b.ended_at, now())
             AND b.started_at < COALESCE(a.ended_at, now())
           WHERE a.work_order_id = ev.wo_id) AS exclusoes_sobrepostas
    FROM ev
)
SELECT wo_number,
       line,
       status,
       stopped_at AT TIME ZONE 'Europe/London' AS parou_londres,
       resumed_at AT TIME ZONE 'Europe/London' AS retomou_londres,
       duration_minutes AS duracao_guardada,
       ROUND(GREATEST(0, EXTRACT(epoch FROM (t - f)) - excluded_sec) / 60.0) AS minutos_no_turno,
       stopped_at < win_s AS vem_do_turno_anterior,
       resumed_at IS NULL AS ainda_parada,
       CASE
         WHEN wo_type = 'warehouse_service'                       THEN 'excluded: warehouse_service'
         WHEN resumed_at IS NOT NULL AND resumed_at < stopped_at  THEN 'INVERTED'
         WHEN t <= f                                              THEN 'outside'
         WHEN planned_problem
           OR stopped_reason ~* 'no[[:space:]_-]*planned[[:space:]_-]*shift' THEN 'planned (not counted)'
         WHEN ROUND(GREATEST(0, EXTRACT(epoch FROM (t - f)) - excluded_sec) / 60.0) > 15 THEN 'listed'
         ELSE 'under 15 min'
       END AS no_relatorio,
       exclusoes_sobrepostas
  FROM scored
 ORDER BY stopped_at;
