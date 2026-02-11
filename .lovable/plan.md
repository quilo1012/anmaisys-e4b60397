

# Alerta Sonoro Contínuo Até o Engenheiro Aceitar a Ordem

## O que muda

Atualmente o som toca apenas 3 bipes curtos (menos de 2 segundos no total). O novo comportamento sera:

- O som toca em loop contínuo (bipes repetidos a cada ~1 segundo)
- Continua tocando por até **60 segundos**
- Para imediatamente quando o engenheiro clica em **"Start"** (aceita a ordem)
- Para também se outro engenheiro já aceitou a ordem (status muda para `in_progress`)

## Como funciona

```text
Nova WO criada --> Som começa em loop --> Para quando:
                                           1. Engenheiro clica "Start"
                                           2. 60 segundos se passaram
                                           3. Outro engenheiro aceitou
```

## Detalhes Técnicos

### Arquivo: `src/lib/shifts.ts`

- Adicionar variável `alertIntervalId` para controlar o loop
- Modificar `playAlertSound()` para tocar bipes em loop contínuo (a cada 1s) por até 60 segundos
- Adicionar nova função `stopAlertSound()` que para o loop e limpa o intervalo
- A função retorna ou expoe o controle para parar externamente

### Arquivo: `src/hooks/useWOAlerts.ts`

- Importar `stopAlertSound` junto com `playAlertSound`
- Guardar referência das WOs pendentes com som ativo
- Adicionar listener para evento UPDATE na tabela `work_orders` -- quando o status muda de `open` para `in_progress`, chamar `stopAlertSound()`
- Isso garante que quando qualquer engenheiro aceitar a ordem, o som para para todos

### Arquivo: `src/pages/dashboard/EngineerDashboard.tsx`

- No handler do botão "Start", chamar `stopAlertSound()` antes de executar `startWO.mutate()`
- Isso para o som imediatamente ao clicar, sem esperar a resposta do banco

### Resumo das alterações

| Arquivo | Alteração |
|---------|-----------|
| `src/lib/shifts.ts` | Loop contínuo de bipes + função `stopAlertSound()` |
| `src/hooks/useWOAlerts.ts` | Escutar UPDATE para parar som quando WO for aceita |
| `src/pages/dashboard/EngineerDashboard.tsx` | Chamar `stopAlertSound()` ao clicar "Start" |

