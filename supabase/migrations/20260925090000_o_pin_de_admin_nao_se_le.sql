-- O hash do PIN de admin é legível por qualquer conta autenticada.
--
-- Em Abril isto esteve fechado. `20260421105946` trocou o SELECT de tabela por um
-- SELECT de colunas em `system_settings` e deixou `admin_pin` de fora; `20260423202741`
-- repetiu-o. Depois `20260627071614` acrescentou duas colunas e, para as conceder,
-- escreveu `GRANT SELECT, INSERT, UPDATE, DELETE ON public.system_settings TO
-- authenticated` — um grant de tabela, que cobre TODAS as colunas e apagou os dois
-- anteriores. `20260729180000` deu por isso no UPDATE e reparou-o coluna a coluna.
-- Ninguém voltou ao SELECT, e desde 27/06 que ele está aberto.
--
-- O que fica exposto é o bcrypt de um PIN de quatro dígitos. São 10 000 hipóteses:
-- quem tenha a linha parte-o na sua própria máquina em segundos, sem tocar outra vez
-- na aplicação e sem deixar rasto nenhum aqui. O que segura a porta hoje é só a RLS,
-- e o papel de admin está em 10 das 29 contas.
--
-- A MESMA ARMADILHA OUTRA VEZ: um grant de tabela cobre todas as colunas, por isso
-- revogar `admin_pin` sozinho não faz nada. É preciso deitar abaixo o grant de tabela
-- e voltar a conceder coluna a coluna. QUANDO SE ACRESCENTAR UMA COLUNA A
-- system_settings, ACRESCENTA-SE AQUI TAMBÉM — nas duas listas.
--
-- O `admin_pin` sai também do UPDATE. Ninguém no frontend o escreve: quem o muda é a
-- edge function `update-admin-pin`, que chama `set_admin_pin()` — SECURITY DEFINER, e
-- é lá que o valor passa por `crypt()`. Um PATCH directo à coluna gravaria o PIN em
-- claro por cima do hash, e a partir daí `crypt(_pin, admin_pin)` deixava de comparar
-- coisa nenhuma.

-- ── SELECT ───────────────────────────────────────────────────────────────────
REVOKE SELECT ON public.system_settings FROM authenticated, anon;

GRANT SELECT (
  id,
  created_at,
  updated_at,
  intouch_auto_wo_enabled,
  intouch_sync_enabled,
  rag_api_base_url
) ON public.system_settings TO authenticated;

-- ── UPDATE ───────────────────────────────────────────────────────────────────
-- A lista de `20260729180000` mais `rag_api_base_url` de `20260917090000`, menos
-- `admin_pin`. `intouch_sync_enabled` continua de fora: só se mexe por
-- `set_intouch_sync_enabled()`, que exige o PIN de admin e escreve em `audit_logs`.
REVOKE UPDATE ON public.system_settings FROM authenticated, anon;

GRANT UPDATE (
  id,
  created_at,
  updated_at,
  intouch_auto_wo_enabled,
  rag_api_base_url
) ON public.system_settings TO authenticated;

COMMENT ON COLUMN public.system_settings.admin_pin IS
  'Hash bcrypt do PIN de admin. Sem SELECT nem UPDATE para authenticated: lê-se por verify_admin_pin() e escreve-se por set_admin_pin(), ambas SECURITY DEFINER. Um GRANT de tabela em system_settings volta a abri-la.';
