-- The employee list becomes the 186 people the factory actually has.
--
-- employees held 50 rows, none with a payroll number, none with a line, and none
-- with a leaving date. The headcount spreadsheet holds 186 with an E-number each,
-- the shift they belong to, and the thirteen who have left. The board looked empty
-- because it was: nobody had an allocation to draw.
--
-- Matching was by name. Forty-three of the fifty existing rows were found, eight of
-- them behind a spelling difference confirmed one at a time — Carlos Geraldi is the
-- sheet's Carlos Giraldi, Willian Souza is William Souza, Maria Campos is Maria de
-- Campos. Those rows are updated in place, never re-inserted: they carry attendance
-- and overtime that a duplicate person would strand.
--
-- Seven rows did not match and are deliberately left alone rather than merged or
-- deleted: Anthony Paulo, David Goncalves, Everton Da Silva, Geisel, Jachem Cowin,
-- Juan Sarto and Lucas Bombo. They may be leavers the sheet dropped, or the sheet
-- may know them by another name. Guessing either way loses a real person's history.
-- ("Geisel" also looks like an existing duplicate of "Geisel Bernardini".)

-- 1. The shift the factory thinks in: Day, Night, Weekend and the two warehouse ones.
--    This is not shift_pattern_id, which says WHICH DAYS somebody works. A person has
--    both: Night, and Mon-Thu.
ALTER TABLE public.employees
  ADD COLUMN IF NOT EXISTS shift_group text;

ALTER TABLE public.employees
  DROP CONSTRAINT IF EXISTS employees_shift_group_check;

ALTER TABLE public.employees
  ADD CONSTRAINT employees_shift_group_check
  CHECK (shift_group IS NULL OR shift_group IN
    ('Day', 'Night', 'Weekend', 'Warehouse Day', 'Warehouse Weekend'));

CREATE INDEX IF NOT EXISTS employees_shift_group_idx
  ON public.employees (shift_group) WHERE active;

-- 2. The forty-three already here gain their payroll number, shift and leaving date.

UPDATE public.employees SET employee_ref = 'E002', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Adenilson' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E151', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Alice Kovac' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E016', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Carlos Geraldi' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E015', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Carlos Russo' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E154', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Cristiano Brunetto' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E021', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Daniel Quilo' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E024', shift_group = 'Warehouse Weekend', left_on = NULL, active = true WHERE full_name = 'Devalsir Filho' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E026', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Dimas Oliveira' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E160', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Eduardo Belini' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E032', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Elias Soares' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E036', shift_group = 'Weekend', left_on = '2026-07-06'::date, active = false WHERE full_name = 'Enzo Luciano' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E042', shift_group = 'Warehouse Weekend', left_on = NULL, active = true WHERE full_name = 'Fabio Silva' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E043', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Fabricio Vieira' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E153', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Felipe Pinelli' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E168', shift_group = 'Weekend', left_on = '2026-05-12'::date, active = false WHERE full_name = 'Flavio Marinho' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E166', shift_group = 'Weekend', left_on = '2026-03-06'::date, active = false WHERE full_name = 'Francisco Neto' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E054', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Geisel Bernardini' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E167', shift_group = 'Warehouse Weekend', left_on = '2026-05-01'::date, active = false WHERE full_name = 'Giovane Lazarotti Janssen' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E058', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Grace Wilson' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E061', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Gustavo Braz' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E068', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Izildo Sarto' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E069', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Jack Granite' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E070', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Jacken John' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E073', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Joao Pedro Solcia' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E077', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Josimar Inocente' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E078', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Juan Bartholo' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E080', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Karina Braz' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E152', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Leonardo Verdurico' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E088', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Leonor Lisboa' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E094', shift_group = 'Warehouse Weekend', left_on = NULL, active = true WHERE full_name = 'Lucas Gonzalez' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E104', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Marcio Carvalho' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E172', shift_group = 'Weekend', left_on = '2026-05-17'::date, active = false WHERE full_name = 'Maria Campos' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E171', shift_group = 'Weekend', left_on = '2026-05-17'::date, active = false WHERE full_name = 'Mathias Reis Vieira' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E111', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Nilton Filho' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E156', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Pedro Correia' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E049', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Pedro De Assis' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E155', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Richrad Camello' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E130', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Sandro Vecchia' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E137', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Talita Melech' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E146', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Webister Junior' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E147', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Wellington Segato' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E174', shift_group = 'Warehouse Weekend', left_on = '2026-06-08'::date, active = false WHERE full_name = 'Willian Souza' AND employee_ref IS NULL;
UPDATE public.employees SET employee_ref = 'E150', shift_group = 'Weekend', left_on = NULL, active = true WHERE full_name = 'Wilton Azevedo' AND employee_ref IS NULL;

