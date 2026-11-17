/**
 * Dummy Worker 9: Ignores SIGTERM
 * Emits START, traps SIGTERM and explicitly ignores it, requiring SIGKILL escalation.
 */
import process from 'node:process';

const requestId = process.env.WORKER_REQUEST_ID || 'req_dummy_default';

process.stdout.write(JSON.stringify({
  type: 'START',
  version: '1.0',
  requestId,
  workerType: 'DUMMY_WORKER',
  pid: process.pid,
  timestamp: Date.now()
}) + '\n');

process.on('SIGTERM', () => {
  // Explicitly ignore SIGTERM
  process.stderr.write('SIGTERM received but intentionally ignored by test worker\n');
});

setInterval(() => {}, 10000);

