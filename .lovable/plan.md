# Bloquear acesso a utilizadores desativados

## Problema confirmado

A conta `productionappliednutrition@gmail.com` está com `profiles.active = false` na base de dados, mas o utilizador continua a conseguir entrar e usar o sistema normalmente.

**Causa raiz:** o flag `active` é guardado no perfil e mostrado na UI ("Active / Inactive"), mas **nunca é verificado em lado nenhum** do fluxo de autenticação:
- `src/contexts/AuthContext.tsx` carrega o campo `active` mas não faz nada com ele.
- `src/components/ProtectedRoute.tsx` só verifica `session` e `role`.
- O Edge Function `update-user` apenas atualiza `profiles.active`, não revoga sessões existentes.

Resultado: um utilizador desativado mantém a sessão (e tokens em localStorage com auto-refresh), e mesmo um login novo passaria, porque o Supabase Auth não sabe nada do nosso flag `active`.

## Solução

Tratar `profiles.active = false` como "sem acesso" em **três sítios complementares**, sem mexer em mais nenhuma lógica:

### 1. AuthContext — sign out automático quando `active = false`
Em `src/contexts/AuthContext.tsx`, na função `fetchUserData` (e numa nova subscription realtime ao próprio profile):
- Se `profile.active === false`, executar:
  - `supabase.auth.signOut()`
  - Limpar estado local (session/user/role/profile)
  - `toast` a informar: *"Your account has been deactivated. Contact your supervisor."*
  - Redirecionar para `/login` (via `window.location.replace("/login")`).
- Adicionar uma subscrição realtime à row `profiles` do utilizador atual, para que **se o admin desativar a conta enquanto o user está ligado, ele seja deslogado em segundos** sem precisar de fechar o tablet.

### 2. ProtectedRoute — guarda extra
Em `src/components/ProtectedRoute.tsx`, adicionar verificação:
- Se `profile && profile.active === false` → mostrar ecrã "Account deactivated. Contact your supervisor." com botão de logout (não usa o dashboard de fallback). Isto cobre o pequeno gap entre o login e o sign-out automático disparar.

### 3. Edge Function `update-user` — revogar sessão ao desativar
Em `supabase/functions/update-user/index.ts`, quando `active === false` for recebido:
- Após o `update` ao profile, chamar `supabaseAdmin.auth.admin.signOut(userId, "global")` para invalidar **todos** os refresh tokens do utilizador no servidor.
- Assim, mesmo que o tablet esteja offline no momento, no próximo refresh de token o Supabase rejeita e o utilizador cai fora.

## Comportamento final

| Cenário | Resultado |
|---|---|
| Admin desativa conta com user online | Realtime dispara sign-out automático em ~segundos. Toast a explicar. |
| Admin desativa conta com tablet offline | No próximo network call, refresh falha (sessão revogada server-side) → cai no login. |
| User desativado tenta novo login | Login passa em Supabase Auth, mas `AuthContext` ao carregar o profile vê `active=false` e faz sign-out imediato. |
| User ativo | Sem alteração nenhuma. |

## Notas técnicas

- Não tocar em `src/integrations/supabase/client.ts` (auto-gerado).
- O sign-out automático **não** afeta admin/manager/engineer/operator de forma diferente — qualquer role com `active=false` é bloqueado igualmente.
- Toast traduzido em inglês para manter consistência com a UI atual.
- A subscrição realtime usa `postgres_changes` filtrado por `id=eq.<userId>` (RLS já permite ler o próprio profile).
- Não é necessária migration SQL. Tudo é código de aplicação + edge function.

## Ficheiros alterados

- `src/contexts/AuthContext.tsx` — verificação de `active` + realtime subscription + sign-out automático.
- `src/components/ProtectedRoute.tsx` — ecrã "Account deactivated" como guarda extra.
- `supabase/functions/update-user/index.ts` — revogar sessão server-side quando `active=false`.
