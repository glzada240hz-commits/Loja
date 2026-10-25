#!/usr/bin/env bash
# Restaura um backup em um banco. APAGA o conteúdo atual do banco de destino.
# Uso: DATABASE_URL=postgres://.../banco_destino scripts/restore.sh arquivo.dump --confirmar
# Recomendado: restaure primeiro num banco de teste e confira antes de usar em produção.
set -euo pipefail

FILE="${1:-}"
if [[ -z "$FILE" || ! -f "$FILE" ]]; then
  echo "Uso: DATABASE_URL=... $0 arquivo.dump --confirmar" >&2
  exit 1
fi
if [[ "${2:-}" != "--confirmar" ]]; then
  echo "Esta operação substitui os dados do banco de destino. Repita com --confirmar." >&2
  exit 2
fi
if [[ -z "${DATABASE_URL:-}" && -f "$(dirname "$0")/../.env" ]]; then
  set -a; source "$(dirname "$0")/../.env"; set +a
fi
: "${DATABASE_URL:?Defina DATABASE_URL do banco de destino}"

if [[ -f "$FILE.sha256" ]]; then
  (cd "$(dirname "$FILE")" && sha256sum -c "$(basename "$FILE").sha256")
fi
pg_restore --list "$FILE" > /dev/null
pg_restore --clean --if-exists --no-owner --no-privileges --single-transaction --exit-on-error --dbname="$DATABASE_URL" "$FILE"
echo "Restauração concluída em: ${DATABASE_URL%%\?*}" | sed -E 's#://([^:]+):[^@]+@#://\1:***@#'
