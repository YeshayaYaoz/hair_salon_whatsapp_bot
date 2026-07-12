#!/usr/bin/env sh
# Production DB migration for Railway's preDeployCommand.
#
# Uses `prisma migrate deploy` (applies committed migration files forward) — NEVER `db push`,
# which force-syncs the schema and will DROP columns/tables and destroy data.
#
# This project's production database was originally created with `db push`, so it has no Prisma
# migration history. On the first run `migrate deploy` fails with P3005 ("database schema is not
# empty"); we then baseline it: apply every migration's SQL once (all are written idempotently
# with IF [NOT] EXISTS, so this is a safe no-op for anything already present and also reconciles
# any drift), then mark each migration as applied. Subsequent deploys just run `migrate deploy`
# normally and apply only genuinely new migrations.
set -e

err=$(mktemp)
if npx prisma migrate deploy 2>"$err"; then
  cat "$err" >&2 || true
  rm -f "$err"
  exit 0
fi

if grep -q "P3005" "$err"; then
  rm -f "$err"
  echo "[db-deploy] Existing database without migration history — baselining…"
  for dir in prisma/migrations/*/; do
    name=$(basename "$dir")
    echo "[db-deploy]   applying (idempotent) + marking applied: $name"
    npx prisma db execute --schema prisma/schema.prisma --file "$dir/migration.sql"
    npx prisma migrate resolve --applied "$name"
  done
  npx prisma migrate deploy
else
  cat "$err" >&2
  rm -f "$err"
  exit 1
fi
