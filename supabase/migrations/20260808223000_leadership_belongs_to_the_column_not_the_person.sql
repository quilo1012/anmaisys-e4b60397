-- Sair da coluna acaba com a chefia dessa coluna.
--
-- `daily_allocations_one_leader_per_area` is a unique index over (on_date, shift,
-- area_id) where `is_leader`. It says a column has one leader a day, and it is right.
-- What was missing is the other half of the same sentence: leadership is a fact about
-- a column, so a row that leaves the column has to leave the mark behind.
--
-- Nothing did that. Every writer changed `area_id` and left `is_leader` where it was,
-- so moving a leader into a column that already had one made two, and Postgres refused
-- the whole statement — "duplicate key value violates unique constraint
-- daily_allocations_one_leader_per_area", in those words, to a supervisor who had
-- pressed a button. On Saturday 08/08 the Day board had 68e0b058 leading Line 1 and
-- 60ef2b63 leading Line 2; the copy read a source day that put 68e0b058 on Line 2, and
-- so copied nothing at all. It is all-or-nothing: one collision loses sixty rows.
--
-- Here rather than only in the client because there are four writers — the board, the
-- copy, the sheet import, the shift move — and this is an invariant of the table, not
-- a manner of using it. The client carries the same rule so the screen can say what it
-- did; this makes it true whatever wrote it, including the version already deployed.
--
-- What it deliberately does NOT do: choose a leader, or move one. Losing the mark is
-- visible on the board and one press puts it back on whoever is leading now — which is
-- a decision somebody makes, not one a trigger should make for them.
CREATE OR REPLACE FUNCTION public.leadership_follows_the_column()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.is_leader THEN
    -- A day with no column, or one not being worked, leads nothing.
    IF NEW.area_id IS NULL OR NEW.status NOT IN ('assigned', 'overtime') THEN
      NEW.is_leader := false;
    ELSIF TG_OP = 'UPDATE' AND NEW.area_id IS DISTINCT FROM OLD.area_id THEN
      NEW.is_leader := false;
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_daily_allocations_leadership ON public.daily_allocations;
CREATE TRIGGER trg_daily_allocations_leadership
  BEFORE INSERT OR UPDATE ON public.daily_allocations
  FOR EACH ROW EXECUTE FUNCTION public.leadership_follows_the_column();
