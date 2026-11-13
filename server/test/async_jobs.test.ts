import test from 'node:test';
import assert from 'node:assert/strict';
import type { AddressInfo } from 'node:net';
import { openDb } from '../db.js';
import { createApp } from '../app.js';
import { JobManager } from '../jobs.js';

function client(base: string) {
  let cookie = '';
  return async (method: string, path: string, body?: unknown) => {
    const r = await fetch(base + path, {
      method,
      headers: { 'content-type': 'application/json', cookie },
      body: body ? JSON.stringify(body) : undefined,
    });
    const sc = r.headers.get('set-cookie');
    if (sc) cookie = sc.split(';')[0];
    return { status: r.status, body: r.status === 204 ? null : await r.json() };
  };
}

test('Async Job State Machine - Unit Level Lifecycle', () => {
  const db = openDb(':memory:');
  const manager = new JobManager(db);

  // Setup user
  db.prepare("INSERT INTO users(id, email, passwordHash) VALUES(1, 'creator@auravo.studio', 'hash')").run();

  // 1. Create Job (null contentItemId for pure unit test)
  const job = manager.createJob({
    ownerId: 1,
    contentItemId: null,
    type: 'FULL_VIDEO_RENDER',
    inputPayload: { resolution: '1080x1920' },
  });

  assert.ok(job.id.startsWith('job_'));
  assert.equal(job.status, 'QUEUED');
  assert.equal(job.progress, 0);

  // 2. Update Progress
  manager.updateProgress(job.id, 1, {
    status: 'GENERATING_CHARACTER',
    progress: 40,
    currentStage: 'Generating character portraits',
  });

  const updated = manager.getJob(job.id, 1);
  assert.equal(updated?.status, 'GENERATING_CHARACTER');
  assert.equal(updated?.progress, 40);
  assert.equal(updated?.currentStage, 'Generating character portraits');

  // 3. User isolation check (User 2 cannot see User 1's job)
  const jobUser2 = manager.getJob(job.id, 2);
  assert.equal(jobUser2, undefined);

  // 4. Cancel Job
  const cancelOk = manager.cancelJob(job.id, 1);
  assert.equal(cancelOk, true);

  const cancelledJob = manager.getJob(job.id, 1);
  assert.equal(cancelledJob?.status, 'CANCELLED');
});

test('Async Jobs API - HTTP Endpoints & Async Render', async () => {
  const srv = createApp(openDb(':memory:')).listen(0);
  const base = `http://localhost:${(srv.address() as AddressInfo).port}`;

  try {
    const c = client(base);

    // 1. Register & Setup Brand
    await c('POST', '/api/auth/register', { email: 'director@auravo.studio', password: 'password123' });
    const b = await c('POST', '/api/brands', {
      name: 'Auravo Test Studio',
      handle: 'auravo.test',
      niche: 'Dance',
    });
    const brandId = b.body.id;

    // 2. Generate idea and accept it to create content item
    const ideas = await c('POST', '/api/ideas/generate', { brandId, count: 1 });
    const accepted = await c('POST', `/api/ideas/${ideas.body[0].id}/accept`);
    const contentItemId = accepted.body.contentItemId;

    // 3. Queue Async Render Job
    const queueRes = await c('POST', `/api/content/${contentItemId}/render-async`);
    assert.equal(queueRes.status, 202);
    assert.ok(queueRes.body.jobId);
    assert.equal(queueRes.body.status, 'QUEUED');
    const jobId = queueRes.body.jobId;

    // 4. Poll Job immediately
    const pollRes = await c('GET', `/api/jobs/${jobId}`);
    assert.equal(pollRes.status, 200);
    assert.equal(pollRes.body.id, jobId);
    assert.ok(['QUEUED', 'INITIALIZING', 'SYNTHESIZING_VOICE', 'GENERATING_CHARACTER', 'GENERATING_MOTION', 'RENDERING_MASTER', 'QUALITY_CHECK', 'COMPLETED'].includes(pollRes.body.status));

    // 5. List Jobs
    const listRes = await c('GET', '/api/jobs');
    assert.equal(listRes.status, 200);
    assert.ok(listRes.body.length >= 1);
    assert.equal(listRes.body[0].id, jobId);
  } finally {
    srv.close();
  }
});
