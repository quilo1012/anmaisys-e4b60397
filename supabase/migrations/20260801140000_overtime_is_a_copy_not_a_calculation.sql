-- Overtime here is a copy. It says so, and it refuses to be edited.
--
-- Three places hold overtime for this factory: the payroll spreadsheet, the Workforce
-- Pro HR system, and this. Compared over the same period, 08 Jun – 12 Jul 2026:
--
--   spreadsheet     604.05 h across 33 people
--   Workforce Pro   404.41 h across 24 people, from 2,508 daily timesheets
--
-- Many figures match to the decimal — Josimar 84 / 84.07, Webister 56 / 56.00 — so the
-- two share an origin. The gap is the sickness written off against banked hours, which
-- the spreadsheet applies by hand and the clock-ins cannot know, plus people who are on
-- one and not the other.
--
-- The factory pays from the spreadsheet. So the spreadsheet calculates and this system
-- reads: these rows carry where they came from and when they were imported, and the
-- database refuses to let anyone change the hours here. Editing a copy is how the
-- second answer is born.
ALTER TABLE public.overtime_entries
  ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'import',
  ADD COLUMN IF NOT EXISTS source_note text,
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;

UPDATE public.overtime_entries
   SET source_note = COALESCE(source_note, 'Overtime spreadsheet, 08 Jun – 12 Jul 2026'),
       imported_at = COALESCE(imported_at, created_at)
 WHERE imported_at IS NULL;

/**
 * Refuses a hand edit; allows a re-import.
 *
 * An import stamps imported_at, so a row arriving with a new stamp is a fresh copy of
 * the sheet and passes. A row whose hours change with the stamp untouched is somebody
 * typing over the payroll figure on the wrong screen, and it is stopped with a message
 * that says where to go instead.
 */
CREATE OR REPLACE FUNCTION public.overtime_is_a_copy_not_a_calculation()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.hours IS DISTINCT FROM OLD.hours
     AND NEW.imported_at IS NOT DISTINCT FROM OLD.imported_at THEN
    RAISE EXCEPTION 'Overtime here is a copy of the payroll spreadsheet, not a figure this system calculates. Change it in the spreadsheet and import the period again.';
  END IF;
  IF NEW.imported_at IS NULL THEN NEW.imported_at := now(); END IF;
  RETURN NEW;
END
$function$;

DROP TRIGGER IF EXISTS trg_overtime_is_a_copy ON public.overtime_entries;
CREATE TRIGGER trg_overtime_is_a_copy
  BEFORE INSERT OR UPDATE ON public.overtime_entries
  FOR EACH ROW EXECUTE FUNCTION public.overtime_is_a_copy_not_a_calculation();

-- Verified in a transaction that was rolled back: changing an hours value by hand
-- raises, and the message names the spreadsheet.
