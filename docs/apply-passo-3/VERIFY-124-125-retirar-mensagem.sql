-- Verificação dos BLOCOS 124 e 125 — retirar uma mensagem privada.
--
-- Corre tudo dentro de uma transacção que termina em erro de propósito, por isso NÃO
-- deixa nada alterado: a última linha aborta e o Postgres desfaz as cinco tentativas.
-- Pode correr-se na produção com a conversa a decorrer.
--
-- Faz-se passar pelo autor e pelo destinatário com `request.jwt.claims`, que é o mesmo
-- sítio de onde o `auth.uid()` lê quando o pedido vem pelo PostgREST. Sem isso,
-- `auth.uid()` é NULL e a primeira verificação recusaria tudo — o que diria que a guarda
-- funciona sem provar que a retirada funciona.
--
-- Resultado esperado, nas cinco linhas:
--
--   EDITAR a coberto: recusado — Withdrawing a message removes its content; it cannot change it
--   AUTOR retira: ok
--   DESFAZER: recusado — A withdrawn message cannot be restored
--   DESTINATARIO retira a do outro: recusado — You can only withdraw your own messages
--   DESTINATARIO marca lido: ok
--
-- Qualquer "PASSOU (mau)" ou "FALHOU" é uma regressão.

do $$
declare
  _id uuid; _sender uuid; _rec uuid; _log text := '';
begin
  select id, sender_id, recipient_id into _id, _sender, _rec
    from public.direct_messages where deleted_at is null order by created_at desc limit 1;
  if _id is null then
    raise exception 'Não há nenhuma mensagem por retirar para ensaiar.';
  end if;

  perform set_config('request.jwt.claims', json_build_object('sub', _sender)::text, true);

  -- A porta que o gatilho existe para fechar: trocar o texto com `deleted_at` à boleia.
  begin
    update public.direct_messages set message='x novo', deleted_at=now(), deleted_by=_sender where id=_id;
    _log := _log || E'\nEDITAR a coberto da retirada: PASSOU (mau)';
  exception when others then _log := _log || E'\nEDITAR a coberto: recusado — ' || sqlerrm; end;

  begin
    update public.direct_messages set message='', image_url=null, audio_url=null,
           deleted_at=now(), deleted_by=_sender where id=_id;
    _log := _log || E'\nAUTOR retira: ok';
  exception when others then _log := _log || E'\nAUTOR retira: FALHOU — ' || sqlerrm; end;

  begin
    update public.direct_messages set deleted_at=null, deleted_by=null where id=_id;
    _log := _log || E'\nDESFAZER: PASSOU (mau)';
  exception when others then _log := _log || E'\nDESFAZER: recusado — ' || sqlerrm; end;

  -- Outra mensagem ainda inteira, agora pelos olhos de quem a recebeu.
  select id, sender_id, recipient_id into _id, _sender, _rec
    from public.direct_messages where deleted_at is null order by created_at desc limit 1;
  perform set_config('request.jwt.claims', json_build_object('sub', _rec)::text, true);

  begin
    update public.direct_messages set message='', image_url=null, audio_url=null,
           deleted_at=now(), deleted_by=_rec where id=_id;
    _log := _log || E'\nDESTINATARIO retira a do outro: PASSOU (mau)';
  exception when others then _log := _log || E'\nDESTINATARIO retira a do outro: recusado — ' || sqlerrm; end;

  -- E o que ele sempre pôde fazer continua a poder.
  begin
    update public.direct_messages set read_at=now() where id=_id;
    _log := _log || E'\nDESTINATARIO marca lido: ok';
  exception when others then _log := _log || E'\nDESTINATARIO marca lido: FALHOU — ' || sqlerrm; end;

  raise exception 'RESULTADO:%', _log;
end $$;
