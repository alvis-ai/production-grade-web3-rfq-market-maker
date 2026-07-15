import type { FastifyInstance } from "fastify";
import { readDecimalIntegerConfig, readOwnEnvValue } from "./environment.js";
import {
  installBoundedShutdown,
  readShutdownTimeoutMs,
  type ShutdownLogger,
  type ShutdownProcess,
} from "./process-shutdown.js";

const defaultListenHost = "127.0.0.1";
const defaultListenPort = 3000;

export interface RuntimeProcess extends ShutdownProcess {
  argv?: string[];
}

const consoleShutdownLogger: ShutdownLogger = {
  error(fields, message) {
    console.error(message, fields);
  },
};

export function installGracefulShutdown(
  server: Pick<FastifyInstance, "close">,
  processLike: RuntimeProcess | undefined = runtimeProcess(),
  logger: ShutdownLogger = consoleShutdownLogger,
  timeoutMs = readShutdownTimeoutMs(processLike?.env),
): void {
  let controller: ReturnType<typeof installBoundedShutdown>;
  controller = installBoundedShutdown({
    component: "rfq-api",
    logger,
    processLike,
    timeoutMs,
    onShutdown: () => {
      server.close()
      .then(() => {
        controller.complete();
        if (processLike) processLike.exitCode = 0;
      })
      .catch(() => {
        controller.complete();
        logger.error({ errorCode: "SERVER_SHUTDOWN_FAILED" }, "Server shutdown failed");
        if (processLike) {
          processLike.exitCode = 1;
          processLike.exit?.(1);
        }
      });
    },
  });
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
