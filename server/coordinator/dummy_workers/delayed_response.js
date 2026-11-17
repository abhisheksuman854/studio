/**
 * Dummy Worker 6: Delayed Response
 * Emits START, waits, emits PROGRESS, waits, emits SUCCESS.
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

setTimeout(() => {
  process.stdout.write(JSON.stringify({
    type: 'PROGRESS',
    version: '1.0',
    requestId,
    stage: 'HALFWAY_THERE',
    percent: 50,
    message: 'Processed 50%',
    timestamp: Date.now()
  }) + '\n');

  setTimeout(() => {
    process.stdout.write(JSON.stringify({
      type: 'SUCCESS',
      version: '1.0',
      requestId,
      output: { delayed: true, completed: true },
      durationMs: 150,
      timestamp: Date.now()
    }) + '\n');
    process.exit(0);
  }, 100);
}, 100);

