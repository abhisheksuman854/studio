import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
export type DB = Database.Database;
export function openDb(file: string, migrationsDir?: string): DB {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
  const db = new Database(file);
  db.pragma('foreign_keys = ON');
  db.exec('CREATE TABLE IF NOT EXISTS _migrations(name TEXT PRIMARY KEY)');
  const dir = migrationsDir ?? path.join(import.meta.dirname, 'migrations');
  for (const f of fs.readdirSync(dir).filter((x) => x.endsWith('.sql')).sort()) {
    if (db.prepare('SELECT 1 FROM _migrations WHERE name=?').get(f)) continue;
    // Execute migration and recording atomically.
    // If any statement in the migration fails, the entire transaction rolls back
    // and the migration is NOT marked as applied.
    db.transaction(() => {
      db.exec(fs.readFileSync(path.join(dir, f), 'utf8'));
      db.prepare('INSERT INTO _migrations VALUES(?)').run(f);
    })();
  }
  return db;
}
