import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb } from '../db.js';
import { createApp } from '../app.js';

function client(base: string) {
  let cookie = '';
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, { method, headers: { 'content-type': 'application/json', cookie }, body: body ? JSON.stringify(body) : undefined });
    const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };
}

test('auth, brands, ownership isolation', async () => {
  const srv = createApp(openDb(':memory:')).listen(0);
  const base = `http://localhost:${(srv.address() as AddressInfo).port}`;
  try {
    const a = client(base);
    assert.equal((await a('GET', '/api/brands')).status, 401);
    assert.equal((await a('POST', '/api/auth/register', { email: 'o@x.com', password: 'password123' })).status, 201);
    assert.equal((await client(base)('POST', '/api/auth/register', { email: 'b@x.com', password: 'password123' })).status, 403);
    const ap = await a('POST', '/api/audience-profiles', { name: 'Young Indian Adults', ageMin: 18, ageMax: 27, interests: ['humor'] });
    assert.equal(ap.status, 201); assert.deepEqual(ap.body.interests, ['humor']);
    const b = await a('POST', '/api/brands', { name: 'StoryWorld', handle: '@storyworld', audienceProfileId: ap.body.id, preferredTopics: ['mystery'] });
    assert.equal(b.status, 201); assert.deepEqual(b.body.preferredTopics, ['mystery']);
    assert.equal((await a('POST', '/api/brands', { name: '' })).status, 400);
    assert.equal((await a('POST', '/api/content', { brandId: 999, title: 'x' })).status, 400);
    const c = await a('POST', '/api/content', { brandId: b.body.id, title: 'The mysterious package' });
    assert.equal(c.body.status, 'DRAFT'); assert.equal(c.body.brandId, b.body.id);
    assert.equal((await a('PATCH', `/api/content/${c.body.id}`, { status: 'APPROVED' })).body.status, 'APPROVED');
    assert.equal((await a('DELETE', `/api/brands/${b.body.id}`)).status, 409); // has content -> protected
    assert.equal((await a('POST', '/api/auth/login', { email: 'o@x.com', password: 'wrongpass1' })).status, 401);
  } finally { srv.close(); }
});
