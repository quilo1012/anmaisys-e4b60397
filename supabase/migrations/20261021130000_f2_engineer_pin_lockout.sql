-- F-2: rate-limit/lockout na verificação do PIN de engenheiro.
--
-- Problema: verify-engineer-pin autentica o chamador (qualquer utilizador com sessão) e
-- chama verify_pin_by_code(_pin), que procura em TODOS os engenheiros ativos por um PIN
-- de 4-6 dígitos SEM contador de tentativas. O caminho de admin já tem lockout
-- (verify_admin_pin_with_lockout + admin_pin_attempts); o de engenheiro não. Como o match
-- é contra qualquer engenheiro, a entropia efetiva é ainda menor e o espaço é
-- brute-forçável por qualquer conta autenticada, devolvendo a identidade de um engenheiro.
--
-- Correção: espelhar exatamente o padrão do admin — tentativas keyed em auth.uid() (o
-- chamador que adivinha), 5 tentativas livres e escada de lockout [30,60,120,300]s. A
-- função é chamada pelo cliente USER-SCOPED na edge (para auth.uid() resolver), tal como
-- verify_admin_pin_with_lockout.
--
-- Não altera verify_pin_by_code (mantém-se service_role-only para compatibilidade até a
-- edge atualizada estar confirmada em produção; pode ser removida num follow-up).

-- 1) Tentativas por chamador (mesma forma que admin_pin_attempts; escrita só pela função)
CREATE TABLE IF NOT EXISTS public.engineer_pin_attempts (
  user_id uuid PRIMARY KEY,
  failures integer NOT NULL DEFAULT 0,
  lockout_step integer NOT NULL DEFAULT 0,
  locked_until timestamptz,
  last_attempt timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.engineer_pin_attempts ENABLE ROW LEVEL SECURITY;
-- Sem policies para anon/authenticated: a tabela é escrita apenas pela função
-- SECURITY DEFINER (que corre como owner). O service_role mantém acesso direto.
GRANT ALL ON public.engineer_pin_attempts TO service_role;

-- 2) Verificação com lockout. Devolve jsonb, como o lado admin.
CREATE OR REPLACE FUNCTION public.verify_engineer_pin_with_lockout(_pin text)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  _uid uuid := auth.uid();
  _now timestamptz := now();
  _row public.engineer_pin_attempts%ROWTYPE;
  _eid uuid;
  _ename text;
  _step integer;
  _wait integer;
  _max_free constant integer := 5;
  _ladder constant integer[] := ARRAY[30, 60, 120, 300];
BEGIN
  -- Tem de ser chamada por um cliente user-scoped (auth.uid() não nulo). Mantém o
  -- comportamento atual: qualquer utilizador autenticado pode verificar, sem role
  -- específica — o lockout conta contra quem adivinha.
  IF _uid IS NULL THEN
    RAISE EXCEPTION 'Forbidden: sign in required';
  END IF;

  SELECT * INTO _row FROM public.engineer_pin_attempts WHERE user_id = _uid FOR UPDATE;

  IF _row.locked_until IS NOT NULL AND _row.locked_until > _now THEN
    RETURN jsonb_build_object(
      'success', false, 'error', 'locked',
      'locked_seconds', GREATEST(1, CEIL(EXTRACT(EPOCH FROM (_row.locked_until - _now)))::int),
      'remaining', 0);
  END IF;

  SELECT e.id, e.name INTO _eid, _ename
  FROM public.engineers e
  WHERE e.is_active = true
    AND e.pin_hash = extensions.crypt(_pin, e.pin_hash)
  LIMIT 1;

  IF _eid IS NOT NULL THEN
    DELETE FROM public.engineer_pin_attempts WHERE user_id = _uid;
    RETURN jsonb_build_object('success', true, 'engineer_id', _eid, 'engineer_name', _ename);
  END IF;

  INSERT INTO public.engineer_pin_attempts (user_id, failures, lockout_step, last_attempt, updated_at)
  VALUES (_uid, 1, 0, _now, _now)
  ON CONFLICT (user_id) DO UPDATE
    SET failures = engineer_pin_attempts.failures + 1, last_attempt = _now, updated_at = _now
  RETURNING * INTO _row;

  IF _row.failures > _max_free THEN
    _step := LEAST(_row.failures - _max_free, array_length(_ladder, 1));
    _wait := _ladder[_step];
    UPDATE public.engineer_pin_attempts
       SET locked_until = _now + make_interval(secs => _wait), lockout_step = _step
     WHERE user_id = _uid;
    RETURN jsonb_build_object('success', false, 'error', 'locked', 'locked_seconds', _wait, 'remaining', 0);
  END IF;

  RETURN jsonb_build_object('success', false, 'error', 'invalid_pin',
    'remaining', GREATEST(0, _max_free - _row.failures));
END;
$function$;

-- 3) Grants: chamada pelo cliente user-scoped (authenticated). Nunca anon.
REVOKE EXECUTE ON FUNCTION public.verify_engineer_pin_with_lockout(text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.verify_engineer_pin_with_lockout(text) TO authenticated, service_role;
