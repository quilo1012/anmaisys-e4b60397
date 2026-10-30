-- Gel Machine → Gel Packing — REVERTER (escreve). Põe tudo como estava antes do 2-CORRIGIR.sql,
-- a partir da cópia public._bkp_gel_machine_20261030. Uma só transacção.
--
-- Atenção: o que o tablet lançar em "Gel Packing" DEPOIS da correcção não está na cópia
-- e fica onde está. Só volta atrás o que a correcção mexeu.

BEGIN;

DO $$
DECLARE n int;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM public._bkp_gel_machine_20261030) THEN
    RAISE EXCEPTION 'A cópia está vazia: não há nada para reverter.';
  END IF;

  UPDATE public.lines t SET active = (b.old->>'active')::boolean
    FROM public._bkp_gel_machine_20261030 b
   WHERE b.tbl = 'lines' AND t.id::text = b.row_id;

  UPDATE public.operator_line_accounts t
     SET line_ids = ARRAY(SELECT jsonb_array_elements_text(b.old->'line_ids'))::uuid[]
    FROM public._bkp_gel_machine_20261030 b
   WHERE b.tbl = 'operator_line_accounts' AND t.id::text = b.row_id;

  UPDATE public.intouch_machine_map t
     SET line_id = (b.old->>'line_id')::uuid, active = (b.old->>'active')::boolean
    FROM public._bkp_gel_machine_20261030 b
   WHERE b.tbl = 'intouch_machine_map' AND t.id::text = b.row_id;

  -- Sessões: primeiro as movidas, depois as vazias que foram removidas.
  UPDATE public.production_sessions t SET line = b.old->>'line'
    FROM public._bkp_gel_machine_20261030 b
   WHERE b.tbl = 'production_sessions' AND b.action = 'update' AND t.id::text = b.row_id;
  INSERT INTO public.production_sessions
  SELECT (jsonb_populate_record(NULL::public.production_sessions, b.old)).*
    FROM public._bkp_gel_machine_20261030 b
   WHERE b.tbl = 'production_sessions' AND b.action = 'delete';

  UPDATE public.sku_production_history t SET line_id = (b.old->>'line_id')::uuid
    FROM public._bkp_gel_machine_20261030 b
   WHERE b.tbl = 'sku_production_history' AND b.action = 'update' AND t.id::text = b.row_id;
  INSERT INTO public.sku_production_history (id, line_id, sku_id, session_date, shift, quantity, run_minutes, created_at, updated_at)
  SELECT (b.old->>'id')::uuid, (b.old->>'line_id')::uuid, (b.old->>'sku_id')::uuid,
         (b.old->>'session_date')::date, b.old->>'shift', (b.old->>'quantity')::int,
         (b.old->>'run_minutes')::int, (b.old->>'created_at')::timestamptz, (b.old->>'updated_at')::timestamptz
    FROM public._bkp_gel_machine_20261030 b
   WHERE b.tbl = 'sku_production_history' AND b.action = 'delete';

  UPDATE public.rag_weekly_entries t SET line = b.old->>'line'
    FROM public._bkp_gel_machine_20261030 b
   WHERE b.tbl = 'rag_weekly_entries' AND t.id::text = b.row_id;

  UPDATE public.production_targets t SET line = b.old->>'line'
    FROM public._bkp_gel_machine_20261030 b
   WHERE b.tbl = 'production_targets' AND t.id::text = b.row_id;

  UPDATE public.production_downtimes t SET line = b.old->>'line'
    FROM public._bkp_gel_machine_20261030 b
   WHERE b.tbl = 'production_downtimes' AND t.id::text = b.row_id;

  UPDATE public.intouch_status_log t SET line = b.old->>'line'
    FROM public._bkp_gel_machine_20261030 b
   WHERE b.tbl = 'intouch_status_log' AND t.id::text = b.row_id;

  -- O actual do RAG volta a derivar das sessões, agora outra vez separadas.
  UPDATE public.rag_weekly_entries r SET line = r.line
   WHERE r.line IN ('Gel Packing', 'Gel Machine')
     AND r.entry_date IN (SELECT (b.old->>'session_date')::date
                            FROM public._bkp_gel_machine_20261030 b
                           WHERE b.tbl = 'production_sessions');

  SELECT count(*) INTO n FROM public._bkp_gel_machine_20261030;
  RAISE NOTICE 'Revertidos % registos. A cópia fica, para a apagar à mão quando quiser.', n;
END
$$;

-- Esvazia a cópia, para que o 2-CORRIGIR.sql possa voltar a correr se for preciso.
-- (Fica comentado: só depois de confirmar com o 3-VERIFICAR.sql que voltou tudo.)
-- DELETE FROM public._bkp_gel_machine_20261030;

COMMIT;
