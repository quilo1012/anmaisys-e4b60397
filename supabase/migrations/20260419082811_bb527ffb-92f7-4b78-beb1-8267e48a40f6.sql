UPDATE public.machines SET name='Capsules 1' WHERE name='Capsules Machine 1';
UPDATE public.machines SET name='Capsules 2' WHERE name='Capsules Machine 2';
INSERT INTO public.machines (name, machine_type, side, line_id, current_location)
VALUES
  ('Capsules Packing', 'Packing', 'common', 'f5f8703e-a220-49d7-8c58-f0cb24d2be45', 'Capsules & Tablets'),
  ('Gel Packing', 'Packing', 'common', '6fca06ef-dbdf-48cd-b10e-d34c442aea7b', 'Gel Line');