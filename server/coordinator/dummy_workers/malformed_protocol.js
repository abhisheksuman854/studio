/**
 * Dummy Worker 3: Malformed Protocol Output
 * Emits invalid, non-JSON strings on stdout and exits.
 */
import process from 'node:process';

process.stdout.write('THIS_IS_NOT_JSON_AT_ALL_INVALID_LINE\n');
process.stdout.write('{ incomplete_json: 1234\n');
process.stdout.write('123456789\n');

process.exit(0);

