

# Manager: Edit Password, Email & Delete Users

## Resumo

Adicionar ao sistema de gestao de usuarios a capacidade do Manager:
1. **Alterar senha** de qualquer usuario
2. **Alterar email** de qualquer usuario
3. **Deletar** usuarios

Todas as operacoes sao feitas via edge functions com validacao server-side (somente admins).

---

## 1. Edge Function: `update-user` (modificar)

Adicionar suporte para `email` e `password` no body da requisicao. Usar `supabaseAdmin.auth.admin.updateUserById()` para alterar credenciais.

**Arquivo:** `supabase/functions/update-user/index.ts`

Novos campos aceitos no body:
- `email` (string, opcional) — atualiza email via admin API + atualiza campo email na tabela profiles
- `password` (string, opcional) — atualiza senha via admin API

```text
if (email) {
  await supabaseAdmin.auth.admin.updateUserById(userId, { email });
  await supabaseAdmin.from("profiles").update({ email }).eq("id", userId);
}
if (password) {
  await supabaseAdmin.auth.admin.updateUserById(userId, { password });
}
```

---

## 2. Edge Function: `delete-user` (nova)

Nova edge function que deleta um usuario completamente (auth + profile + role).

**Arquivo:** `supabase/functions/delete-user/index.ts`

- Verifica se o caller e admin (mesmo padrao das outras functions)
- Impede que o admin delete a si mesmo
- Usa `supabaseAdmin.auth.admin.deleteUser(userId)` — o CASCADE no FK da profiles limpa automaticamente

---

## 3. Frontend: `ManageUsers.tsx`

### Edit Dialog — novos campos:
- Campo **Email** (Input type email, pre-preenchido com email atual)
- Campo **New Password** (Input type password, vazio por padrao, placeholder "Leave blank to keep current")

### Delete — novo botao:
- Botao de delete (icone Trash) na coluna Actions ao lado do botao Edit
- Confirmacao via AlertDialog antes de deletar
- Chama a edge function `delete-user`
- Impede deletar o proprio usuario logado

---

## 4. Arquivos Modificados

| Arquivo | Alteracao |
|---------|-----------|
| `supabase/functions/update-user/index.ts` | Suporte a email e password via admin API |
| `supabase/functions/delete-user/index.ts` | Nova function para deletar usuario |
| `supabase/config.toml` | Adicionar entry `[functions.delete-user]` com `verify_jwt = false` |
| `src/pages/users/ManageUsers.tsx` | Campos email/password no edit + botao delete com confirmacao |

---

## 5. Seguranca

- Todas as operacoes passam pela validacao `has_role(caller.id, 'admin')` no servidor
- Admin nao pode deletar a si mesmo (verificacao no edge function)
- Senha e opcional no edit (so atualiza se preenchida)
- Email atualizado tanto no auth quanto na tabela profiles

