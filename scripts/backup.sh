#!/usr/bin/env bash
# SCOOP MASTER database + uploads backup with rotation.
# Usage: DATABASE_URL=... UPLOAD_DIR=./storage/uploads BACKUP_DIR=./backups KEEP_DAYS=30 scripts/backup.sh
# Schedule daily, e.g. cron:  15 2 * * *  cd /srv/scoopmaster && ./scripts/backup.sh >> backups/backup.log 2>&1
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
UPLOAD_DIR="${UPLOAD_DIR:-./storage/uploads}"
KEEP_DAYS="${KEEP_DAYS:-30}"
STAMP="$(TZ=Asia/Manila date +%Y%m%d-%H%M%S)"
mkdir -p "$BACKUP_DIR"
DB_URL="${DATABASE_URL%%\?*}" # pg_dump does not understand Prisma's ?schema= parameter
pg_dump --format=custom --no-owner --file "$BACKUP_DIR/db-$STAMP.dump" "$DB_URL"
if [ -d "$UPLOAD_DIR" ]; then tar -czf "$BACKUP_DIR/uploads-$STAMP.tar.gz" -C "$(dirname "$UPLOAD_DIR")" "$(basename "$UPLOAD_DIR")"; fi
find "$BACKUP_DIR" -name 'db-*.dump' -mtime +"$KEEP_DAYS" -delete
find "$BACKUP_DIR" -name 'uploads-*.tar.gz' -mtime +"$KEEP_DAYS" -delete
echo "[$STAMP] backup complete: $BACKUP_DIR/db-$STAMP.dump"
# Restore: pg_restore --clean --no-owner -d "$DB_URL" backups/db-YYYYmmdd-HHMMSS.dump
# Copy backups off-site (e.g. object storage) — a backup on the same server is not a backup.
