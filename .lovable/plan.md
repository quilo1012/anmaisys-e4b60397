# Ligar a API do RAG do SharePoint ao sistema

A API externa lê os ficheiros mensais "Production RAG Performance" no SharePoint e devolve os dados já normalizados (por semana, por dia, por linha, com Plan/Actual/Downtime/UPM e estado RAG). Em vez de alguém exportar o Excel e carregá-lo à mão, o ecrã RAG Weekly passa a poder puxar a semana diretamente do SharePoint.

Confirmado em teste: a API responde e já tem 42 semanas e 10 ficheiros disponíveis, incluindo Agosto e Setembro de 2026.

## O que vai passar a existir

**1. Endereço e chave guardados no sistema (editáveis)**
- O endereço do túnel muda com frequência, por isso fica gravado como definição, alterável por um administrador no ecrã de Definições — sem mexer no código.
- A chave da API fica guardada em segredo no servidor, nunca no navegador.

**2. Botão "Sync from SharePoint" no ecrã RAG Weekly**
- Ao lado do "Import Excel" atual.
- Puxa a semana que está aberta no ecrã e mostra a mesma pré-visualização já existente antes de gravar: quantas linhas, que datas, que linhas de produção foram ignoradas por não existirem na tabela de linhas.
- Só grava depois de confirmação.

**3. Regras de gravação (iguais às do importador de Excel)**
- Valor em branco na origem nunca apaga um valor já existente na base de dados.
- Downtime chega como "02:45:00" e é convertido para minutos.
- UPM target/actual só é aplicado a turnos que tenham Plan ou Actual.
- Variance é sempre calculado, nunca importado.
- Nomes de linha comparados ignorando maiúsculas, acentos e pontuação.

**4. Aviso de estado**
- Se o endereço estiver fora do ar (acontece quando o túnel reinicia), aparece uma mensagem clara a dizer que a ligação ao SharePoint não está disponível e que o endereço precisa de ser atualizado nas Definições — sem ecrã em branco nem erro técnico.

## Detalhes técnicos

- Nova função de servidor `rag-sharepoint-sync`:
  - valida o utilizador (admin/manager/planner via `has_action`), lê o endereço base de `system_settings` e a chave de um segredo `RAG_API_KEY`;
  - chama `GET /weekly-summary?week=YYYY-MM-DD` (ou `/performance?date=`) com header `x-api-key`;
  - devolve os registos normalizados ao cliente para pré-visualização (modo `preview`) ou faz o upsert-merge em `rag_weekly_entries` (modo `commit`).
- Novo módulo `src/lib/ragApiMapping.ts`: converte o JSON da API (`metrics.plan/actual/downtime/upm_*` por `day`/`night`/`total`) nas linhas `rag_weekly_entries` (`entry_date`, `line`, `shift`, `plan_qty`, `actual_qty`, `downtime_min`, `upm_target`, `upm_actual`, `notes`). Reutiliza a normalização de nomes de linha e a lógica de merge já usadas em `src/lib/ragTemplateImport.ts`.
- Testes unitários para o mapeamento: conversão de downtime "HH:MM:SS" → minutos, spread de UPM só nos turnos com dados, células nulas que não sobrepõem valores existentes, linha desconhecida ignorada.
- `RAGWeeklyPage.tsx`: novo botão e reutilização do diálogo de pré-visualização existente.
- Definição do endereço base gravada em `system_settings` com uma entrada nas Definições (só admin).
- Sem publicação — fica em pré-visualização para revisão.
