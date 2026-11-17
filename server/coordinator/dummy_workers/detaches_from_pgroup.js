/**
 * Dummy Worker 13: Detaches From Process Group
 * Spawns child with detached: true, creating its own process group / session.
 */
import process from 'node:process';
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const requestId = process.env.WORKER_REQUEST_ID || 'req_dummy_default';

process.stdout.write(JSON.stringify({
  type: 'START',
  version: '1.0',
  requestId,
  workerType: 'DUMMY_WORKER',
  pid: process.pid,
  timestamp: Date.now()
}) + '\n');

// Spawn child with detached: true (new session)
const detachedChild = spawn(process.execPath, [path.join(__dirname, 'infinite_process.js')], {
  stdio: 'ignore',
  detached: true,
});

// Record the detached PID on stderr so the test can clean it up safely
process.stderr.write(`DETACHED_PID:${detachedChild.pid}\n`);

setTimeout(() => {
  process.exit(0);
}, 50);

