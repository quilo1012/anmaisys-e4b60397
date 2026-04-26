## Problema identificado

Operador (Production Tablet, `580bfc5c…`) tentou clicar em **REPORT RECURRING FAILURE** na **WO-2026-000091**, mas a função retornou `forbidden`.

### Causa raiz
A WO-91 foi criada pelo operador **LINE 1** (`cf0dc699…`). A RPC `reopen_wo_as_recurrence` valida permissão assim:

```sql
IF NOT (
  _user_role IN ('admin','manager')
  OR _orig.operator_id = _user_id   -- exige ser o MESMO operador que abriu
) THEN
  RETURN jsonb_build_object('success', false, 'error', 'forbidden');
END IF;
```

Em chão de fábrica, **vários tablets/operadores compartilham a mesma linha**. Hoje, se o operador que abriu a WO já saiu do turno, **nenhum outro operador da mesma linha** consegue reabrir a recorrência — só admin/manager. Isso quebra o fluxo de turnos.

A WO-91 e o operador atual têm acesso à mesma linha (`Line 1` → `57756a3e…`), então a permissão deve passar.

## Correção (1 migração SQL)

Atualizar `public.reopen_wo_as_recurrence` para autorizar também:

- **operadores que pertencem à mesma linha da WO** (via `operator_line_accounts.line_ids @> ARRAY[wo.line_id]`), além do operador original.

Pseudo-lógica do novo guard:

```sql
_is_same_line_operator boolean := EXISTS (
  SELECT 1 FROM public.operator_line_accounts ola
  WHERE ola.user_id = _user_id
    AND _orig.line_id IS NOT NULL
    AND _orig.line_id = ANY(ola.line_ids)
);

IF NOT (
  _user_role IN ('admin','manager')
  OR _orig.operator_id = _user_id
  OR (has_role(_user_id,'operator'::app_role) AND _is_same_line_operator)
) THEN
  RETURN jsonb_build_object('success', false, 'error', 'forbidden');
END IF;
```

Tudo o mais (criação de novo episódio, reabertura da mesma WO, downtime event, log) permanece igual.

## Impacto
- Operadores na **mesma linha** da WO podem reabrir recorrência (caso comum entre turnos).
- Operadores de **outras linhas** continuam bloqueados.
- Engenheiros continuam não podendo reabrir como operador (apenas admin/manager).
- Sem mudança de UI; o card **REPORT RECURRING FAILURE** já está exibido para o operador.

## Validação após deploy
1. Logar como `Production Tablet`, abrir WO-2026-000091, clicar em **REPORT RECURRING FAILURE** → deve criar novo episódio (#2), reabrir a WO com status `open`, e abrir um `downtime_events`.
2. Logar como operador de outra linha → botão segue oculto / RPC nega.
