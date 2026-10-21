-- F-1 (raiz): fechar o EXECUTE de `anon` por default no schema public.
--
-- Problema: o schema `public` tem ALTER DEFAULT PRIVILEGES que concede EXECUTE a `anon`
-- a TODA a função nova. O sweep de 27/06 (REVOKE ALL ON ALL FUNCTIONS ... FROM anon) só
-- cobriu as funções existentes nesse instante; cada função criada depois volta a ganhar
-- anon=EXECUTE, e a proteção passou a depender de cada função fazer o seu auth.uid()-check.
-- Isto já deixou PII de empregados acessível à chave anónima (overtime_unlinked_names,
-- medido 18/10/2026). Esta migração corrige a RAIZ e repõe um estado explícito.
--
-- ÂMBITO DELIBERADAMENTE ESTREITO: mexe SÓ no papel `anon`.
--   • NÃO toca em `authenticated` nem `service_role` — há funções propositadamente
--     revogadas de authenticated (service_role-only, ex. 20260624211229); um GRANT em
--     bloco a authenticated reabri-las-ia. Por isso não se concede nada a authenticated.
--   • NÃO revoga de PUBLIC — isso foi tratado em 27/06 e um REVOKE FROM PUBLIC poderia
--     remover acesso de que `authenticated` depende por via de PUBLIC.
--   O default do schema concede diretamente a anon ("anon=X of its own"), por isso
--   REVOKE ... FROM anon remove exatamente esse caminho sem efeitos colaterais.
--
-- Idempotente. REVÊ a allowlist de login antes de aplicar.

-- 1) RAIZ: parar o default de conceder EXECUTE a anon a funções FUTURAS.
--    Aplica-se ao role que cria as funções (o das migrações).
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE EXECUTE ON FUNCTIONS FROM anon;

-- 2) ESTADO ATUAL: tirar a anon o EXECUTE que já tem (anon apenas; authenticated intacto).
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA public FROM anon;

-- 3) Repor anon SÓ na allowlist de login — as funções que o ecrã pré-sessão chama sem
--    sessão. `to_regprocedure` salta as que não existam neste momento (idempotente).
--    Fonte da allowlist: medida na produção a 21/10/2026, chamada a chamada, e não lida
--    das migrações — foi por lê-las que esta lista nasceu errada duas vezes:
--      * `signup_invite_code` não leva argumentos. Escrita `(text)`, `to_regprocedure`
--        devolvia NULL e o GRANT era saltado SEM ERRO, deixando o código QR do ecrã de
--        entrada (Login.tsx → useSignupInviteCode) sem resposta para quem não tem sessão.
--      * `self_signup_role()` faltava por completo. O /signup chama-a anonimamente ao
--        abrir (SignUp.tsx: "Read once, anonymously; it only changes the words").
--    Nada fora disto deve ser anon.
DO $$
DECLARE fn text;
BEGIN
  FOREACH fn IN ARRAY ARRAY[
    'public.get_login_branding()',
    'public.list_tablet_accounts_public()',
    'public.check_invite_code(text)',
    'public.signup_invite_code()',
    'public.self_signup_role()'
  ] LOOP
    IF to_regprocedure(fn) IS NULL THEN
      -- Em vez de saltar em silencio. Era assim que `signup_invite_code(text)` — uma
      -- assinatura que nao existe — passava despercebido: `to_regprocedure` devolvia
      -- NULL, o GRANT nao corria, e o codigo QR do ecra de entrada ficava sem resposta
      -- para quem ainda nao tem sessao. Um nome errado aqui tranca gente de fora, por
      -- isso falha alto.
      RAISE EXCEPTION 'Allowlist aponta para funcao inexistente: %', fn;
    END IF;
    EXECUTE format('GRANT EXECUTE ON FUNCTION %s TO anon', fn);
  END LOOP;
END $$;

-- Nota operacional: se as funções forem criadas por mais do que um role de BD, o default
-- privilege é por-role — confirma com `\ddp`/pg_default_acl e repete o passo 1 com
-- `FOR ROLE <role>` para cada um. O teste de regressão
-- (no_public_function_is_anon_executable_test.sql) deteta qualquer regresso.
