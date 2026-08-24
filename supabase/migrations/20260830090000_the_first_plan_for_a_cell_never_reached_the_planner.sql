-- O primeiro plano de uma celula nunca chegava ao Planner.
--
-- `trg_sync_items_target_from_rag` nasceu a 27/06 como AFTER UPDATE OF plan_qty. Um
-- plano escrito numa celula que ainda nao tem linha em rag_weekly_entries e um INSERT
-- - `RAGWeeklyPage.commitValue` chama `onSave` quando `entryMap` nao tem a chave - por
-- isso o gatilho nao disparava e `production_items.target_qty` ficava com o que la
-- estivesse. Nao e um caso de canto: e exactamente a primeira vez que se planeia cada
-- linha/turno, que e quando o numero e escrito.
--
-- O outro lado do mesmo defeito estava no frontend: o "Sync from Planner & Downtime"
-- somava os target_qty e escrevia o total por cima do plan_qty. Com o gatilho a nao
-- disparar no INSERT, o que a Sync trazia de volta era o alvo velho dos SKUs - e o
-- quadro perdia o plano acordado. Ver src/lib/ragPlanOwnership.ts.
--
-- Aqui trata-se so da metade que vive na base de dados: o gatilho passa a cobrir o
-- INSERT. A funcao nao muda de logica, ganha uma guarda - num INSERT nao ha OLD, e
-- `NEW.plan_qty IS NOT DISTINCT FROM OLD.plan_qty` e falso mesmo quando o plano e zero
-- ou nulo, o que poria a zero os alvos de uma sessao so por alguem ter criado a linha
-- para escrever um comentario ou um tempo de paragem.

CREATE OR REPLACE FUNCTION public.sync_items_target_from_rag()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  _session_id uuid;
  _sum_target numeric;
  _n int;
  _new_plan numeric := COALESCE(NEW.plan_qty, 0);
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Uma linha criada sem plano nao e uma instrucao para zerar o Planner.
    IF _new_plan <= 0 THEN
      RETURN NULL;
    END IF;
  ELSIF NEW.plan_qty IS NOT DISTINCT FROM OLD.plan_qty THEN
    RETURN NULL;
  END IF;

  SELECT id INTO _session_id
    FROM public.production_sessions
   WHERE session_date = NEW.entry_date AND line = NEW.line AND shift = NEW.shift
   LIMIT 1;
  IF _session_id IS NULL THEN
    RETURN NULL;
  END IF;

  SELECT COALESCE(SUM(COALESCE(target_qty, planned_qty, 0)), 0), COUNT(*)
    INTO _sum_target, _n
    FROM public.production_items
   WHERE session_id = _session_id;

  IF _n = 0 THEN RETURN NULL; END IF;

  IF _sum_target > 0 THEN
    -- Scale proportionally to existing targets.
    UPDATE public.production_items
       SET target_qty  = ROUND(COALESCE(target_qty, planned_qty, 0) * _new_plan / _sum_target),
           planned_qty = ROUND(COALESCE(target_qty, planned_qty, 0) * _new_plan / _sum_target),
           updated_at  = now()
     WHERE session_id = _session_id;
  ELSE
    -- Even split when no prior target exists.
    UPDATE public.production_items
       SET target_qty  = ROUND(_new_plan / _n),
           planned_qty = ROUND(_new_plan / _n),
           updated_at  = now()
     WHERE session_id = _session_id;
  END IF;

  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_sync_items_target_from_rag ON public.rag_weekly_entries;
CREATE TRIGGER trg_sync_items_target_from_rag
AFTER INSERT OR UPDATE OF plan_qty ON public.rag_weekly_entries
FOR EACH ROW EXECUTE FUNCTION public.sync_items_target_from_rag();

COMMENT ON FUNCTION public.sync_items_target_from_rag() IS
  'Reescala production_items.target_qty quando um plano da RAG e criado ou alterado. rag_weekly_entries.plan_qty e a fonte de verdade do plano; production_items segue-a. Um INSERT sem plano nao mexe em nada.';
