/**
 * Dummy Worker 15: Excessive Stderr
 * Emits 500 KB of stderr to test bounded buffer clamping, then succeeds.
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

// Write 500 KB of diagnostic stderr
const stderrChunk = 'DEBUG: Internal diagnostic line buffer test\n'.repeat(12000);
process.stderr.write(stderrChunk);

process.stdout.write(JSON.stringify({
  type: 'SUCCESS',
  version: '1.0',
  requestId,
  output: { stderrTest: true },
  durationMs: 20,
  timestamp: Date.now()
}) + '\n');

process.exit(0);

