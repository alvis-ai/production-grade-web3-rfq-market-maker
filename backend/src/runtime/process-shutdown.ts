import { readDecimalIntegerConfig, readOwnEnvValue } from "./environment.js";

export type ShutdownSignal = "SIGINT" | "SIGTERM";

export interface ShutdownProcess {
  env?: Record<string, string | undefined>;
  exitCode?: string | number | null;
  exit?: (code?: number) => void;
  off?: (signal: ShutdownSignal, listener: () => void) => unknown;
  on?: (signal: ShutdownSignal, listener: () => void) => unknown;
}

export interface ShutdownLogger {
  error(fields: Readonly<Record<string, unknown>>, message: string): void;
}

interface ShutdownScheduler {
  clearTimeout(timer: unknown): void;
  setTimeout(callback: () => void, timeoutMs: number): unknown;
}

export interface BoundedShutdownController {
  complete(): void;
}

export interface BoundedShutdownOptions {
  component: string;
  logger: ShutdownLogger;
  onShutdown: (signal: ShutdownSignal) => void;
  processLike?: ShutdownProcess;
  scheduler?: ShutdownScheduler;
  timeoutMs: number;
}

export const defaultShutdownTimeoutMs = 20_000;

const defaultScheduler: ShutdownScheduler = {
  clearTimeout(timer) {
    clearTimeout(timer as ReturnType<typeof setTimeout>);
  },
  setTimeout(callback, timeoutMs) {
    const timer = setTimeout(callback, timeoutMs);
    timer.unref();
    return timer;
  },
};

export function readShutdownTimeoutMs(
  env: Record<string, string | undefined> | undefined,
): number {
  const configured = readOwnEnvValue(env, "RFQ_SHUTDOWN_TIMEOUT_MS");
  if (configured !== undefined && configured.length > 0 && !/^[1-9][0-9]*$/.test(configured)) {
    throw new Error("RFQ_SHUTDOWN_TIMEOUT_MS must be a base-10 integer between 1000 and 120000");
  }
  return readDecimalIntegerConfig(configured, {
    defaultValue: defaultShutdownTimeoutMs,
    max: 120_000,
    min: 1_000,
    name: "RFQ_SHUTDOWN_TIMEOUT_MS",
  });
}

export function installBoundedShutdown(options: BoundedShutdownOptions): BoundedShutdownController {
  if (!Number.isSafeInteger(options.timeoutMs) || options.timeoutMs < 1_000 || options.timeoutMs > 120_000) {
    throw new Error("shutdown timeoutMs must be an integer between 1000 and 120000");
  }
  const processLike = options.processLike;
  if (!processLike?.on) {
    return { complete() {} };
  }

  const scheduler = options.scheduler ?? defaultScheduler;
  let activeSignal: ShutdownSignal | undefined;
  let completed = false;
  let forced = false;
  let deadline: unknown;

  const forceExit = (errorCode: "PROCESS_SHUTDOWN_FORCED" | "PROCESS_SHUTDOWN_TIMEOUT") => {
    if (forced || completed) return;
    forced = true;
    options.logger.error({
      component: options.component,
      errorCode,
      signal: activeSignal,
      timeoutMs: options.timeoutMs,
    }, errorCode === "PROCESS_SHUTDOWN_TIMEOUT"
      ? "Process shutdown deadline exceeded"
      : "Process shutdown forced by repeated signal");
    processLike.exitCode = 1;
    processLike.exit?.(1);
  };

  const begin = (signal: ShutdownSignal) => {
    if (completed) return;
    if (activeSignal) {
      forceExit("PROCESS_SHUTDOWN_FORCED");
      return;
    }

    activeSignal = signal;
    deadline = scheduler.setTimeout(
      () => forceExit("PROCESS_SHUTDOWN_TIMEOUT"),
      options.timeoutMs,
    );
    try {
      options.onShutdown(signal);
    } catch {
      forceExit("PROCESS_SHUTDOWN_FORCED");
    }
  };

  const onSigint = () => begin("SIGINT");
  const onSigterm = () => begin("SIGTERM");
  processLike.on("SIGINT", onSigint);
  processLike.on("SIGTERM", onSigterm);

  return {
    complete() {
      if (completed) return;
      completed = true;
      if (deadline !== undefined) scheduler.clearTimeout(deadline);
      processLike.off?.("SIGINT", onSigint);
      processLike.off?.("SIGTERM", onSigterm);
    },
  };
}
