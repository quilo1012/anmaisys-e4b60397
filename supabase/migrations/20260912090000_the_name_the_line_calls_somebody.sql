-- The spelling the factory's own headcount sheet uses for a person.
--
-- That sheet is typed by hand every morning and calls people what the line calls
-- them. Measured against `Production Headcount August.xlsx`, four days of the
-- company's own sheet carried 249 names and the import placed 188 of them: a quarter
-- of the factory dropped in silence, every month, to be put back by hand.
--
-- Widening the matching rules recovered most of it. What no rule should ever recover
-- is a typo — "LUCAS GLOR" is Lucas Gloor and "Gimenez" is Gabriel Chimenez, and any
-- code clever enough to work that out is also clever enough to put the wrong person
-- on a line. So it is written down instead: once, on the person, by whoever already
-- knows. Comma separated, the same shape `headcount_areas.sheet_label` already uses
-- for the columns, and read the same way.
alter table public.employees
  add column if not exists sheet_aliases text;

comment on column public.employees.sheet_aliases is
  'Other spellings the company headcount spreadsheet uses for this person, comma separated. Read by the headcount import; never shown on the board.';

-- The six the August sheet had that belong to exactly one person on the payroll.
-- Every other unmatched name was either two people who share a first name or somebody
-- not on the payroll at all, and neither of those is settled here — the import asks.
update public.employees set sheet_aliases = 'LUCAS GLOR'  where full_name = 'Lucas Gloor'        and sheet_aliases is null;
update public.employees set sheet_aliases = 'GYOVANI'     where full_name = 'Giovany Gava'       and sheet_aliases is null;
update public.employees set sheet_aliases = 'Gimenez'     where full_name = 'Gabriel Chimenez'   and sheet_aliases is null;
update public.employees set sheet_aliases = 'Crsitiano'   where full_name = 'Cristiano Brunetto' and sheet_aliases is null;
update public.employees set sheet_aliases = 'Welligton'   where full_name = 'Wellington Segato'  and sheet_aliases is null;
update public.employees set sheet_aliases = 'Russo'       where full_name = 'Carlos Russo'       and sheet_aliases is null;
