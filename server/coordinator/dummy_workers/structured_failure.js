/**
 * Dummy Worker 2: Structured Failure
 * Emits START, emits valid ERROR message, and exits with code 1.
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

process.stdout.write(JSON.stringify({
  type: 'ERROR',
  version: '1.0',
  requestId,
  errorCategory: 'EXECUTION_FAILED',
  errorMessage: 'Controlled dummy worker planned failure',
  recoverable: false,
  timestamp: Date.now()
}) + '\n');

process.exit(1);

