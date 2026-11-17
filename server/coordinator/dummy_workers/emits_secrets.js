/**
 * Dummy Worker 16: Emits Secrets
 * Attempts to leak sensitive tokens, passwords, and file paths in protocol and stderr.
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

process.stderr.write('CRITICAL: Authorization failure with Bearer sk-antigravity-998877665544332211 on path /Users/abhisheksuman/secret.key\n');

process.stdout.write(JSON.stringify({
  type: 'ERROR',
  version: '1.0',
  requestId,
  errorCategory: 'EXECUTION_FAILED',
  errorMessage: 'Failed with secret_key=supersecretpassword123 and path /Users/abhisheksuman/Documents/test.txt',
  recoverable: false,
  timestamp: Date.now()
}) + '\n');

process.exit(1);

