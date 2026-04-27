## Problema

O sistema **já tem** sirene de alerta crítica para engenheiros (`CriticalAlertContext` + `useWOAlerts`): toca `/alert.mp3` em loop + oscilador WebAudio + vibração + modal vermelho fullscreen quando uma WO chega.

Porém, navegadores bloqueiam `audio.play()` sem gesto explícito do usuário. Hoje o sistema mostra um modal "Enable Alert Sounds" no primeiro login, mas:

- Se o engenheiro fecha o modal sem clicar em "Enable", o áudio fica mudo silenciosamente.
- Não há indicador visual claro de que o som está desativado.
- Não há atalho para reativar o som depois.

Resultado: muitos engenheiros não ouvem o alerta sonoro quando uma WO chega.

## Solução

Tornar o destrave de áudio **persistente, visível e fácil de reativar**.

### 1. Indicador de áudio no header (sino + status)

Em `DashboardLayout.tsx`, ao lado do `NotificationPanel`, adicionar um botão visível **apenas para engineers/admins**:

- Ícone `Volume2` (verde) quando `audioEnabled === true`.
- Ícone `VolumeX` (vermelho pulsante) quando `audioEnabled === false`, com tooltip "Click to enable critical alert sounds".
- Clique chama `promptEnableAudio()` → reabre o modal de destrave.

### 2. Modal de destrave mais resiliente

Em `CriticalAlertContext.tsx`:

- Impedir fechamento do modal "Enable Alert Sounds" via ESC ou clique fora **na primeira exibição** após login (já é parcialmente bloqueado, mas o ESC fecha). Substituir por aviso "Alerts disabled — click Enable to receive critical Work Order sounds".
- Após `enableAudio()`, tocar um beep curto de confirmação (200ms) para o engenheiro ter feedback de que o som está funcionando.

### 3. Reabrir prompt sempre que uma WO crítica chega sem áudio destravado

Em `useWOAlerts.ts`, quando o evento INSERT chega e `audioEnabled === false`, **antes** de `triggerAlert`, chamar `promptEnableAudio()` — assim mesmo se o engenheiro fechou o prompt antes, ele reaparece junto com a WO crítica (modal vermelho permanece visível por trás).

### 4. Teste manual de áudio na página do engineer

Em `EngineerDashboard.tsx`, próximo ao filtro de linhas (`EngineerAlertLineFilter`), adicionar um pequeno botão "🔊 Test Alert Sound" que dispara `engine.start()` por 2 segundos para o engenheiro confirmar que o áudio está funcionando.

## Arquivos alterados

- `src/contexts/CriticalAlertContext.tsx` — beep de confirmação após enable; expor método `testSound()` no contexto.
- `src/components/DashboardLayout.tsx` — botão `AudioStatusButton` ao lado do `NotificationPanel`.
- `src/components/AudioStatusButton.tsx` (novo) — ícone Volume2/VolumeX com clique para reabrir prompt.
- `src/hooks/useWOAlerts.ts` — chamar `promptEnableAudio()` no INSERT se ainda não destravado.
- `src/pages/dashboard/EngineerDashboard.tsx` — botão "Test Alert Sound".

## Resultado

- Engenheiro vê **imediatamente** se o som está mudo (ícone vermelho pulsante no header).
- Pode reativar com 1 clique a qualquer momento.
- Pode testar o som sem esperar uma WO real.
- Quando uma WO chega com áudio mudo, o prompt reaparece automaticamente.
