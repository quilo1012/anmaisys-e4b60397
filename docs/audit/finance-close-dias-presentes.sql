-- Finance Close: "Present" inflacionado (ex.: 44 dias em 07/09–11/10/2026, 35 dias de calendário).
-- SÓ LEITURA. Colar no Lovable → More → Cloud → SQL editor. Nada aqui escreve.

-- 1. O que o ecrã mostrava (antes do fix) vs. o que conta cada dia uma vez, por pessoa.
WITH p AS (SELECT date '2026-09-07' AS d0, date '2026-10-11' AS d1),
relogio AS (
  SELECT ad.employee_id, ad.on_date,
         bool_or(coalesce(ad.worked_minutes,0) > 0) AS trabalhou,
         bool_or(ad.absence_name IS NOT NULL)       AS ausente,
         count(*)                                   AS linhas
  FROM attendance_days ad, p WHERE ad.on_date BETWEEN p.d0 AND p.d1
  GROUP BY 1,2
),
marcas AS (
  SELECT ea.employee_id, ea.on_date, ea.status FROM employee_attendance ea, p
  WHERE ea.on_date BETWEEN p.d0 AND p.d1
),
antes AS (  -- a lógica antiga: relógio + TODAS as marcas "present", sem cruzar o dia
  SELECT e.id,
    (SELECT count(*) FROM attendance_days ad, p WHERE ad.employee_id=e.id AND ad.on_date BETWEEN p.d0 AND p.d1
       AND ad.absence_name IS NULL AND coalesce(ad.worked_minutes,0)>0)
  + (SELECT count(*) FROM marcas m WHERE m.employee_id=e.id AND m.status='present') AS present_antes
  FROM employees e WHERE e.active
),
depois AS (  -- a lógica nova: um veredicto por pessoa-dia; o relógio ganha onde existe
  SELECT e.id,
    (SELECT count(*) FROM relogio r WHERE r.employee_id=e.id AND r.trabalhou AND NOT r.ausente)
  + (SELECT count(*) FROM marcas m WHERE m.employee_id=e.id AND m.status='present'
       AND NOT EXISTS (SELECT 1 FROM relogio r WHERE r.employee_id=m.employee_id AND r.on_date=m.on_date)) AS present_depois
  FROM employees e WHERE e.active
)
SELECT e.full_name, e.shift_group, sp.name AS rota, sp.days AS dias_rota,
       a.present_antes, d.present_depois, a.present_antes - d.present_depois AS contados_duas_vezes
FROM employees e
JOIN antes a ON a.id=e.id JOIN depois d ON d.id=e.id
LEFT JOIN shift_patterns sp ON sp.id=e.shift_pattern_id
WHERE a.present_antes <> d.present_depois
ORDER BY contados_duas_vezes DESC, e.full_name;

-- 2. Linhas duplicadas no relógio (o mesmo dia mais de uma vez). Deve vir vazio;
--    se não vier, o ecrã Attendance (que soma linhas do relógio) também está a inflacionar.
SELECT employee_id, on_date, count(*) AS linhas
FROM attendance_days GROUP BY 1,2 HAVING count(*) > 1 ORDER BY 3 DESC LIMIT 50;
