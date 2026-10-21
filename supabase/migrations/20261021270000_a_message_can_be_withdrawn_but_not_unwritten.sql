-- Quem escreveu pode retirar a mensagem. Retirar não é desescrever.
--
-- Hoje ninguém apaga nada: `direct_messages` tem RLS com 5 políticas e **zero** de
-- DELETE, e `chat_group_messages` nem a permissão de tabela dá ao `authenticated`. Está
-- trancado por desenho, e o desenho estava certo — mas deixa sem resposta o caso real e
-- banal: escrevi à pessoa errada, escrevi com um erro, mandei a foto que não era.
--
-- O que isto permite, e só isto:
--
--   * **Só o autor**, e só a sua própria mensagem. Não o destinatário, não o supervisor,
--     não o admin. Quem recebe não reescreve a conversa de quem escreveu, e ninguém
--     limpa o que outro disse.
--   * **Retirada para todos.** Não há "apagar só para mim": numa fábrica, duas pessoas
--     com memórias diferentes da mesma conversa é pior do que uma lacuna que ambas vêem.
--   * **A linha fica.** `deleted_at` marca-a e o conteúdo sai; a linha não. Uma resposta
--     que citava a mensagem continua a apontar para algo, em vez de para o nada.
--
-- O conteúdo sai para string vazia e não para NULL: `direct_messages.message` e
-- `chat_group_messages.body` são `NOT NULL`, e tirar essa restrição mudaria o contrato
-- da tabela para toda a gente só por causa deste caso. O que diz que a mensagem foi
-- retirada é o `deleted_at`, não o conteúdo estar vazio — uma mensagem só com um anexo
-- sempre teve o corpo vazio e não está retirada nenhuma.
--
-- E o que NÃO permite:
--
--   * Não apaga sem deixar rasto. O conteúdo original vai para `audit_logs` antes de sair
--     da tabela do chat — que é onde este sistema já põe tudo o que tem de ser
--     reconstituível. Quem apaga uma combinação de turno não a faz desaparecer; muda-a de
--     sítio, para um sítio que só um admin lê.
--   * Não finge. O conteúdo é mesmo removido das colunas, e não escondido no ecrã: quem
--     ler a API directamente não o encontra. Uma rasura que só o React respeita não é
--     rasura nenhuma.
--
-- Sem janela de tempo. Uma mensagem de ontem é tão retirável como a de agora — pôr cinco
-- minutos de prazo só garante que o erro que se descobre à sexta fica lá para sempre.
--
-- `audit_logs` não tem FK para a mensagem: é de propósito, para a linha de auditoria
-- sobreviver a tudo o que aconteça à conversa.

ALTER TABLE public.direct_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

ALTER TABLE public.chat_group_messages
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid;

-- Uma mensagem privada, retirada por quem a escreveu.
CREATE OR REPLACE FUNCTION public.chat_withdraw_direct_message(_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.direct_messages%ROWTYPE;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required' USING errcode = '42501';
  END IF;

  SELECT * INTO _row FROM public.direct_messages WHERE id = _id FOR UPDATE;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'No such message' USING errcode = 'P0001';
  END IF;
  -- Só o autor. Dito aqui e não numa política, porque a mesma frase tem de valer para
  -- quem chama por RPC e para quem chamasse por outro caminho qualquer.
  IF _row.sender_id <> _uid THEN
    RAISE EXCEPTION 'You can only withdraw your own messages' USING errcode = '42501';
  END IF;
  -- Retirar duas vezes é retirar uma vez. Não volta a escrever a auditoria.
  IF _row.deleted_at IS NOT NULL THEN
    RETURN;
  END IF;

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (_uid, _row.sender_name, 'chat.message_withdrawn', 'direct_message', _row.id,
          jsonb_build_object(
            'recipient_id', _row.recipient_id,
            'sent_at', _row.created_at,
            'message', _row.message,
            'image_url', _row.image_url,
            'audio_url', _row.audio_url));

  UPDATE public.direct_messages
     SET message = '', image_url = NULL, audio_url = NULL,
         deleted_at = now(), deleted_by = _uid
   WHERE id = _id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.chat_withdraw_direct_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_withdraw_direct_message(uuid) TO authenticated;

-- A mesma coisa num grupo. Os anexos saem com ela: as linhas de `chat_attachments`
-- desta mensagem são removidas, senão o ficheiro continuava a aparecer debaixo de um
-- balão vazio. O objecto no storage não é apagado aqui — fica para uma limpeza própria,
-- e o caminho de cada um está na auditoria.
CREATE OR REPLACE FUNCTION public.chat_withdraw_group_message(_id uuid)
RETURNS void
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _row public.chat_group_messages%ROWTYPE;
  _name text;
  _files jsonb;
BEGIN
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Sign in required' USING errcode = '42501';
  END IF;

  SELECT * INTO _row FROM public.chat_group_messages WHERE id = _id FOR UPDATE;
  IF _row.id IS NULL THEN
    RAISE EXCEPTION 'No such message' USING errcode = 'P0001';
  END IF;
  IF _row.sender_id <> _uid THEN
    RAISE EXCEPTION 'You can only withdraw your own messages' USING errcode = '42501';
  END IF;
  IF _row.deleted_at IS NOT NULL THEN
    RETURN;
  END IF;

  SELECT full_name INTO _name FROM public.employees WHERE user_id = _uid AND active LIMIT 1;
  SELECT coalesce(jsonb_agg(to_jsonb(a)), '[]'::jsonb) INTO _files
    FROM public.chat_attachments a WHERE a.message_id = _id;

  INSERT INTO public.audit_logs (user_id, user_name, action, entity_type, entity_id, details)
  VALUES (_uid, _name, 'chat.message_withdrawn', 'group_message', _row.id,
          jsonb_build_object(
            'group_id', _row.group_id,
            'sent_at', _row.created_at,
            'body', _row.body,
            'attachments', _files));

  DELETE FROM public.chat_attachments WHERE message_id = _id;

  UPDATE public.chat_group_messages
     SET body = '', deleted_at = now(), deleted_by = _uid
   WHERE id = _id;
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.chat_withdraw_group_message(uuid) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.chat_withdraw_group_message(uuid) TO authenticated;

notify pgrst, 'reload schema';
