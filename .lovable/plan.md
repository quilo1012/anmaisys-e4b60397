## Tablet do Operador (Line Production Screen)

**Travar a linha ao login**
- Quando o usuário tem registro em `operator_line_accounts` (ex.: line4@…), esconder o seletor de Linha e o seletor de Tablet do header.
- Forçar `line` = primeira/única linha permitida (auto-select já existe). Hoje o operador ainda vê o dropdown e consegue trocar — vou remover o dropdown e bloquear no useEffect (ignora qualquer valor fora da lista permitida).
- Travar o seletor de Turno: operadores ficam fixos no `currentShift()` calculado pelo horário de Londres; toggle DAY/NIGHT some para o operador (admin/manager continuam podendo trocar).
- Travar Tablet ID ao label da conta (`operator_line_accounts.label`, ex.: "Tablet 4") — sem dropdown para o operador.

**Visual do tablet (cleanup)**
- Header em uma linha só: `Linha • Shift • Data • Relógio • Status`. Remover botões “Sync SKUs” e “Kiosk” do header e mover Kiosk para canto inferior direito (FAB) — operador não precisa ver Sync.
- Cards maiores, tipografia maior nas KPIs, menos badges secundários.

**Botão “Request Order” no tablet**
- Adicionar botão grande **“🚨 Open Maintenance Order”** logo abaixo do KPI.
- Abre dialog em tela cheia com campos: Machine (dropdown filtrado pela linha), Problem (categoria + descrição), Priority. Submit cria `work_orders` com `requester_name = operator label`, `line_id` e `line_at_time` da conta, status `open`.

## Engenheiro

**Visual no topo**
- Remover blocos pesados do topo (KPIs grandes, predictive alerts grandes, online engineers chips). Deixar apenas: título “Engineer Console” + 3 KPI cards compactos (Active, Completed today, MTTR). Sidebar continua com a navegação completa.

**Listas visíveis**
- Seção **Active Work** já lista `open / received / arrived / in_progress`. Vou garantir 3 grupos claros com cabeçalhos:
  1. 🆕 Open (não aceitas)
  2. 🔧 In Progress (aceitas/arrived/started)
  3. ✅ Recently Finished (history — finished/closed/completed, últimas 50)
- Cada item mostra: WO# · Linha · Máquina · Problema · Status · Requester · Engineer · Tempo.
- Hoje só a lista “History” existe via scroll; vou trazê-la pra cima e mostrar pra qualquer engenheiro (já está sem filtro por engineer_id desde o último ajuste).

## Arquivos

- `src/pages/dashboard/LineProductionScreen.tsx` — esconder seletores, fixar shift/line/tablet por conta, novo botão Request Order.
- `src/components/operator/RequestOrderDialog.tsx` (novo) — formulário de abertura de WO no tablet.
- `src/pages/dashboard/EngineerDashboard.tsx` — limpar topo, reorganizar seções Open / In Progress / Finished.

## Pontos a confirmar

1. Para o operador, o **Tablet ID** deve vir do campo `label` em `operator_line_accounts` (ex.: "Tablet 4")? Hoje o tablet id é manual no dropdown.
2. No "Request Order" do tablet, posso reaproveitar a lista de categorias padrão (`problem_descriptions`) ou prefere campos livres simples (Machine + Description)?
3. Engineer top: posso remover totalmente `EngineerNavCards`, `usePredictiveAlerts` e `useOnlineEngineers` do topo (manter só na sidebar/seções internas)?
