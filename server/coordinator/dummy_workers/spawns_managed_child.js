/**
 * Dummy Worker 10: Spawns Managed Child
 * Spawns a child process within the same process group (managed grandchild).
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

// Spawn child without detached: true, inheriting the process group
const child = spawn(process.execPath, [path.join(__dirname, 'infinite_process.js')], {
  stdio: 'ignore',
  detached: false,
});

setInterval(() => {}, 10000);

