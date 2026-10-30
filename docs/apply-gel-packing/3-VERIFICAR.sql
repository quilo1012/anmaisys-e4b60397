-- Gel Machine → Gel Packing — VERIFICAÇÃO (só leitura). Correr antes E depois do 2-CORRIGIR.sql.
-- Depois da correcção, a coluna "gel_machine" tem de dar 0 em todas as linhas.

SELECT 'production_sessions' AS tabela,
       count(*) FILTER (WHERE line = 'Gel Machine') AS gel_machine,
       count(*) FILTER (WHERE line = 'Gel Packing') AS gel_packing
  FROM public.production_sessions
UNION ALL
SELECT 'rag_weekly_entries',
       count(*) FILTER (WHERE line = 'Gel Machine'), count(*) FILTER (WHERE line = 'Gel Packing')
  FROM public.rag_weekly_entries
UNION ALL
SELECT 'production_targets',
       count(*) FILTER (WHERE line = 'Gel Machine'), count(*) FILTER (WHERE line = 'Gel Packing')
  FROM public.production_targets
UNION ALL
SELECT 'production_downtimes',
       count(*) FILTER (WHERE line = 'Gel Machine'), count(*) FILTER (WHERE line = 'Gel Packing')
  FROM public.production_downtimes
UNION ALL
SELECT 'intouch_status_log',
       count(*) FILTER (WHERE line = 'Gel Machine'), count(*) FILTER (WHERE line = 'Gel Packing')
  FROM public.intouch_status_log
UNION ALL
SELECT 'sku_production_history',
       count(*) FILTER (WHERE l.name = 'Gel Machine'), count(*) FILTER (WHERE l.name = 'Gel Packing')
  FROM public.sku_production_history h JOIN public.lines l ON l.id = h.line_id
UNION ALL
SELECT 'intouch_machine_map (activas)',
       count(*) FILTER (WHERE l.name = 'Gel Machine' AND m.active), count(*) FILTER (WHERE l.name = 'Gel Packing' AND m.active)
  FROM public.intouch_machine_map m JOIN public.lines l ON l.id = m.line_id
UNION ALL
SELECT 'operator_line_accounts',
       count(*) FILTER (WHERE l.name = 'Gel Machine'), count(*) FILTER (WHERE l.name = 'Gel Packing')
  FROM public.operator_line_accounts a
  CROSS JOIN LATERAL unnest(a.line_ids) u(line_id)
  JOIN public.lines l ON l.id = u.line_id
UNION ALL
SELECT 'lines (activas)',
       count(*) FILTER (WHERE name = 'Gel Machine' AND active), count(*) FILTER (WHERE name = 'Gel Packing' AND active)
  FROM public.lines;

-- Os totais de produção não podem mudar: o mesmo número antes e depois.
SELECT count(DISTINCT s.id)            AS sessoes,
       count(i.id)                     AS itens,
       coalesce(sum(i.actual_qty), 0)  AS actual_total
  FROM public.production_sessions s
  LEFT JOIN public.production_items i ON i.session_id = s.id
 WHERE s.line IN ('Gel Machine', 'Gel Packing');

-- O que a correcção guardou para poder desfazer (só existe depois de a correr).
SELECT tbl, action, count(*) FROM public._bkp_gel_machine_20261030 GROUP BY 1, 2 ORDER BY 1, 2;
