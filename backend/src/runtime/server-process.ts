import type { FastifyInstance } from "fastify";
import { readDecimalIntegerConfig, readOwnEnvValue } from "./environment.js";

const defaultListenHost = "127.0.0.1";
const defaultListenPort = 3000;

export interface RuntimeProcess {
  argv?: string[];
  env?: Record<string, string | undefined>;
  exitCode?: number;
  on?: (signal: "SIGTERM" | "SIGINT", listener: () => void) => unknown;
}

interface ShutdownLogger {
  error: (...input: unknown[]) => void;
}

export function installGracefulShutdown(
  server: Pick<FastifyInstance, "close">,
  processLike: RuntimeProcess | undefined = runtimeProcess(),
  logger: ShutdownLogger = console,
): void {
  if (!processLike?.on) {
    return;
  }

  let closing = false;
  const shutdown = () => {
    if (closing) {
      return;
    }
    closing = true;

    server.close()
      .then(() => {
        processLike.exitCode = 0;
      })
      .catch((error: unknown) => {
        logger.error(error);
        processLike.exitCode = 1;
      });
  };

  processLike.on("SIGTERM", shutdown);
  processLike.on("SIGINT", shutdown);
}

export function readServerListenConfig(processLike: RuntimeProcess | undefined = runtimeProcess()) {
  const env = processLike?.env;
  return {
    host: readListenHost(readOwnEnvValue(env, "HOST")),
    port: readListenPort(readOwnEnvValue(env, "PORT")),
  };
}

export function runtimeProcess(): RuntimeProcess | undefined {
  return (globalThis as { process?: RuntimeProcess }).process;
}

function readListenHost(configured: string | undefined): string {
  if (!configured || configured.trim().length === 0) {
    return defaultListenHost;
  }

  const host = configured.trim();
  if (/\s/.test(host)) {
    throw new Error("HOST must be a non-empty hostname or IP address without whitespace");
  }

  return host;
}

function readListenPort(configured: string | undefined): number {
  return readDecimalIntegerConfig(configured, {
    defaultValue: defaultListenPort,
    max: 65_535,
    min: 1,
    name: "PORT",
  });
}
