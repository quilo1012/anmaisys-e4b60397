-- Gel Machine → Gel Packing — CORRECÇÃO (escreve). Uma só transacção: ou tudo, ou nada.
-- Colar inteiro no Lovable → More → Cloud → SQL editor, DEPOIS de ler 00-LEIA-PRIMEIRO.md.
--
-- O que estava ligado mal (medido em produção a 30/10/2026, só contagens):
--   * a conta de tablet "Gel Machine" (operator_line_accounts.label) aponta para a linha
--     "Gel Machine" (89b84e25…), criada a 28/09. O tablet grava a linha pelo NOME da
--     linha da conta, por isso tudo o que o packing do gel lançou desde então foi para
--     "Gel Machine", enquanto o plano do RAG está em "Gel Packing" → cartão "NO PLAN".
--   * a máquina iTouching "Gel Packing" (nunca reportou estado, só fila de trabalhos)
--     está ligada à linha "Gel Machine" — é ela que põe "Gel Packing" por baixo do título
--     "GEL MACHINE" no cartão.
--   * a máquina iTouching "GEL Line" esteve ligada à linha "Gel Machine" de 06/10 a 24/10
--     e escreveu paragens e estados com esse nome; desde 24/10 está em "Gel Packing".
--
-- Nada é apagado excepto duas linhas que são duplicados vazios ou derivados (ver passo 4
-- e 5); ambas vão para a cópia antes. Nenhuma máquina nem linha é apagada: a linha
-- "Gel Machine" fica inactiva. Para desfazer: 4-REVERTER.sql.

BEGIN;

-- 0. Cópia de tudo o que vai mudar, linha a linha, para o 4-REVERTER.sql.
CREATE TABLE IF NOT EXISTS public._bkp_gel_machine_20261030 (
  tbl      text        NOT NULL,
  row_id   text        NOT NULL,
  action   text        NOT NULL CHECK (action IN ('update', 'delete')),
  old      jsonb       NOT NULL,
  saved_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (tbl, row_id)
);
ALTER TABLE public._bkp_gel_machine_20261030 ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public._bkp_gel_machine_20261030 FROM anon, authenticated;

DO $$
DECLARE
  gm uuid;
  gp uuid;
  n  int;
