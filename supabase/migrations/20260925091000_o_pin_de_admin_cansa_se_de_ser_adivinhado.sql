-- O PIN de admin aceita tentativas sem fim.
--
-- O PIN de líder não: desde `20260623225146` que `verify_pin_with_lockout()` conta os
-- falhanços em `pin_attempts` e fecha a porta por 30s, 60s, 120s, 300s a partir do
-- sexto. O PIN de admin nunca teve nada disso. `verify_admin_pin()` compara o hash e
-- responde, tantas vezes quantas lhe perguntem.
--
-- O ALVO NÃO É REMOTO. `verify_admin_pin()` já exige o papel de admin, por isso quem
-- adivinha já entrou. É exactamente a pessoa para quem o `AdminPinGate` foi escrito —
-- o portátil deixado aberto no escritório, que é a razão declarada da segunda porta à
-- frente do Attendance e do Finance Close. Quem se senta a esse teclado percorre as
-- 10 000 hipóteses de um PIN de quatro dígitos pela consola do browser, sem que nada
-- o atrase e sem deixar linha nenhuma escrita.
--
-- PORQUE É QUE ISTO NÃO PODE LEVANTAR UMA EXCEPÇÃO PARA DIZER "ESTÁS BLOQUEADO":
-- a chamada inteira é uma transação. Um `RAISE` no fim desfaz o `UPDATE` que acabou
-- de contar o falhanço e o `locked_until` que acabou de ser escrito — o contador
-- nunca chegava ao disco e o bloqueio nunca existia. É por isso que a função dos
-- líderes devolve jsonb em vez de rebentar, e é a mesma forma que se usa aqui.
--
-- `verify_admin_pin(text)` fica de pé, com a mesma assinatura e a mesma resposta
-- booleana, porque `set_intouch_sync_enabled()` chama-a e porque um `CREATE OR
-- REPLACE` com a assinatura igual preserva os privilégios. Passa a delegar, para que
-- a contagem valha em todos os caminhos e não só no da edge function.

-- ── A tabela de tentativas ───────────────────────────────────────────────────
-- Separada de `pin_attempts` de propósito. Partilhar a linha faria um PIN de admin
-- errado bloquear a verificação do PIN de engenheiro da mesma conta, e obrigaria a
-- mexer em `verify_pin_with_lockout()` — a função por onde entra toda a fábrica.
CREATE TABLE IF NOT EXISTS public.admin_pin_attempts (
  user_id      uuid PRIMARY KEY,
  failures     integer NOT NULL DEFAULT 0,
  lockout_step integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_attempt timestamptz NOT NULL DEFAULT now(),
  created_at   timestamptz NOT NULL DEFAULT now(),
  updated_at   timestamptz NOT NULL DEFAULT now()
);

GRANT ALL ON public.admin_pin_attempts TO service_role;
-- Sem grants a anon/authenticated de propósito: só as funções SECURITY DEFINER
-- abaixo lêem e escrevem aqui.

ALTER TABLE public.admin_pin_attempts ENABLE ROW LEVEL SECURITY;
-- Sem policies => fechada. As funções SECURITY DEFINER passam por cima da RLS.

-- ── O verificador com escada ─────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.verify_admin_pin_with_lockout(_pin text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _uid  uuid := auth.uid();
  _now  timestamptz := now();
  _row  public.admin_pin_attempts%ROWTYPE;
  _ok   boolean;
  _step integer;
  _wait integer;
  -- A mesma escada de verify_pin_with_lockout(). Duas escadas diferentes para a
  -- mesma fábrica seriam duas respostas diferentes à mesma pergunta.
  _max_free constant integer   := 5;
  _ladder   constant integer[] := ARRAY[30, 60, 120, 300];
BEGIN
  -- Uma recusa dura não conta tentativa nenhuma, por isso pode rebentar à vontade:
  -- não há estado para perder.
  IF _uid IS NULL OR NOT public.has_role(_uid, 'admin'::app_role) THEN
    RAISE EXCEPTION 'Forbidden: admin role required';
  END IF;

  SELECT * INTO _row FROM public.admin_pin_attempts WHERE user_id = _uid FOR UPDATE;

  IF _row.locked_until IS NOT NULL AND _row.locked_until > _now THEN
    RETURN jsonb_build_object(
      'success', false,
      'error', 'locked',
      'locked_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_row.locked_until - _now)))::int),
      'remaining', 0);
  END IF;

  SELECT EXISTS (
    SELECT 1 FROM public.system_settings
     WHERE admin_pin = extensions.crypt(_pin, admin_pin)
  ) INTO _ok;

  IF _ok THEN
    DELETE FROM public.admin_pin_attempts WHERE user_id = _uid;
    RETURN jsonb_build_object('success', true);
  END IF;

  INSERT INTO public.admin_pin_attempts (user_id, failures, lockout_step, last_attempt, updated_at)
  VALUES (_uid, 1, 0, _now, _now)
  ON CONFLICT (user_id) DO UPDATE
    SET failures     = admin_pin_attempts.failures + 1,
        last_attempt = _now,
        updated_at   = _now
  RETURNING * INTO _row;

  IF _row.failures > _max_free THEN
    _step := LEAST(_row.failures - _max_free, array_length(_ladder, 1));
    _wait := _ladder[_step];
    UPDATE public.admin_pin_attempts
       SET locked_until = _now + make_interval(secs => _wait),
           lockout_step = _step
     WHERE user_id = _uid;
    RETURN jsonb_build_object(
      'success', false, 'error', 'locked', 'locked_seconds', _wait, 'remaining', 0);
  END IF;

  RETURN jsonb_build_object(
    'success', false,
    'error', 'invalid_pin',
    'remaining', GREATEST(0, _max_free - _row.failures));
END;
$function$;

-- Recriar uma função devolve-lhe o EXECUTE do PUBLIC, e com ele o do anon.
REVOKE EXECUTE ON FUNCTION public.verify_admin_pin_with_lockout(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.verify_admin_pin_with_lockout(text) TO authenticated;

COMMENT ON FUNCTION public.verify_admin_pin_with_lockout(text) IS
  'Verifica o PIN de admin com a escada de bloqueio de admin_pin_attempts (5 livres, depois 30/60/120/300s). Devolve jsonb e nunca levanta excepção por PIN errado — um RAISE desfazia a contagem do falhanço.';

-- ── A antiga passa a delegar ─────────────────────────────────────────────────
-- Mesma assinatura e mesmo tipo de retorno: o CREATE OR REPLACE preserva os
-- privilégios que 20260418090223 e 20260623230737 deixaram. Deixa de ser STABLE
-- porque agora escreve — o planeador podia reutilizar o resultado de uma chamada
-- STABLE e a contagem ficava por fazer.
CREATE OR REPLACE FUNCTION public.verify_admin_pin(_pin text)
RETURNS boolean
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
BEGIN
  -- Bloqueado responde o mesmo que errado, que é o que um booleano sabe dizer. Quem
  -- precisa da diferença — o AdminPinGate — chama a função de cima e lê o jsonb.
  RETURN COALESCE(
    (public.verify_admin_pin_with_lockout(_pin) ->> 'success')::boolean,
    false);
END;
$function$;

REVOKE EXECUTE ON FUNCTION public.verify_admin_pin(text) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.verify_admin_pin(text) TO authenticated;

COMMENT ON FUNCTION public.verify_admin_pin(text) IS
  'Delega em verify_admin_pin_with_lockout(). Mantida com a assinatura booleana porque set_intouch_sync_enabled() a chama. Bloqueado e errado respondem ambos false.';
