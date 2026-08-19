#!/usr/bin/env bash
# Sonda de esquema contra o backend da própria app. Só leitura.
#
# Responde ao Bloco 1 do VERIFY-frozen-points.sql sem precisar de conector MCP,
# de sessão autenticada, ou de alguém colar output: o PostgREST responde de
# forma diferente a uma tabela que existe e a uma que não existe, e isso chega
# para saber se a migração aterrou.
#
# Lê VITE_SUPABASE_URL e VITE_SUPABASE_PUBLISHABLE_KEY do .env. A chave nunca é
# impressa. Nada aqui escreve na base.
#
# O que NÃO consegue, e é preciso saber antes de confiar nisto: os Blocos 2 a 5
# precisam de sessão autenticada. A RLS de quality_actions não abre ao anónimo,
# por isso uma tabela que existe devolve 200 com [] — presença do esquema, nunca
# contagem de linhas. Um "200 []" aqui NÃO prova que o backfill correu.
#
#   uso:  bash docs/apply/probe-schema.sh
set -euo pipefail
cd "$(dirname "$0")/../.."
[ -f .env ] || { echo "Sem .env — correr a partir da raiz do repositório."; exit 1; }
set -a; . ./.env; set +a
URL="${VITE_SUPABASE_URL%\"}"; URL="${URL#\"}"
KEY="${VITE_SUPABASE_PUBLISHABLE_KEY%\"}"; KEY="${KEY#\"}"
[ -n "${URL:-}" ] && [ -n "${KEY:-}" ] || { echo "VITE_SUPABASE_URL / _PUBLISHABLE_KEY em falta no .env"; exit 1; }
echo "backend: $URL"

ask() { # $1 = caminho REST
  local body code msg
  body=$(curl -s -m 20 -w "\n%{http_code}" \
    -H "apikey: $KEY" -H "Authorization: Bearer $KEY" "$URL/rest/v1/$1")
  code=$(printf '%s' "$body" | tail -1)
  msg=$(printf '%s' "$body" | sed '$d' | head -c 100)
  printf '  %-34s %s  %s\n' "${1%%\?*}${2:+ · $2}" "$code" "$msg"
}
tabela() { ask "$1?select=*&limit=0"; }
coluna() { ask "quality_actions?select=$1&limit=0" "$1"; }

echo
echo "CONTROLOS  (200 = existe · 404 PGRST205 = não existe)"
tabela quality_actions
tabela zzz_tabela_que_nao_existe

echo
echo "TABELAS DA MIGRAÇÃO 20260822090000"
for t in scoring_version scoring_version_severity scoring_version_label scoring_version_excluded_label; do
  tabela "$t"
done

echo
echo "COLUNAS EM quality_actions  (200 = existe · 400 42703 = não existe)"
for c in points_at_creation scoring_version_id points_recalculated_at; do
  coluna "$c"
done

echo
echo "COLUNA is_gate EM quality_options  (20260824090000)"
ask "quality_options?select=is_gate&limit=0" "is_gate"

echo
echo "Antes de aplicar: tudo 404/400 acima, e os controlos a bater."
echo "Depois de aplicar: tudo 200. Se ficar a meio, parar e olhar."
echo
echo "Nao consegue ver: CAP_LabelPoints (20260823090000) nem se as quatro etiquetas"
echo "ficaram marcadas. leader_scorecard_threshold e quality_options fecham a RLS ao"
echo "anonimo, por isso respondem 200 [] existam ou nao as linhas. Isso vem do"
echo "VERIFY-scoring-rules.sql, corrido no SQL editor."