BEGIN
  SELECT id INTO gm FROM public.lines WHERE name = 'Gel Machine';
  SELECT id INTO gp FROM public.lines WHERE name = 'Gel Packing';
  IF gm IS NULL OR gp IS NULL THEN
    RAISE EXCEPTION 'Esperava as linhas "Gel Machine" e "Gel Packing" em public.lines (gm=%, gp=%)', gm, gp;
  END IF;
  IF EXISTS (SELECT 1 FROM public._bkp_gel_machine_20261030) THEN
    RAISE EXCEPTION 'A cópia _bkp_gel_machine_20261030 já tem linhas: esta correcção já correu. Ver 3-VERIFICAR.sql.';
  END IF;

  -- 1. A conta do tablet: troca a linha, mantém o rótulo.
  --    O rótulo é o nome com que o operador entra (loginIdentity.ts procura por ele);
  --    mudá-lo deixava o tablet sem login.
  INSERT INTO public._bkp_gel_machine_20261030 (tbl, row_id, action, old)
  SELECT 'operator_line_accounts', a.id::text, 'update', to_jsonb(a)
    FROM public.operator_line_accounts a WHERE gm = ANY (a.line_ids);
  UPDATE public.operator_line_accounts
     SET line_ids = (SELECT array_agg(DISTINCT x) FROM unnest(array_replace(line_ids, gm, gp)) x)
   WHERE gm = ANY (line_ids);
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '1. contas de tablet re-ligadas: %', n;

  -- 2. O mapa iTouching: o que apontava para "Gel Machine" passa a "Gel Packing" e fica
  --    inactivo. Activo, o sync somava a fila dele (BERBERINE, um produto de cápsulas)
  --    à produção do Gel Packing. A linha do mapa não é apagada.
  INSERT INTO public._bkp_gel_machine_20261030 (tbl, row_id, action, old)
  SELECT 'intouch_machine_map', m.id::text, 'update', to_jsonb(m)
    FROM public.intouch_machine_map m WHERE m.line_id = gm;
  UPDATE public.intouch_machine_map SET line_id = gp, active = false WHERE line_id = gm;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '2. máquinas iTouching re-ligadas e desactivadas: %', n;

  -- 3. Sessões do tablet. Unique (session_date, line, shift): se o Gel Packing já tem a
  --    sessão desse turno, a de "Gel Machine" só pode ir embora se estiver vazia.
  IF EXISTS (
    SELECT 1
      FROM public.production_sessions s
      JOIN public.production_sessions p
        ON p.session_date = s.session_date AND p.shift = s.shift AND p.line = 'Gel Packing'
     WHERE s.line = 'Gel Machine'
       AND (   EXISTS (SELECT 1 FROM public.production_items i           WHERE i.session_id = s.id)
            OR EXISTS (SELECT 1 FROM public.production_blender_entries b WHERE b.session_id = s.id)
            OR EXISTS (SELECT 1 FROM public.quality_actions q            WHERE q.session_id = s.id))
  ) THEN
    RAISE EXCEPTION 'Há um turno com sessão em "Gel Machine" E em "Gel Packing" e a de "Gel Machine" tem conteúdo. Parar e juntar à mão.';
  END IF;

  INSERT INTO public._bkp_gel_machine_20261030 (tbl, row_id, action, old)
  SELECT 'production_sessions', s.id::text, 'delete', to_jsonb(s)
    FROM public.production_sessions s
   WHERE s.line = 'Gel Machine'
     AND EXISTS (SELECT 1 FROM public.production_sessions p
                  WHERE p.session_date = s.session_date AND p.shift = s.shift AND p.line = 'Gel Packing');
  DELETE FROM public.production_sessions s
   WHERE s.line = 'Gel Machine'
     AND EXISTS (SELECT 1 FROM public.production_sessions p
                  WHERE p.session_date = s.session_date AND p.shift = s.shift AND p.line = 'Gel Packing');
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '3a. sessões vazias duplicadas removidas (copiadas): %', n;

  INSERT INTO public._bkp_gel_machine_20261030 (tbl, row_id, action, old)
  SELECT 'production_sessions', s.id::text, 'update', to_jsonb(s)
    FROM public.production_sessions s WHERE s.line = 'Gel Machine';
  UPDATE public.production_sessions SET line = 'Gel Packing' WHERE line = 'Gel Machine';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '3b. sessões movidas (itens, lotes, horas, líder seguem pelo id): %', n;

  -- 4. Histórico por SKU (derivado dos itens pelo trigger sync_sku_history_from_item).
  --    Unique (line_id, sku_id, session_date, shift): onde o Gel Packing já tem a linha,
  --    é ela que vale — o item está na sessão do Gel Packing — e a de "Gel Machine" é o
  --    resto de quando o item lá esteve.
  INSERT INTO public._bkp_gel_machine_20261030 (tbl, row_id, action, old)
  SELECT 'sku_production_history', h.id::text,
         CASE WHEN EXISTS (SELECT 1 FROM public.sku_production_history g
                            WHERE g.line_id = gp AND g.sku_id = h.sku_id
                              AND g.session_date = h.session_date AND g.shift = h.shift)
              THEN 'delete' ELSE 'update' END,
         to_jsonb(h) - 'units_per_hour'
    FROM public.sku_production_history h WHERE h.line_id = gm;
  DELETE FROM public.sku_production_history h
   WHERE h.line_id = gm
     AND EXISTS (SELECT 1 FROM public.sku_production_history g
                  WHERE g.line_id = gp AND g.sku_id = h.sku_id
                    AND g.session_date = h.session_date AND g.shift = h.shift);
  UPDATE public.sku_production_history SET line_id = gp WHERE line_id = gm;
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '4. histórico por SKU movido: %', n;

  -- 5. Plano do RAG e metas por SKU: texto livre, com chaves únicas. Colisão = parar.
  IF EXISTS (SELECT 1 FROM public.rag_weekly_entries r
               JOIN public.rag_weekly_entries p
                 ON p.entry_date = r.entry_date AND p.shift = r.shift AND p.line = 'Gel Packing'
              WHERE r.line = 'Gel Machine') THEN
    RAISE EXCEPTION 'O RAG tem o mesmo dia/turno em "Gel Machine" e "Gel Packing". Parar e juntar à mão.';
  END IF;
  IF EXISTS (SELECT 1 FROM public.production_targets t
               JOIN public.production_targets p
                 ON p.sku_id = t.sku_id AND p.shift = t.shift AND p.line = 'Gel Packing'
              WHERE t.line = 'Gel Machine') THEN
    RAISE EXCEPTION 'production_targets tem o mesmo SKU/turno em "Gel Machine" e "Gel Packing". Parar e juntar à mão.';
  END IF;

  INSERT INTO public._bkp_gel_machine_20261030 (tbl, row_id, action, old)
  SELECT 'rag_weekly_entries', r.id::text, 'update', to_jsonb(r)
    FROM public.rag_weekly_entries r WHERE r.line = 'Gel Machine';
  UPDATE public.rag_weekly_entries SET line = 'Gel Packing' WHERE line = 'Gel Machine';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '5a. linhas do RAG movidas: %', n;

  INSERT INTO public._bkp_gel_machine_20261030 (tbl, row_id, action, old)
  SELECT 'production_targets', t.id::text, 'update', to_jsonb(t)
    FROM public.production_targets t WHERE t.line = 'Gel Machine';
  UPDATE public.production_targets SET line = 'Gel Packing' WHERE line = 'Gel Machine';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '5b. metas por SKU movidas: %', n;

  -- 6. Paragens e estados que o iTouching escreveu com o nome "Gel Machine" (06/10–24/10).
  --    O trigger de paragens planeadas procura ordens com line_at_time = 'Gel Packing';
  --    não há nenhuma (medido), por isso não cria pausas novas.
  INSERT INTO public._bkp_gel_machine_20261030 (tbl, row_id, action, old)
  SELECT 'production_downtimes', d.id::text, 'update', to_jsonb(d)
    FROM public.production_downtimes d WHERE d.line = 'Gel Machine';
  UPDATE public.production_downtimes SET line = 'Gel Packing' WHERE line = 'Gel Machine';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '6a. paragens movidas: %', n;

  INSERT INTO public._bkp_gel_machine_20261030 (tbl, row_id, action, old)
  SELECT 'intouch_status_log', l.id::text, 'update', jsonb_build_object('line', l.line)
    FROM public.intouch_status_log l WHERE l.line = 'Gel Machine';
  UPDATE public.intouch_status_log SET line = 'Gel Packing' WHERE line = 'Gel Machine';
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '6b. estados iTouching movidos: %', n;

  -- 7. O actual do RAG deriva das sessões (trigger rag_actual_is_derived) e só se
  --    recalcula quando a linha do RAG é escrita. Mover sessões não a toca, por isso
  --    toca-se aqui nas linhas do Gel Packing dos dias que receberam sessões.
  UPDATE public.rag_weekly_entries r
     SET line = r.line
   WHERE r.line = 'Gel Packing'
     AND r.entry_date IN (SELECT (b.old->>'session_date')::date
                            FROM public._bkp_gel_machine_20261030 b
                           WHERE b.tbl = 'production_sessions');
  GET DIAGNOSTICS n = ROW_COUNT; RAISE NOTICE '7. linhas do RAG recalculadas: %', n;

  -- 8. A linha "Gel Machine" fica inactiva, não apagada.
  INSERT INTO public._bkp_gel_machine_20261030 (tbl, row_id, action, old)
  SELECT 'lines', l.id::text, 'update', to_jsonb(l) FROM public.lines l WHERE l.id = gm;
  UPDATE public.lines SET active = false WHERE id = gm;
  RAISE NOTICE '8. linha "Gel Machine" desactivada';

  -- Nada pode ter ficado para trás nas tabelas que este script corrige.
  SELECT (SELECT count(*) FROM public.production_sessions    WHERE line = 'Gel Machine')
       + (SELECT count(*) FROM public.rag_weekly_entries     WHERE line = 'Gel Machine')
       + (SELECT count(*) FROM public.production_targets     WHERE line = 'Gel Machine')
       + (SELECT count(*) FROM public.production_downtimes   WHERE line = 'Gel Machine')
       + (SELECT count(*) FROM public.intouch_status_log     WHERE line = 'Gel Machine')
       + (SELECT count(*) FROM public.sku_production_history WHERE line_id = gm)
       + (SELECT count(*) FROM public.intouch_machine_map    WHERE line_id = gm)
       + (SELECT count(*) FROM public.operator_line_accounts WHERE gm = ANY (line_ids))
    INTO n;
  IF n <> 0 THEN
    RAISE EXCEPTION 'Ficaram % registos ligados a "Gel Machine". Tudo desfeito.', n;
  END IF;
END
$$;

COMMIT;

-- Depois: 3-VERIFICAR.sql, e recarregar o tablet do Gel Packing (a conta é lida ao abrir).
