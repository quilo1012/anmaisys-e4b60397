-- O heartbeat do engineer escrevia em `profiles` e o Postgres recusava sempre.
--
-- `useHeartbeat` faz `.from("profiles").update({ last_seen_at })` de 30 em 30 segundos
-- enquanto um engineer tem o dashboard aberto. Root Diagnostics registou seis
-- `42501 permission denied for table profiles` entre 28/08 07:15 e 29/08 08:40, todos
-- em /dashboard/engineer, todos PATCH. Nao falhou uma vez: falha todas, desde sempre.
--
-- Nao e RLS, apesar de aparecer como RLS_ERROR — a policy "Users can update own profile"
-- deixa passar, e `authenticated` tem UPDATE na tabela. O que falta e o SELECT: o
-- PostgREST escreve `UPDATE ... RETURNING profiles.*` mesmo quando o cliente nao pede a
-- linha de volta, e o SELECT de tabela em `profiles` esta revogado desde 20260724130000
-- para o `labor_rate` — o custo/hora de cada pessoa — nao viajar para o browser. Sao os
-- outros nove campos que estao concedidos coluna a coluna, e por isso todos os SELECT
-- explicitos do codigo funcionam; o `RETURNING *` e que nao pode.
--
-- O erro traz a sugestao `GRANT SELECT ON public.profiles TO authenticated` na propria
-- HINT. Segui-la devolve o labor_rate a quem a RLS deixa ver a linha, e a policy
-- "Managers can view non-admin profiles" deixa um manager ver a de toda a gente. A
-- revogacao ja foi reposta em dez migracoes diferentes desde Abril; o caminho nao e
-- repo-la outra vez, e deixar de precisar de ler a linha.
--
-- `touch_last_seen()` escreve a coluna e nao devolve nada. Nao aceita argumentos, por
-- isso ninguem marca ninguem — so a si proprio, pelo `auth.uid()` do pedido, que um
-- SECURITY DEFINER preserva porque vive nas claims e nao no papel da sessao. Os dois
-- triggers de `profiles` continuam a correr: `guard_profile_sensitive` repoe os campos
-- que um utilizador comum nao pode mexer e `guard_profile_labor_rate` recusa quem tente
-- o labor_rate — nenhum deles se opoe a esta coluna.

CREATE OR REPLACE FUNCTION public.touch_last_seen()
RETURNS void
LANGUAGE sql
SECURITY DEFINER
SET search_path TO 'public'
AS $function$
  UPDATE public.profiles SET last_seen_at = now() WHERE id = auth.uid();
$function$;

REVOKE ALL ON FUNCTION public.touch_last_seen() FROM public, anon;
GRANT EXECUTE ON FUNCTION public.touch_last_seen() TO authenticated;

COMMENT ON FUNCTION public.touch_last_seen() IS
  'Marca o proprio last_seen_at. Existe porque o PATCH direto a public.profiles nao pode '
  'funcionar: o PostgREST faz RETURNING da linha inteira e authenticated nao tem SELECT em '
  'labor_rate (revogado de proposito), logo o heartbeat devolvia 42501 permission denied '
  'for table profiles. Escreve so a coluna do proprio auth.uid(); nao aceita argumentos, '
  'para nao poder marcar outra pessoa. Ver 20260916090000.';
