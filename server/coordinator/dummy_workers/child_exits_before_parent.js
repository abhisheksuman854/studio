/**
 * Dummy Worker 11: Child Exits Before Parent
 * Spawns child, waits for child to cleanly exit, then emits SUCCESS and exits.
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

const child = spawn(process.execPath, [path.join(__dirname, 'immediate_success.js')], {
  stdio: 'ignore',
});

child.on('close', () => {
  process.stdout.write(JSON.stringify({
    type: 'SUCCESS',
    version: '1.0',
    requestId,
    output: { childExitedFirst: true },
    durationMs: 50,
    timestamp: Date.now()
  }) + '\n');
  process.exit(0);
});

