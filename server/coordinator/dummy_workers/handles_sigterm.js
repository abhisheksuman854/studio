/**
 * Dummy Worker 8: Handles SIGTERM
 * Emits START, traps SIGTERM, emits SHUTDOWN_ACK, and exits gracefully within 100ms.
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
  process.stdout.write(JSON.stringify({
    type: 'SHUTDOWN_ACK',
    version: '1.0',
    requestId,
    timestamp: Date.now()
  }) + '\n');

  setTimeout(() => {
    process.exit(0);
  }, 50);
});

setInterval(() => {}, 10000);

