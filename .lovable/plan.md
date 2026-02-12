

# Redesign Completo AN Maintenance

## Resumo das Alteracoes

Este plano cobre as melhorias visuais, mudanca do campo "Production Line" para nome do solicitante, assinatura digital por texto, e consistencia de icones. QR Code e stamp de impressao ficam para a proxima etapa.

---

## 1. Banco de Dados - Renomear campo "line" para "requester_name"

Criar migration para renomear a coluna `line` na tabela `work_orders` para `requester_name`:

```sql
ALTER TABLE work_orders RENAME COLUMN line TO requester_name;
```

Adicionar coluna `signed_by_name` para a assinatura digital do engenheiro:

```sql
ALTER TABLE work_orders ADD COLUMN signed_by_name text;
```

---

## 2. Atualizar codigo que usa o campo `line`

Todos os arquivos que referenciam `wo.line` ou o campo `line` em work_orders precisam mudar para `requester_name`:

| Arquivo | Alteracao |
|---------|-----------|
| `src/hooks/useWorkOrders.ts` | Mudar `line` para `requester_name` no tipo `WorkOrder`, em `useCreateWorkOrder`, `useUpdateWorkOrder` |
| `src/pages/dashboard/OperatorDashboard.tsx` | Label "Production Line" vira "Requested By" (nome da pessoa). Campo `line` vira `requester_name` |
| `src/pages/dashboard/ManagerDashboard.tsx` | Mesma mudanca: labels e campos `line` viram `requester_name` |
| `src/pages/dashboard/EngineerDashboard.tsx` | Coluna "Line" vira "Requester" na tabela |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Exibir "Requested By" ao inves de "Line" no titulo e detalhes |
| `src/lib/exportCsv.ts` | Atualizar header do CSV |

---

## 3. Assinatura Digital (texto) ao Completar WO

No `EngineerDashboard.tsx`, ao clicar "Complete":
- Abrir um Dialog pedindo o nome completo do engenheiro como confirmacao
- O engenheiro digita seu nome e clica "Confirm & Complete"
- O nome digitado e salvo no campo `signed_by_name` da WO

No `WorkOrderDetail.tsx`:
- Exibir campo "Signed By" com o nome digitado, visivel na tela e na impressao

Atualizar `useCompleteWorkOrder` para aceitar `signedByName` como parametro:

```text
update({ status: "completed", completed_at: now, signed_by_name: signedByName })
```

---

## 4. Consistencia de Icones

Substituir icones genericos por icones Lucide mais adequados ao contexto industrial em todos os dashboards:

| Contexto | Icone Atual | Novo Icone |
|----------|------------|------------|
| Dashboard (sidebar) | `LayoutDashboard` | `LayoutDashboard` (manter) |
| Work Orders (card header) | `Wrench` | `ClipboardList` |
| Stock (sidebar) | `Package` | `Package` (manter) |
| Users (sidebar) | `Users` | `Users` (manter) |
| Start button | `Play` | `Play` (manter) |
| Complete button | `CheckCircle` | `CheckCircle` (manter) |
| Print | `Printer` | `Printer` (manter) |
| Alert WO | `AlertTriangle` | `AlertTriangle` (manter) |
| Sign/Complete | N/A | `PenTool` (novo, para assinatura) |

Os icones atuais ja sao consistentes com Lucide. A principal melhoria e trocar o `Wrench` por `ClipboardList` no header de Work Orders do EngineerDashboard.

---

## 5. Melhorias Visuais nos Dashboards

- Manter o estilo atual dos cards e tabelas (ja esta profissional)
- Garantir que badges de status usam cores consistentes em todos os dashboards
- Login ja foi redesenhado com gradiente industrial e logo

---

## 6. Arquivos Modificados (resumo)

| Arquivo | Alteracao |
|---------|-----------|
| **Migration SQL** | Renomear `line` para `requester_name`, adicionar `signed_by_name` |
| `src/hooks/useWorkOrders.ts` | Tipo WorkOrder + mutations atualizados |
| `src/pages/dashboard/OperatorDashboard.tsx` | Label e campo `requester_name` |
| `src/pages/dashboard/ManagerDashboard.tsx` | Label e campo `requester_name`, create/edit WO |
| `src/pages/dashboard/EngineerDashboard.tsx` | Coluna "Requester", dialog de assinatura ao completar |
| `src/pages/dashboard/WorkOrderDetail.tsx` | Exibir "Requested By" e "Signed By" |
| `src/lib/exportCsv.ts` | Header CSV atualizado |
| `src/hooks/useWOAlerts.ts` | Mudar `wo.line` para `wo.requester_name` na notificacao |

---

## Nota

- **Stamp de impressao**: sera adicionado quando voce enviar a imagem separada
- **QR Code**: sera implementado em uma proxima etapa conforme combinado

