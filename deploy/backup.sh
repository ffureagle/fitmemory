#!/usr/bin/env sh
set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
BACKUP_DIR=${BACKUP_DIR:-"$SCRIPT_DIR/backups"}
RETENTION_DAYS=${RETENTION_DAYS:-30}
TIMESTAMP=$(date -u +"%Y%m%dT%H%M%SZ")

mkdir -p "$BACKUP_DIR"
cd "$SCRIPT_DIR"

set -a
. ./.env
set +a

TARGET="$BACKUP_DIR/fitmemory-$TIMESTAMP.sql.gz"
docker compose exec -T postgres \
  pg_dump \
  --username "$POSTGRES_USER" \
  --dbname "$POSTGRES_DB" \
  --format plain \
  --no-owner \
  --no-privileges |
  gzip -9 > "$TARGET"

gzip -t "$TARGET"
find "$BACKUP_DIR" \
  -type f \
  -name "fitmemory-*.sql.gz" \
  -mtime "+$RETENTION_DAYS" \
  -delete

printf "Yedek doğrulandı: %s\n" "$TARGET"
