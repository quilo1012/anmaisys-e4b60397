-- F-4: rate-limit por utilizador para os proxies de IA (abuso de custo).
--
-- translate-message e identify-part autenticam o chamador mas não limitam o ritmo, por
-- isso qualquer conta autenticada pode gastar quota paga (identify-part usa Claude Sonnet
-- com visão e imagens até 6 MB — o mais caro). Este é um limitador por (utilizador,
-- balde), em BD (robusto entre instâncias, ao contrário de um contador em memória por
-- instância), reutilizável por qualquer edge function.
--
-- A função é chamada SERVER-SIDE pela edge com a service-role, passando o user_id já
-- verificado do token — por isso recebe _user_id explicitamente e é service_role-only
-- (um utilizador não a pode chamar para manipular o seu próprio contador).

CREATE TABLE IF NOT EXISTS public.ai_usage_limits (
  user_id uuid NOT NULL,
  bucket text NOT NULL,
  window_start timestamptz NOT NULL DEFAULT now(),
  count integer NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, bucket)
);

ALTER TABLE public.ai_usage_limits ENABLE ROW LEVEL SECURITY;
-- Sem policies para anon/authenticated: escrita apenas pela função SECURITY DEFINER
-- (corre como owner) e pelo service_role direto.
GRANT ALL ON public.ai_usage_limits TO service_role;

-- Incrementa a contagem na janela atual e diz se o pedido é permitido. Janela fixa:
-- quando a janela expira, reinicia. Atómico via INSERT ... ON CONFLICT DO UPDATE.
CREATE OR REPLACE FUNCTION public.ai_rate_limit_hit(
  _user_id uuid,
  _bucket text,
  _limit integer,
  _window_seconds integer
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
DECLARE
  _now timestamptz := now();
  _row public.ai_usage_limits%ROWTYPE;
  _expired boolean;
BEGIN
  IF _user_id IS NULL THEN
    RAISE EXCEPTION 'user required';
  END IF;
  IF _bucket IS NULL OR _limit IS NULL OR _limit < 1 OR _window_seconds IS NULL OR _window_seconds < 1 THEN
    RAISE EXCEPTION 'invalid rate-limit parameters';
  END IF;

  INSERT INTO public.ai_usage_limits (user_id, bucket, window_start, count)
  VALUES (_user_id, _bucket, _now, 1)
  ON CONFLICT (user_id, bucket) DO UPDATE SET
    window_start = CASE
      WHEN public.ai_usage_limits.window_start < _now - make_interval(secs => _window_seconds)
      THEN _now ELSE public.ai_usage_limits.window_start END,
    count = CASE
      WHEN public.ai_usage_limits.window_start < _now - make_interval(secs => _window_seconds)
      THEN 1 ELSE public.ai_usage_limits.count + 1 END
  RETURNING * INTO _row;

  IF _row.count > _limit THEN
    RETURN jsonb_build_object(
      'allowed', false,
      'retry_after', GREATEST(1, CEIL(EXTRACT(EPOCH FROM
        (_row.window_start + make_interval(secs => _window_seconds) - _now)))::int));
  END IF;

  RETURN jsonb_build_object('allowed', true, 'remaining', GREATEST(0, _limit - _row.count));
END;
$function$;

-- Server-side only: a edge chama-a com a service-role e o user_id verificado.
REVOKE EXECUTE ON FUNCTION public.ai_rate_limit_hit(uuid, text, integer, integer) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.ai_rate_limit_hit(uuid, text, integer, integer) TO service_role;
