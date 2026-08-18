# Aplicar: guarda de ações em work_orders

Colar no chat do Lovable do projeto PMSYSTEM.

---

Aplica a migração `supabase/migrations/20260821090000_action_guard_work_orders.sql`
que já está no repositório. Ela cria duas funções (`public.action_revoked`,
`public.enforce_action`) e cinco triggers BEFORE em `public.work_orders`.

Não alteres nenhuma política RLS existente. Não alteres nenhum ficheiro de frontend.
Não mudes o conteúdo da migração — aplica-a tal como está.

Antes de aplicar, corre e mostra-me o resultado de:

    SELECT role, action, allowed FROM role_permission_overrides WHERE allowed = false;

Estas são as linhas que a base de dados passa a cumprir a sério assim que a migração
for aplicada — hoje só escondem um botão no ecrã. Quero ver a lista antes de aplicar.

Depois de aplicar, mostra-me o resultado de:

    SELECT tgname FROM pg_trigger
    WHERE tgrelid = 'public.work_orders'::regclass AND NOT tgisinternal;

Esperado: wo_guard_insert, wo_guard_update, wo_guard_delete, wo_guard_close, wo_guard_force.
