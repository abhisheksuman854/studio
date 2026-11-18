/**
 * Auravo Studio — AI-Foundation 2.3.3.1
 * Worker Protocol & Runtime Message Validation
 * 
 * Versioned, validated IPC protocol between Node.js Process Supervisor and Child Workers.
 * Strictly enforces message boundaries, Zod schema validation, version matching,
 * request correlation, and sensitive data redaction.
 */

import { z } from 'zod';

export const WORKER_PROTOCOL_VERSION = '1.0';

export type WorkerType =
  | 'DUMMY_WORKER'
  | 'SDXL_WORKER'
  | 'TEST_WORKER'
  | string;

export type WorkerMessageType =
  | 'START'
  | 'PROGRESS'
  | 'SUCCESS'
  | 'ERROR'
  | 'SHUTDOWN_ACK';

export type WorkerErrorCategory =
  | 'INITIALIZATION_FAILED'
  | 'INVALID_INPUT'
  | 'EXECUTION_FAILED'
  | 'TIMEOUT'
  | 'WORKER_CRASHED'
  | 'PROTOCOL_ERROR'
  | 'CANCELLED'
  | 'UNKNOWN_ERROR';

/**
 * Protocol Message Schemas
 */
export const startMessageSchema = z.object({
  type: z.literal('START'),
  version: z.string().min(1),
  requestId: z.string().min(1),
  processInstanceId: z.string().optional(),
  workerType: z.string().min(1),
  pid: z.number().int().positive(),
  timestamp: z.number().int().positive(),
  metadata: z.record(z.unknown()).optional(),
});

export const progressMessageSchema = z.object({
  type: z.literal('PROGRESS'),
  version: z.string().min(1),
  requestId: z.string().min(1),
  stage: z.string().min(1),
  percent: z.number().min(0).max(100),
  message: z.string().optional(),
  timestamp: z.number().int().positive(),
});

export const successMessageSchema = z.object({
  type: z.literal('SUCCESS'),
  version: z.string().min(1),
  requestId: z.string().min(1),
  output: z.record(z.unknown()),
  durationMs: z.number().min(0),
  timestamp: z.number().int().positive(),
});

export const errorMessageSchema = z.object({
  type: z.literal('ERROR'),
  version: z.string().min(1),
  requestId: z.string().min(1),
  errorCategory: z.string().min(1),
  errorMessage: z.string().min(1),
  recoverable: z.boolean().default(false),
  timestamp: z.number().int().positive(),
});

export const shutdownAckMessageSchema = z.object({
  type: z.literal('SHUTDOWN_ACK'),
  version: z.string().min(1),
  requestId: z.string().min(1),
  timestamp: z.number().int().positive(),
});

export const workerMessageSchema = z.discriminatedUnion('type', [
  startMessageSchema,
  progressMessageSchema,
  successMessageSchema,
  errorMessageSchema,
  shutdownAckMessageSchema,
]);

export type StartMessage = z.infer<typeof startMessageSchema>;
export type ProgressMessage = z.infer<typeof progressMessageSchema>;
export type SuccessMessage = z.infer<typeof successMessageSchema>;
export type ErrorMessage = z.infer<typeof errorMessageSchema>;
export type ShutdownAckMessage = z.infer<typeof shutdownAckMessageSchema>;
export type WorkerMessage = z.infer<typeof workerMessageSchema>;

export type WorkerMessageParseErrorCode =
  | 'EMPTY_LINE'
  | 'OVERSIZED_MESSAGE'
  | 'MALFORMED_JSON'
  | 'UNSUPPORTED_VERSION'
  | 'SCHEMA_VALIDATION_FAILED'
  | 'REQUEST_ID_MISMATCH';

export interface WorkerMessageParseResult {
  readonly success: boolean;
  readonly message?: WorkerMessage;
  readonly errorCode?: WorkerMessageParseErrorCode;
  readonly errorMessage?: string;
  readonly rawLength: number;
}

/**
 * Parses and validates an incoming raw line from worker stdout.
 */
