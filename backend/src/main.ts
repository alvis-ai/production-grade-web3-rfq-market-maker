import { buildServer } from "./runtime/gateway-application.js";
import {
  installGracefulShutdown,
  readServerListenConfig,
  runtimeProcess,
} from "./runtime/server-process.js";
import { readShutdownTimeoutMs } from "./runtime/process-shutdown.js";
import { logProcessFailure } from "./shared/logger/structured-logger.js";

export { buildServer } from "./runtime/gateway-application.js";
export { installGracefulShutdown, readServerListenConfig } from "./runtime/server-process.js";
export { installBoundedShutdown, readShutdownTimeoutMs } from "./runtime/process-shutdown.js";
export type { BuildServerOptions } from "./runtime/gateway-runtime.js";

export async function startServer() {
  const server = buildServer();
  const processLike = runtimeProcess();
  const { host, port } = readServerListenConfig(processLike);
  const shutdownTimeoutMs = readShutdownTimeoutMs(processLike?.env);
  await server.listen({ host, port });
  installGracefulShutdown(server, processLike, server.log, shutdownTimeoutMs);
  return server;
}

const processLike = runtimeProcess();

if (processLike?.argv?.[1] && import.meta.url.endsWith(processLike.argv[1])) {
  startServer().catch((error: unknown) => {
    logProcessFailure("rfq-api", error);
    if (processLike) processLike.exitCode = 1;
  });
}
