# Sair do Lovable Cloud: o PMSYSTEM num Supabase próprio

Decidido a 08/10/2026 e confirmado a 12/10/2026. Este documento é o plano e a lista de
verificação. Cada fase acaba com uma verificação feita **por fora**, e nada avança sem
ela.

## Porquê

- **Nada aplica as migrações sozinho.** Hoje é preciso colá-las à mão no editor SQL do
  Lovable. A 12/10 a produção estava 12 blocos atrás do `main`, e isso incluía a correção
  de uma leitura anónima de dados de pessoas (o incidente de 11/10).
- **As edge functions só chegam ao ar através do Lovable.** A `employee-signin` está no
  `main` e responde 404.
- **Não há acesso direto à base.** Não há dashboard, nem logs, nem connection string.

Num projeto Supabase próprio, o merge no `main` aplica as migrações e publica as funções
pelo GitHub Actions.

## O que torna isto mais difícil do que parece

1. **As migrações do repositório não reconstroem a produção.** São 540, mas tabelas como
   `attendance_days`, `daily_allocations`, `departments` e `workforce_payroll_periods`
   foram criadas diretamente na base e não aparecem em migração nenhuma. A base nova
   **parte de uma cópia do esquema de produção**, e não de `supabase db reset`.
2. **As contas (`auth.users`).** São 28 logins com as palavras-passe guardadas em hash.
   Se o export não incluir o esquema `auth`, cada pessoa tem de redefinir a palavra-passe.
   É preciso confirmar isto no export antes de decidir.
3. **Duas edge functions só existem no Lovable:** `send-rag-report` e `intouch-discover`.
   Não há código delas em ramo nenhum do git, e `generate-vapid-keys` foi apagada do git
   mas continua no ar. Sem o código, não podem ser recriadas.
4. **16 crons, vários com o URL `ybtrzqzliepknpzqdajx` escrito à mão.** Dois correm a cada
   minuto (iTouching). Na troca, os de um lado têm de ser parados antes de os do outro
   arrancarem, senão a fábrica é sondada duas vezes e os registos duplicam.
5. **Segredos.** Eu não os consigo ler (o classificador bloqueia `vault.secrets`). Copiá-los
   é trabalho do dono da conta.
6. **O site.** O frontend é servido em `anmaisys.lovable.app`. Fica uma decisão por tomar:
   mantê-lo no Lovable, a apontar para o Supabase novo, ou servi-lo noutro sítio (Vercel ou
   Netlify). Ver a fase 5.

## Fases

### Fase 1: projeto novo e export (o utilizador, ~30 min)
- [ ] Criar um projeto em supabase.com: **projeto novo**, região Europa (Londres ou Paris),
      Postgres 17. A produção corre 17.6. **Não** reutilizar `apblxaaktftinstoidvp` nem
      `ammlyqnjlhioukpgldgc`.
- [ ] Guardar num sítio seguro a palavra-passe da base que o Supabase pede na criação.
- [ ] Passar o **project ref** (o identificador de 20 letras no URL) a quem faz a fase 2.
- [ ] No Lovable: Cloud → Advanced settings → **Export data**. Descarregar o ficheiro do
      bucket `database_export_DD_MM_YY` para `~/Downloads`.
- [ ] **Nunca** carregar em "Pause" nem em "Remove Lovable Cloud".

**Verificação:** abrir o ficheiro do export e confirmar que tem o esquema `public`. Ver se
tem também o esquema `auth` (que decide o ponto 2) e os dados.

### Fase 2: esquema e dados no projeto novo (Claude, com o utilizador a aprovar)
- [ ] Ler o export, só leitura: formato, esquemas, contagem de linhas por tabela.
- [ ] Transformar o esquema numa migração de base (`supabase/migrations/<data>_baseline.sql`)
      e marcar as 540 antigas como já aplicadas no histórico da base nova.
- [ ] Carregar os dados no projeto novo. É uma base nova e vazia, por isso pode ser feito
      sem risco para a produção.
- [ ] Recriar os buckets de storage (7 buckets, 42 ficheiros, 43 MB).

**Verificação:** a mesma consulta de contagem por tabela nas duas bases dá os mesmos números
(o inventário de 08/10 tem os totais de referência). Os testes de `supabase/tests/` dão
todos `ALL TESTS PASSED` no projeto novo.

### Fase 3: funções, crons e segredos
- [ ] O utilizador copia para o projeto novo os segredos que o ecrã Secrets do Lovable mostra.
- [ ] Publicar as edge functions pelo `deploy-functions.yml`, com o `project_ref` novo.
- [ ] Decidir o que fazer a `send-rag-report`, `intouch-discover` e `generate-vapid-keys`:
      recuperar o código ou deixá-las cair.
- [ ] Reescrever os crons com o URL novo, **criados desativados**.

**Verificação:** cada função responde no projeto novo (as sondas `OPTIONS` deixam de dar 404).

### Fase 4: migrações automáticas
- [ ] Workflow `apply-migrations.yml`: no merge para o `main` corre `supabase db push` no
      projeto novo. Usa os segredos de repositório `SUPABASE_ACCESS_TOKEN` e
      `SUPABASE_DB_PASSWORD`, que o utilizador põe no GitHub.
- [ ] Deixar de manter `docs/apply-passo-3/`: passa a ser histórico.

**Verificação:** um PR de teste com uma migração inofensiva chega à base nova sozinho.

### Fase 5: a troca (numa hora calma, com o utilizador presente)
- [ ] Decidir onde o site fica a ser servido (ver o ponto 6).
- [ ] Parar os crons antigos, depois ligar os novos.
- [ ] Trocar `VITE_SUPABASE_URL` / `VITE_SUPABASE_PUBLISHABLE_KEY` e o `project_id` do
      `supabase/config.toml`.
- [ ] Repetir a cópia dos dados que mudaram desde a fase 2. Ou então congelar as escritas
      durante a troca.
- [ ] Cada pessoa entra uma vez. Se o export não trouxe o `auth`, redefinem a palavra-passe.

**Verificação:** iniciar sessão como admin, como manager e como employee. O iTouching
regista a cada minuto só na base nova. O Lovable Cloud fica parado mas **não é apagado**
durante 30 dias.

## Até lá

A produção continua no Lovable Cloud. O que for urgente cola-se no editor SQL do Lovable,
como hoje. A 12/10 isso são as 5 partes em `~/Desktop/colar-por-partes/`, que fecham o
incidente de 11/10 e desbloqueiam a ligação das contas.
