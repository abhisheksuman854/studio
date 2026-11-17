/**
 * Dummy Worker 7: Infinite Process
 * Emits START and hangs forever with setInterval.
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

// Loop forever until externally terminated
setInterval(() => {}, 10000);

