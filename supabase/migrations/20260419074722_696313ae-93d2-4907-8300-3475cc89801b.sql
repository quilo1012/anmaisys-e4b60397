-- Remove standalone Tablet Line
DELETE FROM public.machines WHERE id = 'ba2b2f3b-c368-42ee-9c0c-43655d67dbe9';

-- Rename Capsules Packing -> Tablet Line, keep under Capsules line
UPDATE public.machines
SET name = 'Tablet Line',
    machine_type = 'Tablet',
    sector = 'Tablet Line',
    line = 'Capsules'
WHERE id = '2eebaa67-3a6d-46d9-8dfd-8306d8fef00e';