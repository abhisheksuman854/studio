/**
 * Dummy Worker 5: Oversized Output
 * Emits an oversized stdout line (> 1.5 MB) to test buffer limits.
 */
import process from 'node:process';

const chunk = 'X'.repeat(1024 * 1024 * 2); // 2 MB line
process.stdout.write(chunk + '\n');

// Keep process alive so supervisor detects buffer overflow and sends termination signal
const timer = setInterval(() => {}, 1000);
process.on('SIGTERM', () => {
  clearInterval(timer);
  process.exit(0);
});

