-- Gralhas nos dados, corrigidas na origem em vez de contornadas na apresentação.
--
-- "Richrad Camello" is "Richard" with two letters swapped. It matters beyond looking
-- wrong: the board sheets write "Richard", so the import had to carry an alias to find
-- him at all.
UPDATE public.employees SET full_name = 'Richard Camello' WHERE full_name = 'Richrad Camello';

-- "Prodcution" was on 28 records beside 40 spelled "Production". The headcount panel
-- drew one department as three separate bars, and any filter by department silently
-- missed two thirds of production. It was being folded in the display, which hides the
-- next typo as well as this one — so it is fixed here, and the display now shows what
-- is stored.
UPDATE public.employees SET department = 'Production'           WHERE department = 'Prodcution';
UPDATE public.employees SET department = 'Production Operative' WHERE department = 'Prodcution Operative';
UPDATE public.employees SET department = 'Warehouse Operative'  WHERE department = 'Wahouse Operative';
