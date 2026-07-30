-- 1. The operator logging window shrinks to 15 minutes past the shift:
--    18:15 for DAY, 06:15 next morning for NIGHT (Europe/London). Long enough to
--    finish writing up a run, short enough that the record still belongs to the
--    shift that made it.
--
-- 2. rag_weekly_entries.actual_qty stops being typed. It is the sum of what
--    operators logged for that line and shift, derived on write.
--
--    Why in the database and not just read-only in the UI: admins hold ALL on this
--    table, so a hidden input still leaves the REST API open. Enforcing it here
--    means the number cannot disagree with its source, whichever path writes.

CREATE OR REPLACE FUNCTION public.session_write_deadline(_session_date date, _shift text)
RETURNS timestamptz LANGUAGE sql IMMUTABLE SET search_path TO 'public'
AS $function$
  SELECT CASE UPPER(COALESCE(_shift, 'DAY'))
    WHEN 'NIGHT' THEN ((_session_date + 1)::text || ' 06:15')::timestamp AT TIME ZONE 'Europe/London'
    ELSE (_session_date::text || ' 18:15')::timestamp AT TIME ZONE 'Europe/London'
  END;
$function$;

COMMENT ON FUNCTION public.session_write_deadline(date, text) IS
  'Last moment an operator may write to a shift: 18:15 for DAY, 06:15 next day for NIGHT (Europe/London) — 15 minutes after the shift ends.';

-- What the floor actually logged for a line and shift. Single definition of
-- "produced", used by the two triggers below.
CREATE OR REPLACE FUNCTION public.rag_actual_from_floor(_date date, _line text, _shift text)
RETURNS numeric LANGUAGE sql STABLE SECURITY DEFINER SET search_path TO 'public'
AS $function$
  SELECT COALESCE(SUM(i.actual_qty), 0)
  FROM public.production_sessions s
  JOIN public.production_items i ON i.session_id = s.id
  WHERE s.session_date = _date
    AND UPPER(BTRIM(s.shift)) = UPPER(BTRIM(_shift))
    -- Line names are free text on both tables and drift by spacing/case.
    AND LOWER(REPLACE(BTRIM(s.line), ' ', '')) = LOWER(REPLACE(BTRIM(_line), ' ', ''));
$function$;

-- Derivation starts 2026-07-30 and does not reach backwards.
--
-- History is not ours to rewrite: of 366 RAG rows going back to 18/05, 120 carry a
-- figure the floor never logged, totalling 534,624 of the 808,372 units on file.
-- For most of that period production was recorded in RAG and operator logging was
-- not yet the habit, so deriving retroactively would erase two thirds of the
-- reported output. Pre-cutover rows keep their stored value, and an UPDATE that
-- touches such a row — editing a plan or a note — must not zero its actual either.
CREATE OR REPLACE FUNCTION public.rag_actual_is_derived()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
BEGIN
  IF new.entry_date >= DATE '2026-07-30' THEN
    new.actual_qty := public.rag_actual_from_floor(new.entry_date, new.line, new.shift);
  ELSIF tg_op = 'UPDATE' THEN
    new.actual_qty := old.actual_qty;
  END IF;
  RETURN new;
END
$function$;

DROP TRIGGER IF EXISTS trg_rag_actual_is_derived ON public.rag_weekly_entries;
CREATE TRIGGER trg_rag_actual_is_derived
BEFORE INSERT OR UPDATE ON public.rag_weekly_entries
FOR EACH ROW EXECUTE FUNCTION public.rag_actual_is_derived();

-- Keep RAG current as the floor logs, corrects or removes production. Without this
-- the figure would only be right at the instant someone happened to save the RAG row.
CREATE OR REPLACE FUNCTION public.rag_refresh_actual_from_item()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $function$
DECLARE
  _sid uuid := COALESCE(new.session_id, old.session_id);
  _d date; _line text; _shift text;
BEGIN
  SELECT s.session_date, s.line, s.shift INTO _d, _line, _shift
  FROM public.production_sessions s WHERE s.id = _sid;
  IF _d IS NULL OR _d < DATE '2026-07-30' THEN RETURN COALESCE(new, old); END IF;

  UPDATE public.rag_weekly_entries r
  SET actual_qty = public.rag_actual_from_floor(_d, _line, _shift), updated_at = now()
  WHERE r.entry_date = _d
    AND UPPER(BTRIM(r.shift)) = UPPER(BTRIM(_shift))
    AND LOWER(REPLACE(BTRIM(r.line), ' ', '')) = LOWER(REPLACE(BTRIM(_line), ' ', ''));

  RETURN COALESCE(new, old);
END
$function$;

DROP TRIGGER IF EXISTS trg_rag_refresh_actual ON public.production_items;
CREATE TRIGGER trg_rag_refresh_actual
AFTER INSERT OR UPDATE OR DELETE ON public.production_items
FOR EACH ROW EXECUTE FUNCTION public.rag_refresh_actual_from_item();

GRANT EXECUTE ON FUNCTION public.rag_actual_from_floor(date, text, text) TO authenticated;
