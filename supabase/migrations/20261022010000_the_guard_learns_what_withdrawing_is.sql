-- A guarda das mensagens aprende o que é retirar.
--
-- `20261021270000` pôs a retirada a funcionar e ela falhava à primeira tentativa:
--
--     22/10 00:26, 00:37, 00:43 · /dashboard/communication · admin
--     RLS_ERROR — A message can only be marked as read
--
-- A frase é do gatilho `dm_only_read_at_changes_t`, BEFORE UPDATE em
-- `direct_messages`, que recusa qualquer alteração a `message`, `image_url` ou
-- `audio_url`. Existe para que uma mensagem enviada não possa ser reescrita, e está
-- certo que exista — eu é que escrevi uma função que muda exactamente essas três
-- colunas e não fui ver o que guardava a tabela do outro lado.
--
-- A guarda não se desarma. Aprende que há uma transição legítima, e continua a recusar
-- tudo o resto:
--
--   * **Só tira.** A retirada põe `message` a vazio e os dois anexos a NULL. Trocar o
--     texto por outro, com `deleted_at` preenchido à boleia, é recusado — senão isto
--     passava a ser a porta de edição que o gatilho existe para fechar.
--   * **Só o autor.** `auth.uid()` tem de ser o `sender_id`. Não é só a RPC que fica
--     fechada: a política de UPDATE desta tabela deixa **o destinatário** escrever (é
--     assim que o "lido" é marcado), e sem esta linha ele podia retirar a mensagem de
--     quem lha mandou.
--   * **Só uma vez, e sem volta.** `deleted_at` não se altera nem se limpa depois de
--     posto. Uma retirada que se pudesse desfazer não era uma retirada.
--   * **A identidade e a hora nunca mudam**, em qualquer caminho — como já era.
--
-- `chat_group_messages` não leva nada disto: não tem gatilho de UPDATE nem política que
-- deixe alguém escrever lá a direito, por isso a sua retirada já só acontece pela RPC.

CREATE OR REPLACE FUNCTION public.dm_only_read_at_changes()
RETURNS trigger
LANGUAGE plpgsql
SET search_path TO 'public'
AS $function$
BEGIN
  -- Quem escreveu, a quem, e quando. Nunca muda, seja qual for o caminho.
  IF new.sender_id is distinct from old.sender_id
  OR new.recipient_id is distinct from old.recipient_id
  OR new.sender_name is distinct from old.sender_name
  OR new.created_at is distinct from old.created_at THEN
    RAISE EXCEPTION 'A message can only be marked as read' USING errcode = '42501';
  END IF;

  -- Uma retirada já feita não se desfaz nem se repete.
  IF old.deleted_at IS NOT NULL AND new.deleted_at IS DISTINCT FROM old.deleted_at THEN
    RAISE EXCEPTION 'A withdrawn message cannot be restored' USING errcode = '42501';
  END IF;

  -- A transição de ida: a mensagem passa a retirada.
  IF old.deleted_at IS NULL AND new.deleted_at IS NOT NULL THEN
    IF auth.uid() IS DISTINCT FROM old.sender_id THEN
      RAISE EXCEPTION 'You can only withdraw your own messages' USING errcode = '42501';
    END IF;
    IF new.deleted_by IS DISTINCT FROM auth.uid() THEN
      RAISE EXCEPTION 'A withdrawal is recorded against whoever made it' USING errcode = '42501';
    END IF;
    -- Retirar tira. Não troca.
    IF coalesce(new.message, '') <> ''
    OR new.image_url IS NOT NULL
    OR new.audio_url IS NOT NULL THEN
      RAISE EXCEPTION 'Withdrawing a message removes its content; it cannot change it'
        USING errcode = '42501';
    END IF;
    RETURN new;
  END IF;

  -- Fora da retirada, o conteúdo continua imutável: só `read_at` muda.
  IF new.message is distinct from old.message
  OR new.audio_url is distinct from old.audio_url
  OR new.image_url is distinct from old.image_url THEN
    RAISE EXCEPTION 'A message can only be marked as read' USING errcode = '42501';
  END IF;

  RETURN new;
END;
$function$;

notify pgrst, 'reload schema';
