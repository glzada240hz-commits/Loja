#!/usr/bin/env bash
# Backup do banco do Bar do Guto (formato custom do pg_dump, compactado).
# Uso: DATABASE_URL=postgres://... scripts/backup.sh [diretório_destino]
# Retenção: mantém os últimos $BACKUP_KEEP arquivos (padrão 30).
set -euo pipefail

if [[ -z "${DATABASE_URL:-}" && -f "$(dirname "$0")/../.env" ]]; then
  # shellcheck disable=SC1091
  set -a; source "$(dirname "$0")/../.env"; set +a
fi
: "${DATABASE_URL:?Defina DATABASE_URL}"
DEST="${1:-${BACKUP_DIR:-$(dirname "$0")/../backups}}"
KEEP="${BACKUP_KEEP:-30}"
mkdir -p "$DEST"
STAMP="$(TZ=America/Sao_Paulo date +%Y%m%d-%H%M%S)"
FILE="$DEST/guto-$STAMP.dump"
TMP="$FILE.partial"

pg_dump --format=custom --compress=6 --no-owner --no-privileges --file="$TMP" "$DATABASE_URL"
# valida o arquivo antes de considerá-lo um backup
pg_restore --list "$TMP" > /dev/null
mv "$TMP" "$FILE"
sha256sum "$FILE" > "$FILE.sha256"
echo "Backup gravado: $FILE ($(du -h "$FILE" | cut -f1))"

# rotação
ls -1t "$DEST"/guto-*.dump 2>/dev/null | tail -n +"$((KEEP + 1))" | while read -r old; do
  rm -f "$old" "$old.sha256"
  echo "Removido backup antigo: $old"
done
