-- When somebody started, kept beside when they left.
--
-- employees has carried left_on since the first migration but never the other end,
-- so the file could say a person had gone and never say when they arrived. The
-- headcount spreadsheet has held both columns all along; only this table was missing
-- one.
--
-- Nullable, and left empty rather than guessed. Fifty people were imported from a
-- list that carried no start dates, and back-filling them with the import date would
-- read as fifty people hired the same afternoon.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS started_on date;

COMMENT ON COLUMN public.employees.started_on IS
  'First day of employment. Null means nobody has recorded it, not that they started today.';
