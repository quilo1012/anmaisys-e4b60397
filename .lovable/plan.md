

## Plano — Editor Profissional de Dispositivos

Atualizar o diálogo de edição de tablets em **Devices** para uma experiência mais profissional, com campos dedicados, organizados em seções claras e ações contextuais. Hoje o editor existe mas tem layout simples — vamos transformá-lo em um painel de gestão completo.

### O que muda visualmente

Quando o admin clicar em **Edit** numa linha da tabela de dispositivos, ele verá um diálogo maior e estruturado em **três seções** com cabeçalhos discretos:

```
┌──────────────────────────────────────────────────┐
│ ✏️  Edit Tablet Device                            │
│ Manage label, allowed lines and pairing status   │
├──────────────────────────────────────────────────┤
│ ▸ IDENTIFICATION                                  │
│   Device Label    [ Floor tablet 3            ]  │
│   Device Token    [ aB3xK9... ] [📋 Copy]         │
│   Last seen       Apr 23, 2026 14:22              │
│   Paired at       Apr 20, 2026 09:10              │
│                                                   │
│ ▸ AUTHORIZED LINES  (2 selected)   [Select all]  │
│   ☑ Line 1        ☐ Line 2                        │
│   ☑ Blender 1     ☐ Blender 2                     │
│   ☐ Sealer Mobile ☐ Printer Mobile                │
│                                                   │
│ ▸ DANGER ZONE                                     │
│   [🗑 Unpair this device]                          │
│   Removes all line authorizations. The tablet    │
│   will be blocked until paired again.            │
├──────────────────────────────────────────────────┤
│                       [Cancel]  [💾 Save changes]│
└──────────────────────────────────────────────────┘
```

### Detalhes funcionais

**Section 1 — Identification**
- Campo **Device Label** dedicado, com ícone e placeholder claro.
- Campo **Device Token** somente-leitura, fonte mono, com botão copiar inline (igual ao "This Device").
- **Last seen** e **Paired at** formatados (`PP p`) ao lado, em texto pequeno — read-only metadata.

**Section 2 — Authorized Lines**
- Mantém a grade de checkboxes existente, mas:
  - Adiciona contador "(N selected)" no cabeçalho.
  - Adiciona botão **Select all / Clear all** que alterna conforme o estado.
  - Aviso amarelo embaixo se nenhuma linha estiver selecionada: *"Saving with zero lines will block this tablet."*

**Section 3 — Danger Zone**
- Bloco vermelho/destructive separado, com botão **Unpair this device** (chama `useUnpairDevice` direto, fecha o diálogo no sucesso).
- Texto explicativo curto.
- Apenas aparece se o dispositivo já tem pelo menos uma linha (mesma regra atual da tabela).

**Footer**
- Botão **Cancel** (outline) e **Save changes** (primary com ícone Save).
- Save desabilitado enquanto `pair.isPending`.
- Toast de sucesso/erro mantém o padrão atual.

### Polimento adicional na página

- **Card "All Devices"**: aumentar padding nas células, alternância de cor de linha sutil (`hover:bg-muted/30`), badges com ícone de linha à esquerda.
- **Botão Edit** na linha da tabela: trocar para `variant="ghost"` com ícone só (ícone Pencil) e tooltip "Edit device" — mais limpo.
- **Botão Unpair** removido da tabela (passa a viver dentro do diálogo, na Danger Zone) — evita cliques acidentais e centraliza a gestão.
- Largura do diálogo: `max-w-2xl` para acomodar as seções confortavelmente.

### Arquivos modificados

- `src/pages/dashboard/DevicesPage.tsx` — refatorar diálogo de edição em três seções, reorganizar ações da tabela, adicionar `Select all/Clear all` e Danger Zone.

Nenhuma mudança de schema, RLS, hooks ou contexto — toda a infraestrutura já está pronta (`usePairDeviceLines`, `useUnpairDevice`, `useAllDevices`).

### Fora de escopo

- Edição em massa de múltiplos dispositivos.
- Histórico de pareamentos por dispositivo.
- Renomear/regenerar token (token é gerado pelo próprio tablet via `localStorage`).

