/**
 * Dummy Worker 1: Immediate Success
 * Emits START, emits valid SUCCESS result, and exits with code 0.
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
  type: 'SUCCESS',
  version: '1.0',
  requestId,
  output: { status: 'COMPLETED', generatedItems: 1, qualityScore: 99 },
  durationMs: 15,
  timestamp: Date.now()
}) + '\n');

process.exit(0);

