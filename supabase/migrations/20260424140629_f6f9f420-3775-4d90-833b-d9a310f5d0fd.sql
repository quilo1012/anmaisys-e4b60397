UPDATE public.machines
SET name = regexp_replace(name, '^Filler\s+', ''),
    sector = regexp_replace(COALESCE(sector, ''), '^Filler\s+', '')
WHERE name ILIKE 'Filler %';