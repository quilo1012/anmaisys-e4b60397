-- As horas de produção passam a pertencer ao turno, não ao relógio de quem gravou.
--
-- `hmToIso` built `new Date()` and set the hours on it — the day the form happened to
-- be submitted. On a day shift that is right by accident. On nights it is wrong half
-- the time, because the shift crosses midnight and the operator does not: somebody on
-- the night of 06/08 logging at 01:00 that a run started at 17:20 got 07/08 17:20,
-- eighteen hours AFTER the finish they had typed before midnight.
--
-- Twenty-three records carried a negative duration and three more ran over twelve
-- hours. Nothing was wrong with the times the operators typed; the day around them was.
--
-- Rebuilt from the London wall clock: a NIGHT session dated D takes its evening on D
-- and its small hours on D+1; a DAY session is one calendar day. Only applied where
-- the result actually orders the two — a record whose HOUR is mistyped is not fixed by
-- moving its day, and guessing which of the two hours is the wrong one would be
-- inventing production history.
WITH fix AS (
  SELECT i.id,
    (s.session_date
      + CASE WHEN s.shift = 'NIGHT'
                  AND EXTRACT(HOUR FROM (i.started_at AT TIME ZONE 'Europe/London')) < 12
             THEN 1 ELSE 0 END
      + (i.started_at AT TIME ZONE 'Europe/London')::time) AT TIME ZONE 'Europe/London' AS novo_inicio,
    (s.session_date
      + CASE WHEN s.shift = 'NIGHT'
                  AND EXTRACT(HOUR FROM (i.finished_at AT TIME ZONE 'Europe/London')) < 12
             THEN 1 ELSE 0 END
      + (i.finished_at AT TIME ZONE 'Europe/London')::time) AT TIME ZONE 'Europe/London' AS novo_fim
  FROM public.production_items i
  JOIN public.production_sessions s ON s.id = i.session_id
  WHERE i.started_at IS NOT NULL AND i.finished_at IS NOT NULL
    AND (i.finished_at < i.started_at OR i.finished_at - i.started_at > interval '12 hours')
)
UPDATE public.production_items i
SET started_at = f.novo_inicio, finished_at = f.novo_fim
FROM fix f
WHERE f.id = i.id AND f.novo_fim > f.novo_inicio;
