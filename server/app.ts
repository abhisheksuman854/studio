import express, { type Request, type Response, type NextFunction } from 'express';
import crypto from 'node:crypto';
import { execFile } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import type { DB } from './db.js';
import { crud, uid } from './crud.js';
import { createContentEngineRouter } from './content_engine.js';

const hash = (t: string) => crypto.createHash('sha256').update(t).digest('hex');
const hashPw = (pw: string) => { const s = crypto.randomBytes(16).toString('hex'); return s + ':' + crypto.scryptSync(pw, s, 64).toString('hex'); };
const checkPw = (pw: string, st: string) => { const [s, h] = st.split(':'); return crypto.timingSafeEqual(Buffer.from(h, 'hex'), crypto.scryptSync(pw, s, 64)); };
const cred = z.object({ email: z.string().email(), password: z.string().min(8) });
const str = z.string().max(2000).optional(), num = z.number().int().min(0).max(120).optional(), list = z.array(z.string().max(200)).max(50).default([]);

export function createApp(db: DB, opts: { secureCookie?: boolean } = {}) {
  const app = express();
  app.use('/storage', express.static(path.resolve('./data/storage')));
  app.use(express.json({ limit: '100mb' }));
  // CSRF: mutations must be JSON (cross-site forms can't send it without CORS preflight) + SameSite=Lax cookie.
  app.use((req, res, next) => (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) && !req.headers['content-type']?.startsWith('application/json') ? res.status(415).json({ error: 'JSON required' }) : next()));

  const fails = new Map<string, number>();
  const setCookie = (res: Response, userId: number) => {
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(hash(token), userId, Date.now() + 7 * 864e5);
    res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=604800${opts.secureCookie ? '; Secure' : ''}`);
  };
  const auth = (req: Request, res: Response, next: NextFunction) => {
    const t = /(?:^|; )sid=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1];
    const s = t && (db.prepare('SELECT userId FROM sessions WHERE tokenHash=? AND expiresAt>?').get(hash(t), Date.now()) as { userId: number } | undefined);
    if (!s) return res.status(401).json({ error: 'not signed in' });
    (req as Request & { userId: number }).userId = s.userId; next();
  };

  app.post('/api/auth/register', (req, res) => {
    const p = cred.safeParse(req.body);
    if (!p.success) return res.status(400).json({ error: 'valid email and 8+ char password required' });
    // Single-owner tool: only the first account may self-register.
    if ((db.prepare('SELECT COUNT(*) c FROM users').get() as { c: number }).c > 0) return res.status(403).json({ error: 'registration closed' });
    const id = db.prepare('INSERT INTO users(email,passwordHash) VALUES(?,?)').run(p.data.email.toLowerCase(), hashPw(p.data.password)).lastInsertRowid as number;
    setCookie(res, id); res.status(201).json({ id, email: p.data.email });
  });
  app.post('/api/auth/login', (req, res) => {
    const p = cred.safeParse(req.body), key = req.ip ?? '';
    if ((fails.get(key) ?? 0) >= 10) return res.status(429).json({ error: 'too many attempts' });
    const u = p.success && (db.prepare('SELECT * FROM users WHERE email=?').get(p.data.email.toLowerCase()) as { id: number; passwordHash: string } | undefined);
    if (!p.success || !u || !checkPw(p.data.password, u.passwordHash)) { fails.set(key, (fails.get(key) ?? 0) + 1); return res.status(401).json({ error: 'invalid credentials' }); }
    fails.delete(key); setCookie(res, u.id); res.json({ id: u.id });
  });
  app.post('/api/auth/logout', (req, res) => { const t = /sid=([a-f0-9]+)/.exec(req.headers.cookie ?? '')?.[1]; if (t) db.prepare('DELETE FROM sessions WHERE tokenHash=?').run(hash(t)); res.json({ ok: true }); });
  app.get('/api/auth/me', auth, (req, res) => res.json(db.prepare('SELECT id,email FROM users WHERE id=?').get(uid(req))));
  app.get('/api/health', (_q, res) => execFile('ffmpeg', ['-version'], (err, out) => res.json({ ok: true, ffmpeg: err ? null : out.split('\n')[0] })));

  const api = express.Router(); api.use(auth);
  api.use('/audience-profiles', crud(db, { table: 'audience_profiles', json: ['interests', 'avoid'], schema: z.object({ name: z.string().min(1).max(100), ageMin: num, ageMax: num, country: str, language: str, interests: list, preferredDurationSec: str, tone: str, avoid: list }) }));
  api.use('/brands', crud(db, {
    table: 'brands', json: ['secondaryLanguages', 'prohibitedTopics', 'preferredTopics'],
    schema: z.object({ name: z.string().min(1).max(100), handle: str, description: str, targetAgeMin: num, targetAgeMax: num, targetGender: str, country: str, language: str, secondaryLanguages: list, niche: str, audienceProfileId: z.number().int().nullable().optional(), tone: str, visualStyle: str, contentRules: str, prohibitedTopics: list, preferredTopics: list, postingFrequency: str, active: z.boolean().optional() }),
    check: (d, u, x) => x.audienceProfileId != null && !d.prepare('SELECT 1 FROM audience_profiles WHERE id=? AND ownerId=?').get(x.audienceProfileId, u) ? 'audience profile not found' : null,
  }));
  api.use('/characters', crud(db, {
    table: 'characters',
    schema: z.object({ brandId: z.number().int(), name: z.string().min(1).max(100), description: str, age: num, personality: str, appearance: str, clothingStyle: str, visualPrompt: str, negativePrompt: str, voiceStyle: str }),
    check: (d, u, x) => x.brandId != null && !d.prepare('SELECT 1 FROM brands WHERE id=? AND ownerId=?').get(x.brandId, u) ? 'brand not found' : null,
  }));
  api.use('/content', crud(db, {
    table: 'content_items',
    schema: z.object({ brandId: z.number().int(), title: z.string().min(1).max(200), topic: str, status: z.enum(['DRAFT', 'APPROVED', 'REJECTED', 'READY_FOR_REVIEW', 'ARCHIVED']).optional(), aiGenerated: z.boolean().optional() }),
    check: (d, u, x) => x.brandId != null && !d.prepare('SELECT 1 FROM brands WHERE id=? AND ownerId=?').get(x.brandId, u) ? 'brand not found' : null,
  }));
  api.use('/', createContentEngineRouter(db));
  app.use('/api', api);
  app.use('/api', (_q, res) => res.status(404).json({ error: 'not found' }));

  app.use('/storage', express.static(path.resolve('./data/storage')));
  const dist = path.resolve('web/dist');
  if (fs.existsSync(dist)) { app.use(express.static(dist)); app.get('*', (_q, res) => res.sendFile(path.join(dist, 'index.html'))); }
  app.use((e: Error, _q: Request, res: Response, _n: NextFunction) => { console.error(e); res.status(500).json({ error: 'internal error' }); });
  return app;
}
