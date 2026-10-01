import { Router, type Request } from 'express';
import { z } from 'zod';
import type { DB } from './db.js';

type Opts = { table: string; schema: z.ZodObject<z.ZodRawShape>; json?: string[]; check?: (db: DB, uid: number, d: Record<string, unknown>) => string | null };
export const uid = (req: Request) => (req as Request & { userId: number }).userId;

// Owner-scoped CRUD: every query is filtered by ownerId, so users can never touch each other's rows.
export function crud(db: DB, o: Opts) {
  const r = Router();
  const json = o.json ?? [];
  const out = (row: Record<string, unknown>) => { for (const k of json) row[k] = JSON.parse(String(row[k] ?? '[]')); return row; };
  const enc = (d: Record<string, unknown>) => Object.fromEntries(Object.entries(d).map(([k, v]) => [k, json.includes(k) ? JSON.stringify(v) : typeof v === 'boolean' ? +v : v]));
  const parse = (req: Request, partial: boolean) => (partial ? o.schema.partial() : o.schema).safeParse(req.body);
  r.get('/', (req, res) => res.json(db.prepare(`SELECT * FROM ${o.table} WHERE ownerId=? ORDER BY id DESC`).all(uid(req)).map((x) => out(x as Record<string, unknown>))));
  r.post('/', (req, res) => {
    const p = parse(req, false);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    const bad = o.check?.(db, uid(req), p.data); if (bad) return res.status(400).json({ error: bad });
    const d = { ...enc(p.data), ownerId: uid(req) }, ks = Object.keys(d);
    const id = db.prepare(`INSERT INTO ${o.table}(${ks.join(',')}) VALUES(${ks.map(() => '?').join(',')})`).run(...Object.values(d) as never[]).lastInsertRowid;
    db.prepare('INSERT INTO audit_logs(userId,action,entity,entityId) VALUES(?,?,?,?)').run(uid(req), 'create', o.table, id);
    res.status(201).json(out(db.prepare(`SELECT * FROM ${o.table} WHERE id=?`).get(id) as Record<string, unknown>));
  });
  r.patch('/:id', (req, res) => {
    const p = parse(req, true);
    if (!p.success) return res.status(400).json({ error: p.error.flatten() });
    const bad = o.check?.(db, uid(req), p.data); if (bad) return res.status(400).json({ error: bad });
    const d = enc(p.data), ks = Object.keys(d);
    if (!ks.length) return res.status(400).json({ error: 'nothing to update' });
    const n = db.prepare(`UPDATE ${o.table} SET ${ks.map((k) => k + '=?').join(',')} WHERE id=? AND ownerId=?`).run(...Object.values(d) as never[], req.params.id, uid(req)).changes;
    if (!n) return res.status(404).json({ error: 'not found' });
    res.json(out(db.prepare(`SELECT * FROM ${o.table} WHERE id=?`).get(req.params.id) as Record<string, unknown>));
  });
  r.delete('/:id', (req, res) => {
    try {
      const n = db.prepare(`DELETE FROM ${o.table} WHERE id=? AND ownerId=?`).run(req.params.id, uid(req)).changes;
      res.status(n ? 204 : 404).end();
    } catch { res.status(409).json({ error: 'still referenced by other records' }); }
  });
  return r;
}