export function parseWorkerMessage(
  rawLine: string,
  expectedRequestId?: string,
  maxLineBytes = 1024 * 1024 // 1 MB line limit
): WorkerMessageParseResult {
  const rawLength = Buffer.byteLength(rawLine, 'utf8');

  if (rawLength === 0 || !rawLine.trim()) {
    return {
      success: false,
      errorCode: 'EMPTY_LINE',
      errorMessage: 'Empty protocol line received',
      rawLength,
    };
  }

  if (rawLength > maxLineBytes) {
    return {
      success: false,
      errorCode: 'OVERSIZED_MESSAGE',
      errorMessage: `Protocol message exceeded max size (${rawLength} > ${maxLineBytes} bytes)`,
      rawLength,
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawLine);
  } catch (err: any) {
    return {
      success: false,
      errorCode: 'MALFORMED_JSON',
      errorMessage: `Invalid JSON received on worker stdout: ${err?.message || err}`,
      rawLength,
    };
  }

  if (typeof parsed !== 'object' || parsed === null) {
    return {
      success: false,
      errorCode: 'SCHEMA_VALIDATION_FAILED',
      errorMessage: 'Protocol message must be a JSON object',
      rawLength,
    };
  }

  const obj = parsed as Record<string, unknown>;

  // Check version before schema validation for precise rejection
  if (obj.version !== WORKER_PROTOCOL_VERSION) {
    return {
      success: false,
      errorCode: 'UNSUPPORTED_VERSION',
      errorMessage: `Unsupported worker protocol version: '${obj.version}' (expected '${WORKER_PROTOCOL_VERSION}')`,
      rawLength,
    };
  }

  // Check requestId correlation if expected
  if (expectedRequestId && obj.requestId !== expectedRequestId) {
    return {
      success: false,
      errorCode: 'REQUEST_ID_MISMATCH',
      errorMessage: `Message requestId '${obj.requestId}' does not match expected '${expectedRequestId}'`,
      rawLength,
    };
  }

  const result = workerMessageSchema.safeParse(parsed);
  if (!result.success) {
    return {
      success: false,
      errorCode: 'SCHEMA_VALIDATION_FAILED',
      errorMessage: `Schema validation failed: ${result.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join(', ')}`,
      rawLength,
    };
  }

  return {
    success: true,
    message: result.data,
    rawLength,
  };
}

/**
 * Serializes a protocol message into a newline-terminated string.
 */
export function serializeWorkerMessage(msg: WorkerMessage): string {
  return JSON.stringify(msg) + '\n';
}

/**
 * Diagnostic Sanitization and Sensitive Data Redaction
 * Prevents disclosure of host paths, passwords, API tokens, bearer headers,
 * URL basic authentication, PEM private key blocks, and environment variable patterns
 * in logs and error reports.
 */
export function sanitizeDiagnostic(text: string, maxLength = 2000): string {
  if (!text) return '';
  // Pre-bound input to avoid catastrophic ReDoS on unbounded inputs while preserving context
  const preBound = Math.max(maxLength * 2, 4096);
  let sanitized = text.length > preBound ? text.slice(0, preBound) : text;

  // 1. Redact multiline PEM/RSA private key blocks
  sanitized = sanitized.replace(
    /-----BEGIN (?:[A-Z0-9_-]+ )?PRIVATE KEY-----[\s\S]*?-----END (?:[A-Z0-9_-]+ )?PRIVATE KEY-----/gi,
    '[REDACTED_PRIVATE_KEY]'
  );

  // 2. Redact Authorization headers (Bearer, Basic, etc.)
  sanitized = sanitized.replace(
    /((?:^|[\r\n])\s*authorization\s*:\s*(?:bearer|basic)\s+)[^\r\n,;]+/gi,
    '$1[REDACTED_AUTH]'
  );

  // 3. Redact standalone bearer tokens
  sanitized = sanitized.replace(
    /(bearer\s+)[a-zA-Z0-9_\-\.]{8,}/gi,
    '$1[REDACTED_TOKEN]'
  );

  // 4. Redact URL basic authentication credentials (e.g. https://user:pass@host/path)
  sanitized = sanitized.replace(
    /([a-zA-Z][a-zA-Z0-9+.-]{1,16}:\/\/)(?:[^:\s\/@]+:[^@\s\/]+|[^@\s\/]+)@/g,
    '$1[REDACTED_CREDENTIALS]@'
  );

  // 5. Redact query string credentials (e.g. ?api_key=xyz, &token=abc)
  sanitized = sanitized.replace(
    /([?&](?:api[_-]?key|apikey|token|access[_-]?token|secret|password|auth|client[_-]?secret|key|refresh[_-]?token)=)[^&\s]+/gi,
    '$1[REDACTED]'
  );

  // 6. Redact potential secret / password / key assignments and environment variables
  sanitized = sanitized.replace(
    /(secret[_-]?key|password|token|api[_-]?key|auth[_-]?token|credential|access[_-]?key|secret|private[_-]?key|access[_-]?token|session[_-]?secret|database[_-]?url|client[_-]?secret|refresh[_-]?token)\s*[:=]\s*['"]?[^\s,'"\\;&\r\n]+['"]?/gi,
    '$1=[REDACTED]'
  );

  // 7. Redact macOS and Linux user home paths e.g. /Users/username/ or /home/username/
  sanitized = sanitized.replace(
    /(\/(?:Users|home)\/)[a-zA-Z0-9_.-]+(\/)/g,
    '$1[USER]$2'
  );

  // 8. Redact Windows absolute user paths e.g. C:\Users\username\
  sanitized = sanitized.replace(
    /([a-zA-Z]:\\(?:Users|Documents and Settings)\\[^\s"';,]+)/gi,
    '[REDACTED_WIN_PATH]'
  );

  // Truncate to bound length
  if (sanitized.length > maxLength) {
    sanitized = sanitized.slice(0, maxLength) + '... [TRUNCATED]';
  }

  return sanitized;
}
