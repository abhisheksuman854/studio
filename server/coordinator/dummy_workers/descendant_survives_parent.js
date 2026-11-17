/**
 * Dummy Worker 12: Descendant Survives Parent
 * Spawns child in same process group, parent exits immediately, leaving child running.
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

// Spawn child without detached: true (inherits PGID)
spawn(process.execPath, [path.join(__dirname, 'infinite_process.js')], {
  stdio: 'ignore',
  detached: false,
});

// Give child a tick to spawn, then parent exits
setTimeout(() => {
  process.exit(0);
}, 50);

