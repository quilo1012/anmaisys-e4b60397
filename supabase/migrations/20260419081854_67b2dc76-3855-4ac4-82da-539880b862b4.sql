UPDATE public.lines
SET name = 'Capsules & Tablets'
WHERE id = 'f5f8703e-a220-49d7-8c58-f0cb24d2be45';

UPDATE public.machines
SET line = 'Capsules & Tablets'
WHERE line_id = 'f5f8703e-a220-49d7-8c58-f0cb24d2be45';

DELETE FROM public.lines
WHERE id = '976f5657-3557-4f74-b629-ed970a356f1a';