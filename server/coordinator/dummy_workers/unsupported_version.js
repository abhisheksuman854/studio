/**
 * Dummy Worker 4: Unsupported Protocol Version
 * Emits messages with an unapproved protocol version ('99.0').
 */
import process from 'node:process';

const requestId = process.env.WORKER_REQUEST_ID || 'req_dummy_default';

process.stdout.write(JSON.stringify({
  type: 'START',
  version: '99.0', // Unsupported version
  requestId,
  workerType: 'DUMMY_WORKER',
  pid: process.pid,
  timestamp: Date.now()
}) + '\n');

process.stdout.write(JSON.stringify({
  type: 'SUCCESS',
  version: '99.0',
  requestId,
  output: { status: 'OK' },
  durationMs: 10,
  timestamp: Date.now()
}) + '\n');

process.exit(0);

