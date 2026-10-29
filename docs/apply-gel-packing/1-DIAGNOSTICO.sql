-- Gel Packing gravado como Gel Machine — DIAGNÓSTICO (só leitura, não altera nada).
-- Colar no Lovable → More → Cloud → SQL editor e devolver as 4 tabelas.
--
-- O código grava a linha pelo NOME da linha a que a origem está ligada:
--   * tablet:    operator_line_accounts.line_ids  → lines.name  → production_sessions.line
--   * iTouching: intouch_machine_map.line_id      → lines.name  → production_sessions.line
-- Se o Gel Packing aparece como Gel Machine, uma destas ligações aponta para a linha errada.

-- 1. As linhas de gel que existem
SELECT id, name, active FROM public.lines WHERE name ILIKE '%gel%' ORDER BY name;

-- 2. A que linha cada conta de tablet de gel está ligada (só o rótulo da conta, sem e-mails)
SELECT a.label, array_agg(l.name ORDER BY ord) AS linhas_na_ordem
  FROM public.operator_line_accounts a
  CROSS JOIN LATERAL unnest(a.line_ids) WITH ORDINALITY AS u(line_id, ord)
  LEFT JOIN public.lines l ON l.id = u.line_id
 WHERE a.label ILIKE '%gel%' OR l.name ILIKE '%gel%'
 GROUP BY a.label;

-- 3. A que linha cada máquina iTouching de gel está ligada
SELECT m.intouch_machine_name, m.machine_name, l.name AS linha, m.active
  FROM public.intouch_machine_map m
  LEFT JOIN public.lines l ON l.id = m.line_id
 WHERE m.intouch_machine_name ILIKE '%gel%' OR m.machine_name ILIKE '%gel%' OR l.name ILIKE '%gel%';

-- 4. O que está gravado em cada linha de gel, separado por origem (contagens apenas)
SELECT s.line,
       CASE WHEN s.notes ILIKE '%iTouching%' THEN 'iTouching' ELSE 'tablet/manual' END AS origem,
       count(DISTINCT s.id) AS sessoes,
       count(i.id)          AS itens,
       coalesce(sum(i.actual_qty), 0) AS actual_total,
       min(s.session_date)  AS primeira,
       max(s.session_date)  AS ultima
  FROM public.production_sessions s
  LEFT JOIN public.production_items i ON i.session_id = s.id
 WHERE s.line ILIKE '%gel%'
 GROUP BY 1, 2
 ORDER BY 1, 2;
