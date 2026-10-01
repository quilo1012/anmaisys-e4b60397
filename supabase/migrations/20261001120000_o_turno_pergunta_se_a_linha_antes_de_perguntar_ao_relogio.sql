-- O turno de uma acção deixa de ser só uma leitura do relógio, e passa a poder ser
-- corrigido sem que a próxima sync apague a correcção.
--
-- 20260923090000 resolveu um problema real: 123 acções do SafetyCulture com `shift`
-- NULL, invisíveis em todos os ecrãs que filtram `.eq("shift", …)`. A solução foi ler
-- o turno do instante em que a acção foi levantada. Funciona — mas mede a hora em que
-- a acção foi ESCRITA, não aquela em que o problema aconteceu.
--
-- Entre as duas há um turno inteiro. Uma falha apanhada às 02:00 e registada pelo QC
-- às 07:15 da manhã seguinte sai DAY. Medido no log a 01/10/2026, há acções cujo
-- próprio título diz "(L6/night shift)" e que estão carimbadas Day, com o líder do dia
-- ao lado — porque o mesmo instante decide as duas coisas.
--
-- A linha sabe a resposta e já a escreveu: `production_sessions` tem a linha, a data,
-- o turno e quem a abriu, e `sessionInCharge()` já encontra essa sessão para este
-- instante — é assim que o líder da acção é decidido desde 07/09. Faltava fazer a
-- mesma pergunta para o turno. O relógio fica como recurso, para uma linha onde
-- ninguém abriu sessão.
--
-- Nenhuma das duas é um facto: são derivações. Esta migração acrescenta a coluna que
-- diz qual delas respondeu, para que uma terceira — uma pessoa — possa valer mais do
-- que ambas.

-- 1. Quem respondeu.
--
--    'session' — a sessão de produção aberta na linha naquele instante.
--    'clock'   — o relógio da fábrica, porque não havia sessão.
--    'manual'  — uma pessoa. Nenhuma sync escreve este valor e nenhuma lhe toca.
ALTER TABLE public.quality_actions
  ADD COLUMN IF NOT EXISTS shift_source text;

ALTER TABLE public.quality_actions
  DROP CONSTRAINT IF EXISTS quality_actions_shift_source_check;

ALTER TABLE public.quality_actions
  ADD CONSTRAINT quality_actions_shift_source_check
  CHECK (shift_source IS NULL OR shift_source IN ('session', 'clock', 'manual'));

-- 2. O que já lá está, nomeado pelo que de facto o produziu.
--
--    As linhas do SafetyCulture com turno vieram todas do relógio: foi a única regra
--    que alguma vez correu sobre elas, na migração de 23/09 e na edge function. São
--    'clock', e é isso que as torna melhoráveis — uma re-leitura do período pode
--    substituí-las pela resposta da sessão.
UPDATE public.quality_actions
   SET shift_source = 'clock'
 WHERE shift_source IS NULL
   AND shift IS NOT NULL
   AND source = 'safetyculture';

--    As da origem 'pm' são outra coisa: o turno foi escolhido por quem preencheu o
--    formulário. Isso é uma pessoa, e uma pessoa manda. Marcá-las 'clock' convidaria
--    uma sync futura a reescrever um campo que ninguém derivou.
UPDATE public.quality_actions
   SET shift_source = 'manual'
 WHERE shift_source IS NULL
   AND shift IS NOT NULL
   AND source IS DISTINCT FROM 'safetyculture';

-- 3. O gatilho de 20260923090000 continua a ser a rede de segurança, e agora assina.
--
--    Só actua quando o escritor não disse nada — a regra não muda. O que muda é que
--    deixa de ser anónimo: um turno que o gatilho pôs é 'clock', distinguível de um
--    que alguém escreveu, que é a distinção de que o ponto 2 depende.
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
    NEW.shift_source := COALESCE(NEW.shift_source, 'clock');
  END IF;

  -- Um turno escrito sem dizer de onde veio só pode ter vindo de quem o escreveu.
  -- Sem esta linha, um UPDATE feito à mão no SQL editor ou num ecrã futuro ficaria
  -- com shift_source a NULL, que o ponto 2 e a sync lêem como "derivado" — e a
  -- correcção seria apagada na primeira vez que o SafetyCulture mexesse na acção.
  IF NEW.shift IS NOT NULL AND NEW.shift_source IS NULL THEN
    NEW.shift_source := 'manual';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_quality_action_stamp_shift ON public.quality_actions;
CREATE TRIGGER trg_quality_action_stamp_shift
BEFORE INSERT OR UPDATE OF recorded_at, shift, shift_source ON public.quality_actions
FOR EACH ROW
EXECUTE FUNCTION public.quality_action_stamp_shift();

REVOKE ALL ON FUNCTION public.quality_action_stamp_shift() FROM PUBLIC, anon, authenticated;

-- 4. Nada aqui reescreve um turno já existente.
--
--    A correcção das 123 linhas carimbadas pelo relógio não se faz com um UPDATE em
--    massa: para saber o turno certo é preciso a sessão que estava aberta naquele
--    instante, e essa pergunta vive em sessionInCharge() com uma janela de 16 horas
--    que o SQL aqui teria de duplicar. A sync cura-as sozinha numa re-leitura do
--    período (`full`, ou `since`) — ver a ramificação `shiftImproves` em
--    applyActions, que só mexe em linhas 'clock' e nunca numa 'manual'.
COMMENT ON COLUMN public.quality_actions.shift_source IS
  'Quem decidiu o turno: session (sessão de produção aberta na linha), clock (relógio da fábrica, sem sessão), manual (uma pessoa — nenhuma sync lhe toca).';
