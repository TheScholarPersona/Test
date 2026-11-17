#!/usr/bin/env bash
# Erzeugt eine Migration aus den Entity-Änderungen, benennt sie sprechend,
# trägt sie in src/migrations/index.ts ein und prüft sie auf einer frischen
# Datenbank (danach darf keine Schemaänderung mehr übrig sein).
#
#   DATABASE_URL=postgresql://… scripts/new-migration.sh <JJJJMMTTHHMMSS> <name> "<Beschreibung>"
#
# Die Datenbank wird dabei geleert – nur mit einer Wegwerf-Datenbank verwenden.
set -euo pipefail
cd "$(dirname "$0")/.."

stamp="$1"; name="$2"; description="$3"
class="Migration${stamp}_${name}"
target="src/migrations/${class}.ts"
: "${DATABASE_URL:?DATABASE_URL setzen (Wegwerf-Datenbank)}"

reset_db() { node -e "
  const { MikroORM } = await import('@mikro-orm/postgresql');
  const orm = await MikroORM.init({ clientUrl: process.env.DATABASE_URL, entities: [], discovery: { warnWhenNoEntities: false } });
  await orm.em.getConnection().execute('drop schema public cascade; create schema public;');
  await orm.close();" --input-type=module; }

[ -e "$target" ] && { echo "Existiert bereits: $target" >&2; exit 1; }
pnpm -s build
reset_db
node dist/scripts/migrate.js up >/dev/null
before=$(ls src/migrations/Migration*.ts)
node dist/scripts/migrate.js create
generated=$(comm -13 <(echo "$before") <(ls src/migrations/Migration*.ts))
[ -n "$generated" ] || { echo "Keine Schemaänderungen – nichts zu tun"; exit 0; }

old=$(basename "$generated" .ts)
sed -e "s/${old}/${class}/g" -e "0,/^export class/s//\/** ${description} *\/\nexport class/" "$generated" > "$target"
rm "$generated"

last_import=$(grep -n "^import { Migration" src/migrations/index.ts | tail -1 | cut -d: -f1)
sed -i "${last_import}a import { ${class} } from './${class}.js';" src/migrations/index.ts
last_entry=$(grep -n "^  { name: Migration" src/migrations/index.ts | tail -1 | cut -d: -f1)
sed -i "${last_entry}a \ \ { name: ${class}.name, class: ${class} }," src/migrations/index.ts

pnpm -s build
reset_db
node dist/scripts/migrate.js up
node dist/scripts/migrate.js create | tee /dev/stderr | grep -q "Keine Schemaänderungen" || { echo "Abweichung nach Migration!" >&2; exit 1; }
# Der Schema-Snapshot heißt nach der Datenbank; nur der Snapshot der Anwendung (wms) gehört ins Repository.
find src/migrations -maxdepth 1 -name '.snapshot-*.json' ! -name '.snapshot-wms.json' -delete
echo "Fertig: $target"
