-- Duas colunas que inventavam uma medição, e uma que apagava metade do trabalho.
--
-- A tela Production Performance imprimia, em todas as linhas, "0.0%" de sucata, "0"
-- de equipa e "0" pontos de qualidade. Nenhum dos três era uma leitura: eram o
-- default da coluna e um filtro a cair no vazio.
--
--   1. production_items.scrap_qty é NOT NULL DEFAULT 0. Das 943 linhas, 943 valem
--      exactamente 0 e nenhuma é NULL — ou seja, o ramo "not recorded" que o
--      LineIndicators e o ShiftScrapCard escrevem contra NULL nunca chegou a correr.
--      Pior: com scrap "registada" em toda a parte, a nota honesta ("Scrap — o campo
--      acabou de abrir") desaparecia do rodapé da tabela.
--
--   2. production_sessions.staff_actual já levou esta correcção uma vez, em
--      20260801120000, que anulou os 231 zeros que existiam nesse dia. O que essa
--      migração não fez foi tirar o DEFAULT 0 — e as 493 sessões criadas desde então
--      nasceram outra vez a dizer que a linha correu sem ninguém lá.
--
--   3. quality_actions.shift só é escrito pela origem 'pm' (69 linhas, todas
--      carimbadas às 12:00 de Londres, que é um meio-dia sintético: o formulário só
--      pede a data). A sync do SafetyCulture — 123 linhas, com instantes reais
--      espalhados por todas as horas — nunca o escreveu. E a tela abre fixada no
--      turno a correr, com `.eq("shift", …)` no servidor, portanto derrubava todas
--      as acções vivas: zero pontos e zero acções abertas em cada linha, todos os
--      dias.
--
-- Zero é uma afirmação. NULL é a única coisa verdadeira que estas colunas tinham
-- para dizer, e o turno de uma acção com hora real lê-se do relógio da fábrica.

-- 1. Sucata: em branco quer dizer que ninguém mediu.
--    O 0 que alguém escreveu de propósito no ShiftScrapCard continua a valer 0 — mas
--    a partir de agora é distinguível, porque nenhum é criado sozinho.
ALTER TABLE public.production_items
  ALTER COLUMN scrap_qty DROP DEFAULT,
  ALTER COLUMN scrap_qty DROP NOT NULL;

UPDATE public.production_items SET scrap_qty = NULL WHERE scrap_qty = 0;

-- 2. Efectivo: o mesmo, e desta vez sem o default a repor o problema.
ALTER TABLE public.production_sessions
  ALTER COLUMN staff_actual  DROP DEFAULT,
  ALTER COLUMN staff_planned DROP DEFAULT;

UPDATE public.production_sessions SET staff_actual  = NULL WHERE staff_actual  = 0;
UPDATE public.production_sessions SET staff_planned = NULL WHERE staff_planned = 0;

-- 3. O turno de uma acção do SafetyCulture, lido do instante em que foi levantada.
--    Day 06:00–17:59, Night 18:00–05:59, hora de Londres — a mesma regra que
--    src/lib/shifts.ts aplica no ecrã e que workOrdersInPeriod() já aplica a uma
--    ordem de trabalho, que também não tem coluna de turno.
--
--    Só as linhas da sync. As da origem 'pm' ficam como estão: o meio-dia delas é
--    sintético e derivar DAY dele seria trocar um branco honesto por uma invenção.
CREATE OR REPLACE FUNCTION public.factory_shift_of(at timestamptz)
RETURNS text
LANGUAGE sql
STABLE
SET search_path = public
AS $$
  SELECT CASE
    WHEN EXTRACT(HOUR FROM (at AT TIME ZONE 'Europe/London')) BETWEEN 6 AND 17
    THEN 'DAY' ELSE 'NIGHT'
  END;
$$;

UPDATE public.quality_actions
   SET shift = public.factory_shift_of(recorded_at)
 WHERE shift IS NULL
   AND source = 'safetyculture'
   AND recorded_at IS NOT NULL;

-- E a mesma regra à porta, para que o próximo deploy da edge function não possa
-- voltar a esquecer-se dela. Cada edge function tem o seu deploy e a sync pode ficar
-- atrás do resto do sistema durante dias; o gatilho fecha essa janela.
-- Só actua quando o escritor não disse nada — quem preenche o turno manda.
CREATE OR REPLACE FUNCTION public.quality_action_stamp_shift()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.shift IS NULL
     AND NEW.source = 'safetyculture'
     AND NEW.recorded_at IS NOT NULL
  THEN
    NEW.shift := public.factory_shift_of(NEW.recorded_at);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quality_action_stamp_shift ON public.quality_actions;
CREATE TRIGGER trg_quality_action_stamp_shift
BEFORE INSERT OR UPDATE OF recorded_at, shift ON public.quality_actions
FOR EACH ROW
EXECUTE FUNCTION public.quality_action_stamp_shift();

-- Recriar uma função devolve-lhe o anon: nenhuma destas é para ser chamada de fora.
REVOKE ALL ON FUNCTION public.factory_shift_of(timestamptz) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.quality_action_stamp_shift() FROM PUBLIC, anon, authenticated;
