-- Um campo a fazer dois trabalhos: `machines.code`.
--
-- It held MCH-020 for sixteen machines and an iTouching GUID for ten others, and the
-- screen that edits it checks for duplicates — so Line 5A and Line 5B "shared a code",
-- as did Line 6A and 6B, and the page called it an error.
--
-- It was not an error. iTouching has one machine called Filler Line 5 where the
-- factory has two, 5A and 5B. The GUID is genuinely the same for both. What was wrong
-- was storing an identifier that legitimately repeats in a field that must not.
--
-- So the two roles separate. `code` stays the internal asset code and becomes unique;
-- `external_id` holds the iTouching GUID and may repeat where iTouching sees one
-- machine and the factory has two.
ALTER TABLE public.machines ADD COLUMN IF NOT EXISTS external_id text;

COMMENT ON COLUMN public.machines.external_id IS
  'O identificador da máquina no iTouching (GUID). Nada a ver com `code`, que é o código interno do ativo: um vem de fora e repete-se quando o iTouching vê uma linha onde a fábrica tem duas máquinas (Filler Line 5 = 5A e 5B).';
COMMENT ON COLUMN public.machines.code IS
  'Código interno do ativo, único (MCH-020). O identificador do iTouching vive em `external_id`.';

-- The real link is the one configured on the mapping page, not whatever somebody
-- pasted into the code box. Two of them disagreed: the GUID ending 3364 is filed
-- against "Tablet Line" in the registry and against "Capsules Packing" on the mapping
-- page, and 3E8AD4CA against "Gel Packing" and "Gel Machine". The mapping page wins,
-- because that is where the link was deliberately made.
UPDATE public.machines m SET external_id = mm.intouch_machine_id
FROM public.intouch_machine_map mm
WHERE lower(mm.machine_name) = lower(m.name) AND mm.machine_name IS NOT NULL;

UPDATE public.machines SET code = NULL
WHERE code ~* '^[0-9a-f]{8}-[0-9a-f]{4}-' OR trim(coalesce(code,'')) = '';

-- Now they can be enforced. Partial, because a machine with no internal code yet is a
-- gap to fill and not a reason to refuse the row.
CREATE UNIQUE INDEX IF NOT EXISTS machines_code_unique
  ON public.machines (code) WHERE code IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS machines_external_id_unique
  ON public.machines (external_id) WHERE external_id IS NOT NULL;