-- 3. The rest of the list. Marked as coming from the employee sheet, so an imported
--    row is never mistaken for one HR typed in. Start dates stay null: the sheet has
--    none either, and the import date would read as 143 people hired the same day.
INSERT INTO public.employees (full_name, employee_ref, shift_group, left_on, active, source)
VALUES
  ('Abner Silva', 'E001', 'Day', NULL, true, 'import_employee_list'),
  ('Ailton Carlos Rigoto Junior', 'E003', 'Day', NULL, true, 'import_employee_list'),
  ('Aleksandra Kopec', 'E004', 'Day', NULL, true, 'import_employee_list'),
  ('Alex Dias', 'E005', 'Night', NULL, true, 'import_employee_list'),
  ('Alex Andrade', 'E006', 'Night', NULL, true, 'import_employee_list'),
  ('Alexandre Da Silva Rocha', 'E007', 'Warehouse Day', NULL, true, 'import_employee_list'),
  ('Alexsandro Paula', 'E008', 'Day', NULL, true, 'import_employee_list'),
  ('Anderson Cavalcante', 'E009', 'Day', NULL, true, 'import_employee_list'),
  ('Anderson Frois', 'E010', 'Warehouse Day', NULL, true, 'import_employee_list'),
  ('Andre Pereira', 'E011', 'Day', NULL, true, 'import_employee_list'),
  ('Andre Guimaraes', 'E012', 'Day', NULL, true, 'import_employee_list'),
  ('Bruno Souza', 'E013', 'Warehouse Day', NULL, true, 'import_employee_list'),
  ('Cainan Goncalves', 'E014', 'Night', NULL, true, 'import_employee_list'),
  ('Cesar Andrade', 'E017', 'Day', NULL, true, 'import_employee_list'),
  ('Christian Queiroz', 'E018', 'Day', NULL, true, 'import_employee_list'),
  ('Christopher Dinalli', 'E019', 'Warehouse Day', NULL, true, 'import_employee_list'),
  ('Claudia Prieto', 'E020', 'Day', NULL, true, 'import_employee_list'),
  ('Daniel Almeida', 'E022', 'Night', NULL, true, 'import_employee_list'),
  ('Danilo Miranda', 'E023', 'Day', NULL, true, 'import_employee_list'),
  ('Diego Camargo', 'E025', 'Day', NULL, true, 'import_employee_list'),
  ('Dirlei Junior', 'E027', 'Day', NULL, true, 'import_employee_list'),
  ('Ednecson Souza', 'E028', 'Night', NULL, true, 'import_employee_list'),
  ('Edson Martins', 'E029', 'Night', NULL, true, 'import_employee_list'),
  ('Eduardo Luz', 'E030', 'Night', NULL, true, 'import_employee_list'),
  ('Eduardo Silva Carlos', 'E031', 'Night', NULL, true, 'import_employee_list'),
  ('Elielton Vieira De Moraes', 'E033', 'Warehouse Day', NULL, true, 'import_employee_list'),
  ('Emerson Melquiades', 'E034', 'Night', NULL, true, 'import_employee_list'),
  ('Emily Naiara Da Luz', 'E035', 'Night', NULL, true, 'import_employee_list'),
  ('Erick Moreira', 'E037', 'Night', NULL, true, 'import_employee_list'),
  ('Ethan Wilmore', 'E038', 'Day', NULL, true, 'import_employee_list'),
  ('Everton Eduardo', 'E039', 'Day', NULL, true, 'import_employee_list'),
  ('Ezaquiel Silva', 'E040', 'Day', NULL, true, 'import_employee_list'),
  ('Ezaquiel Santos', 'E041', 'Day', NULL, true, 'import_employee_list'),
  ('Fausto Honorato', 'E044', 'Night', NULL, true, 'import_employee_list'),
  ('Fernando Crepaldi', 'E045', 'Night', NULL, true, 'import_employee_list'),
  ('Fernando Lenon Pereira', 'E046', 'Night', NULL, true, 'import_employee_list'),
  ('Filipe Esmera', 'E047', 'Night', NULL, true, 'import_employee_list'),
  ('Filipi Brigidi', 'E048', 'Warehouse Day', NULL, true, 'import_employee_list'),
  ('Gabriel Chimenez', 'E050', 'Warehouse Day', NULL, true, 'import_employee_list'),
  ('Gabriel Maciel', 'E051', 'Day', NULL, true, 'import_employee_list'),
  ('Gabriel Rebola', 'E052', 'Warehouse Day', NULL, true, 'import_employee_list'),
  ('Gabriela Moreira', 'E053', 'Day', NULL, true, 'import_employee_list'),
  ('Gidow Eltoum', 'E055', 'Warehouse Day', NULL, true, 'import_employee_list'),
  ('Gillian O Hare', 'E056', 'Day', NULL, true, 'import_employee_list'),
  ('Giovany Gava', 'E057', 'Day', NULL, true, 'import_employee_list'),
  ('Guilherme Machado', 'E059', 'Day', NULL, true, 'import_employee_list'),
  ('Gustavo Oliveira', 'E060', 'Day', NULL, true, 'import_employee_list'),
  ('Henrique Cazorla', 'E062', 'Night', NULL, true, 'import_employee_list'),
  ('Henrique Melo', 'E063', 'Warehouse Day', NULL, true, 'import_employee_list'),
  ('Iago Souza', 'E064', 'Night', NULL, true, 'import_employee_list'),
  ('Icaro Martins', 'E065', 'Night', NULL, true, 'import_employee_list'),
  ('Iliomar Lima', 'E066', 'Night', NULL, true, 'import_employee_list'),
  ('Ivan Zucolotto', 'E067', 'Day', NULL, true, 'import_employee_list'),
  ('Jefferson Filho', 'E071', 'Night', NULL, true, 'import_employee_list'),
  ('Jefferson Morello', 'E072', 'Night', NULL, true, 'import_employee_list'),
  ('Joao Roberto Surian', 'E074', 'Night', NULL, true, 'import_employee_list'),
  ('Josiel Rocon', 'E075', 'Day', NULL, true, 'import_employee_list'),
  ('Josiley Rocon', 'E076', 'Day', NULL, true, 'import_employee_list'),
  ('Juliano Santos', 'E079', 'Night', NULL, true, 'import_employee_list'),
  ('Karoline Goncalves', 'E081', 'Day', NULL, true, 'import_employee_list'),
  ('Kazimieras Lazickas', 'E082', 'Night', NULL, true, 'import_employee_list'),
  ('Kelter Caye', 'E083', 'Day', NULL, true, 'import_employee_list'),
  ('Keslly Cazorla', 'E084', 'Night', NULL, true, 'import_employee_list'),
  ('Kevin Kormoss', 'E085', 'Day', NULL, true, 'import_employee_list'),
  ('Kleyve Daum', 'E086', 'Night', NULL, true, 'import_employee_list'),
  ('Laurynas Gelzinis', 'E087', 'Night', NULL, true, 'import_employee_list'),
  ('Levente Kovats', 'E089', 'Day', NULL, true, 'import_employee_list'),
  ('Liana Tora', 'E090', 'Day', NULL, true, 'import_employee_list'),
  ('Lucas Gloor', 'E091', 'Day', NULL, true, 'import_employee_list'),
  ('Lucas Santos', 'E092', 'Day', NULL, true, 'import_employee_list'),
  ('Lucas Duarte', 'E093', 'Day', NULL, true, 'import_employee_list'),
  ('Luciana Rodrigues', 'E095', 'Day', NULL, true, 'import_employee_list'),
  ('Luciano Campos', 'E096', 'Day', NULL, true, 'import_employee_list'),
  ('Luiz Badejo', 'E097', 'Day', NULL, true, 'import_employee_list'),
  ('Macelio Fernandes', 'E098', 'Day', NULL, true, 'import_employee_list'),
  ('Magno Silva', 'E099', 'Warehouse Day', '2026-04-22'::date, false, 'import_employee_list'),
  ('Magno Vitoria', 'E100', 'Day', NULL, true, 'import_employee_list'),
  ('Maikon Tiago Rosa', 'E101', 'Night', NULL, true, 'import_employee_list'),
  ('Marcella Silva', 'E102', 'Day', NULL, true, 'import_employee_list'),
  ('Marcelo Alves', 'E103', 'Day', NULL, true, 'import_employee_list'),
  ('Maria Da Penha Rodrigues De Mato', 'E105', 'Night', NULL, true, 'import_employee_list'),
  ('Maximiliano Santos', 'E106', 'Night', NULL, true, 'import_employee_list'),
  ('Miguel Pereira', 'E107', 'Day', NULL, true, 'import_employee_list'),
  ('Muriel Galindro', 'E108', 'Day', NULL, true, 'import_employee_list'),
  ('Murilo Goncalves', 'E109', 'Day', NULL, true, 'import_employee_list'),
  ('Nilmar Rodrigues', 'E110', 'Night', NULL, true, 'import_employee_list'),
  ('Nivaldo Junior', 'E112', 'Night', NULL, true, 'import_employee_list'),
  ('Oshwaldo Stephanus', 'E113', 'Day', NULL, true, 'import_employee_list'),
  ('Patrick Silva', 'E114', 'Night', NULL, true, 'import_employee_list'),
  ('Pedro Carvalho', 'E115', 'Night', NULL, true, 'import_employee_list'),
  ('Rafael Tosta', 'E116', 'Day', NULL, true, 'import_employee_list'),
  ('Rafael Franco', 'E117', 'Warehouse Day', NULL, true, 'import_employee_list'),
  ('Ramao Acosta Junior', 'E118', 'Warehouse Day', NULL, true, 'import_employee_list'),
  ('Ramon Oliveira', 'E119', 'Night', NULL, true, 'import_employee_list'),
  ('Raphael Pacheco', 'E120', 'Day', NULL, true, 'import_employee_list'),
  ('Renato Ricchi', 'E121', 'Day', NULL, true, 'import_employee_list'),
  ('Reynaldo Junior', 'E122', 'Warehouse Day', NULL, true, 'import_employee_list'),
  ('Ricardo Fernandes', 'E123', 'Day', NULL, true, 'import_employee_list'),
  ('Ricardo Marques', 'E124', 'Day', NULL, true, 'import_employee_list'),
  ('Robert Martins', 'E125', 'Night', NULL, true, 'import_employee_list'),
  ('Rogerio Martins', 'E126', 'Night', NULL, true, 'import_employee_list'),
  ('Romario Casagrande', 'E127', 'Night', NULL, true, 'import_employee_list'),
  ('Romario Meneses', 'E128', 'Night', NULL, true, 'import_employee_list'),
  ('Rosana Cardozo', 'E129', 'Day', NULL, true, 'import_employee_list'),
  ('Saulo Rodrigo Silva Oliveira', 'E131', 'Day', NULL, true, 'import_employee_list'),
  ('Selma Ansanelli', 'E132', 'Day', NULL, true, 'import_employee_list'),
  ('Sergio Kozoroski', 'E133', 'Day', NULL, true, 'import_employee_list'),
  ('Sergio Junior', 'E134', 'Warehouse Day', NULL, true, 'import_employee_list'),
  ('Simone Crespo', 'E135', 'Day', NULL, true, 'import_employee_list'),
  ('Stetson Bertoli', 'E136', 'Day', NULL, true, 'import_employee_list'),
  ('Thiago Ribeiro', 'E138', 'Night', NULL, true, 'import_employee_list'),
  ('Thiago Barros', 'E139', 'Night', NULL, true, 'import_employee_list'),
  ('Thiago Souza', 'E140', 'Night', NULL, true, 'import_employee_list'),
  ('Thomas Connolly', 'E141', 'Night', NULL, true, 'import_employee_list'),
  ('Vagner Costalonga', 'E142', 'Day', NULL, true, 'import_employee_list'),
  ('Valter Junior', 'E143', 'Night', NULL, true, 'import_employee_list'),
  ('Victor Hugo Moreira', 'E144', 'Night', NULL, true, 'import_employee_list'),
  ('Vinicius Almeida', 'E145', 'Warehouse Day', NULL, true, 'import_employee_list'),
  ('Wellington Silva', 'E148', 'Night', NULL, true, 'import_employee_list'),
  ('Wesley Jhony', 'E149', 'Day', NULL, true, 'import_employee_list'),
  ('Rodolfo Santana', 'E157', 'Day', NULL, true, 'import_employee_list'),
  ('Rodrigo Colombo', 'E158', 'Day', NULL, true, 'import_employee_list'),
  ('Yuri Correa', 'E159', 'Day', NULL, true, 'import_employee_list'),
  ('Ezaquiel dos Santos', 'E161', 'Day', NULL, true, 'import_employee_list'),
  ('Lucas Leonel', 'E162', 'Day', NULL, true, 'import_employee_list'),
  ('Adriano Galvao', 'E163', 'Day', NULL, true, 'import_employee_list'),
  ('Marcio Santana', 'E164', 'Weekend', '2026-01-30'::date, false, 'import_employee_list'),
  ('Gilmara Borges', 'E165', 'Night', '2026-01-31'::date, false, 'import_employee_list'),
  ('Augusto Augusto', 'E169', 'Day', '2026-05-14'::date, false, 'import_employee_list'),
  ('Henry Tragante', 'E170', 'Day', '2026-05-14'::date, false, 'import_employee_list'),
  ('Jose Carlos Filho', 'E173', 'Day', '2026-05-22'::date, false, 'import_employee_list'),
  ('Igor Carvalho', 'E175', 'Weekend', NULL, true, 'import_employee_list'),
  ('Ismael Carmo', 'E176', 'Night', NULL, true, 'import_employee_list'),
  ('Joabi Osti', 'E177', 'Day', NULL, true, 'import_employee_list'),
  ('Magaiver Costa De Amorim', 'E178', 'Night', NULL, true, 'import_employee_list'),
  ('Nefi Carzola', 'E179', 'Night', NULL, true, 'import_employee_list'),
  ('Pedro Dornelles', 'E180', 'Day', NULL, true, 'import_employee_list'),
  ('Rafel Galvao', 'E181', 'Day', NULL, true, 'import_employee_list'),
  ('Rafael Duarte', 'E182', 'Night', NULL, true, 'import_employee_list'),
  ('Ricardo Santos', 'E183', 'Night', NULL, true, 'import_employee_list'),
  ('Edmar Eduardo', 'E184', 'Night', NULL, true, 'import_employee_list'),
  ('Luiz Santos', 'E185', 'Weekend', NULL, true, 'import_employee_list'),
  ('Rodrigo Vequi', 'E186', 'Day', NULL, true, 'import_employee_list')
ON CONFLICT (employee_ref) DO NOTHING;
