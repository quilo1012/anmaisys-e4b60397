-- ================================================================
-- 00b — a atribuição: nem toda a acção na linha é do líder
-- ================================================================
-- 20260801060000_not_every_action_on_the_line_is_the_leaders.sql, copiado do
-- repositório byte a byte. NÃO o reescreva.
--
-- PORQUE ESTÁ AQUI, E PORQUE É "00b": o carimbo é 01/08, anterior a todos os blocos
-- 01–08 desta pasta, e escapou-lhes por completo — a mesma falha que o `05b`, noutro
-- sítio. O pipeline foi montado a partir do `pending-migrations-apply.sql`, que começa
-- em 15/08 e nunca a viu.
--
-- O QUE SE PERDE SEM ELA: a app lê `quality_label_attribution` para saber que rótulos
-- NÃO são do chefe de turno. Quando a tabela não existe, a leitura falha, o conjunto de
-- exclusões fica vazio — e um conjunto vazio é uma resposta VÁLIDA a dizer "nada está
-- excluído". Não há erro no ecrã. O que há é a avaria de máquina a ser cobrada ao chefe
-- de turno, e "Maintenance" a somar os seus pontos ao score dele, para sempre.
--
-- FORA DO APPLY-ALL-IN-ORDER.sql, DE PROPÓSITO. Aquele ficheiro não pode ser colado
-- duas vezes depois de uma passagem completa; este pode ser colado as vezes que quiser.
-- É inteiramente idempotente: `IF NOT EXISTS`, `ON CONFLICT DO NOTHING`, e as políticas
-- são largadas antes de recriadas. Nada aqui depende dos blocos 01–08, nem eles disto,
-- por isso a ordem não importa — corra-o quando quiser, antes ou depois.
--
-- UMA COISA A SABER: o `ON CONFLICT (label) DO NOTHING` do seed não desfaz decisões
-- suas. Se mudar "Maintenance" para *Counts* no ecrã Lists & scoring, correr isto outra
-- vez não o volta a excluir. O ecrã manda, e é assim que deve ser.
--
-- COMO CONFIRMAR QUE PEGOU: abra uma acção no log com os rótulos "Batch code" e
-- "Maintenance". O bloco Score passa a dizer
--   "2 points — Batch code 2. Maintenance is not the leader's, so its 3 is not charged."
-- Antes disto, diz "5 points — Batch code 2 + Maintenance 3".
-- ================================================================

-- An action raised on a line is not automatically the leader's doing.
--
-- A machine failure is maintenance's. A GMP finding is raised against the line, not
-- against the person running it that night. Charging those to the leader's score makes
-- the score measure who was unlucky rather than who did the job — and a leader who
-- learns that is a leader who stops raising actions.
--
-- Which labels belong to whom is the factory's judgement and it will change, so it is
-- a table rather than a list in the code. Anything NOT listed counts: a new label has
-- to be excluded on purpose, so nothing quietly stops counting.
CREATE TABLE IF NOT EXISTS public.quality_label_attribution (
  label text PRIMARY KEY,
  counts_against_leader boolean NOT NULL DEFAULT true,
  note text,
  updated_at timestamptz NOT NULL DEFAULT now()
);

INSERT INTO public.quality_label_attribution (label, counts_against_leader, note) VALUES
  ('Maintenance', false, 'A machine failure is not the shift leader''s doing.'),
  ('GMP', false, 'Raised against the line, not against the person running it.')
ON CONFLICT (label) DO NOTHING;

ALTER TABLE public.quality_label_attribution ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "label attribution read" ON public.quality_label_attribution;
CREATE POLICY "label attribution read" ON public.quality_label_attribution
  FOR SELECT TO authenticated USING (auth.uid() IS NOT NULL);

-- Quality owns this alongside the severity weights: it decides what a deviation is,
-- so it decides whose deviation it is.
DROP POLICY IF EXISTS "label attribution write" ON public.quality_label_attribution;
CREATE POLICY "label attribution write" ON public.quality_label_attribution
  FOR ALL TO authenticated
  USING (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'quality_supervisor'::app_role))
  WITH CHECK (has_role(auth.uid(), 'admin'::app_role) OR has_role(auth.uid(), 'quality_supervisor'::app_role));
