-- Departamento tirado do quadro, para quem o quadro sabe.
--
-- Forty-seven active people had no department, which is a quarter of the workforce
-- and the reason the headcount panel's department chart was missing a quarter of the
-- shifts it drew. Eight of them stand in the same column of the board every day, and
-- that column is the evidence — the same evidence used to create the nineteen people
-- the sheets named but the system did not have.
UPDATE public.employees SET department = v.d FROM (VALUES
  ('Cesar Andrade','Office Admin'),
  ('Rafael Franco','Warehouse'),
  ('Alexandre Da Silva Rocha','Warehouse'),
  ('Magno Vitoria','Warehouse'),
  ('Reynaldo Junior','Warehouse'),
  ('Alexsandro Paula','Production'),
  ('Ismael Carmo','Quality'),
  ('Gabriela Moreira','Production')
) AS v(n, d)
WHERE employees.full_name = v.n AND employees.department IS NULL;

-- The other thirty-nine are left blank on purpose. Thirty-eight are the night crew,
-- who have a board of their own that nobody has filled in, so there is no evidence to
-- read; the last is Andre Pereira, one of a pair of Andres the sheets write without a
-- surname. A department invented for them would look like a fact and be a guess.
