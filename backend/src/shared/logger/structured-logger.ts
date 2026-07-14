import pino, { type DestinationStream, type Logger, type LoggerOptions } from "pino";

export const supportedLogLevels = ["debug", "info", "warn", "error"] as const;
export type RfqLogLevel = (typeof supportedLogLevels)[number];
export type StructuredLogger = Logger;

const defaultLogLevel: RfqLogLevel = "info";
const serviceNamePattern = /^[a-z][a-z0-9-]{0,63}$/;
const redactedValue = "[REDACTED]";

const sensitiveLogPaths = [
  "apiKey",
  "apiSecret",
  "authorization",
  "cookie",
  "password",
  "privateKey",
  "signature",
  "x-api-key",
  "*.apiKey",
  "*.apiSecret",
  "*.authorization",
  "*.cookie",
  "*.password",
  "*.privateKey",
  "*.signature",
  "*['x-api-key']",
  "req.headers.authorization",
  "req.headers.cookie",
  "req.headers['x-api-key']",
] as const;

export interface StructuredLoggerOptions {
  env?: Record<string, string | undefined>;
  level?: RfqLogLevel;
  stream?: DestinationStream;
}

export function readLogLevel(
  env: Record<string, string | undefined> | undefined = runtimeEnvironment(),
): RfqLogLevel {
  const configured = ownEnvValue(env, "RFQ_LOG_LEVEL");
  if (configured === undefined || configured.trim().length === 0) return defaultLogLevel;
  const normalized = configured.trim().toLowerCase();
  if ((supportedLogLevels as readonly string[]).includes(normalized)) {
    return normalized as RfqLogLevel;
  }
  throw new Error(`RFQ_LOG_LEVEL must be one of ${supportedLogLevels.join(", ")}`);
}

export function createStructuredLogger(
  service: string,
  options: StructuredLoggerOptions = {},
): StructuredLogger {
  const loggerOptions = structuredLoggerConfig(service, options);
  return options.stream ? pino(loggerOptions, options.stream) : pino(loggerOptions);
}

export function structuredLoggerConfig(
  service: string,
  options: Omit<StructuredLoggerOptions, "stream"> = {},
): LoggerOptions {
  assertServiceName(service);
  assertStructuredLoggerOptions(options);
  const loggerOptions: LoggerOptions = {
    level: options.level ?? readLogLevel(options.env),
    messageKey: "message",
    base: { service },
    timestamp: pino.stdTimeFunctions.isoTime,
    formatters: {
      level(label) {
        return { level: label };
      },
    },
    redact: {
      paths: [...sensitiveLogPaths],
      censor: redactedValue,
    },
    serializers: {
      req(request: Record<string, unknown>) {
        return safeRequestLog(request);
      },
      res(response: Record<string, unknown>) {
        return safeResponseLog(response);
      },
      err(error: Error & { code?: unknown }) {
        return safeErrorLog(error);
      },
    },
  };
  return loggerOptions;
}

export function logProcessFailure(service: string, error: unknown): void {
  const logger = createStructuredLogger(service, { level: "error" });
  logger.error(
    { errorCode: processFailureCode(error), errorType: processFailureType(error) },
    "Process failed",
  );
}

function safeRequestLog(request: Record<string, unknown>): Record<string, unknown> {
  return compactLogFields({
    method: primitiveString(request.method),
    route: primitiveString(request.routerPath) ?? primitiveString(request.url),
    remoteAddress: primitiveString(request.remoteAddress),
  });
}

function safeResponseLog(response: Record<string, unknown>): Record<string, unknown> {
  const statusCode = response.statusCode;
  return Number.isSafeInteger(statusCode) ? { statusCode } : {};
}

function safeErrorLog(error: Error & { code?: unknown }): Record<string, unknown> {
  return compactLogFields({
    type: primitiveString(error.name),
    code: safeErrorCode(error.code),
  });
}

function processFailureCode(error: unknown): string {
  if (error instanceof Error) {
    const code = safeErrorCode((error as Error & { code?: unknown }).code);
    if (code !== undefined) return code;
    if (/^[A-Z][A-Z0-9_:-]{0,127}$/.test(error.message)) return error.message;
  }
  return "PROCESS_STARTUP_FAILED";
}

function processFailureType(error: unknown): string {
  return error instanceof Error && /^[A-Za-z][A-Za-z0-9]{0,63}$/.test(error.name)
    ? error.name
    : "UnknownError";
}

function safeErrorCode(value: unknown): string | undefined {
  return typeof value === "string" && /^[A-Z][A-Z0-9_:-]{0,127}$/.test(value)
    ? value
    : undefined;
}

function compactLogFields(fields: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== undefined));
}

function primitiveString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function assertServiceName(service: unknown): asserts service is string {
  if (typeof service !== "string" || !serviceNamePattern.test(service)) {
    throw new Error("Structured logger service must be a lowercase service identifier");
  }
}

function assertStructuredLoggerOptions(options: unknown): asserts options is StructuredLoggerOptions {
  if (typeof options !== "object" || options === null || Array.isArray(options)) {
    throw new Error("Structured logger options must be an object");
  }
  const record = options as Record<string, unknown>;
  const allowed = new Set(["env", "level", "stream"]);
  for (const key of Object.keys(record)) {
    if (!allowed.has(key)) throw new Error(`Structured logger option ${key} is not supported`);
  }
  if (Object.prototype.hasOwnProperty.call(record, "level") &&
      !(supportedLogLevels as readonly unknown[]).includes(record.level)) {
    throw new Error(`Structured logger level must be one of ${supportedLogLevels.join(", ")}`);
  }
  if (Object.prototype.hasOwnProperty.call(record, "env") &&
      (typeof record.env !== "object" || record.env === null || Array.isArray(record.env))) {
    throw new Error("Structured logger env must be an object");
  }
  if (Object.prototype.hasOwnProperty.call(record, "stream") &&
      (typeof record.stream !== "object" || record.stream === null ||
       typeof (record.stream as { write?: unknown }).write !== "function")) {
    throw new Error("Structured logger stream must expose write");
  }
}

function ownEnvValue(
  env: Record<string, string | undefined> | undefined,
  name: string,
): string | undefined {
  return env && Object.prototype.hasOwnProperty.call(env, name) ? env[name] : undefined;
}

function runtimeEnvironment(): Record<string, string | undefined> | undefined {
  return (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
}
