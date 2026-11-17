/**
 * Dummy Worker 14: Unexpected Exit
 * Emits START, then abruptly exits with code 137 without sending SUCCESS or ERROR.
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

// Abrupt crash / kill exit
process.exit(137);

