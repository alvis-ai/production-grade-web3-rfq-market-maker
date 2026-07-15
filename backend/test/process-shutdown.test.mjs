import assert from "node:assert/strict";
import test from "node:test";
import {
  installBoundedShutdown,
  readShutdownTimeoutMs,
} from "../dist/runtime/process-shutdown.js";

test("shutdown timeout config is bounded and reads only own environment fields", () => {
  assert.equal(readShutdownTimeoutMs(undefined), 20_000);
  assert.equal(readShutdownTimeoutMs({ RFQ_SHUTDOWN_TIMEOUT_MS: "15000" }), 15_000);
  assert.throws(
    () => readShutdownTimeoutMs({ RFQ_SHUTDOWN_TIMEOUT_MS: "999" }),
    /between 1000 and 120000/,
  );
  assert.throws(
    () => readShutdownTimeoutMs({ RFQ_SHUTDOWN_TIMEOUT_MS: "020000" }),
    /base-10 integer/,
  );

  const inherited = Object.create({ RFQ_SHUTDOWN_TIMEOUT_MS: "15000" });
  assert.equal(readShutdownTimeoutMs(inherited), 20_000);
});

test("bounded shutdown starts once and removes its deadline after cleanup", () => {
  const harness = createHarness();
  const receivedSignals = [];
  const controller = installBoundedShutdown({
    component: "test-worker",
    logger: harness.logger,
    onShutdown(signal) {
      receivedSignals.push(signal);
    },
    processLike: harness.processLike,
    scheduler: harness.scheduler,
    timeoutMs: 20_000,
  });

  harness.listeners.get("SIGTERM")();
  assert.deepEqual(receivedSignals, ["SIGTERM"]);
  assert.equal(harness.scheduled.timeoutMs, 20_000);

  controller.complete();
  controller.complete();
  assert.deepEqual(harness.cleared, [harness.scheduled.token]);
  assert.deepEqual(harness.removed, ["SIGINT", "SIGTERM"]);
  assert.deepEqual(harness.exits, []);
  assert.deepEqual(harness.logs, []);
});

test("bounded shutdown rejects an unsafe direct deadline", () => {
  const harness = createHarness();
  assert.throws(() => installBoundedShutdown({
    component: "test-worker",
    logger: harness.logger,
    onShutdown() {},
    processLike: harness.processLike,
    scheduler: harness.scheduler,
    timeoutMs: 999,
  }), /between 1000 and 120000/);
  assert.equal(harness.listeners.size, 0);
});

test("bounded shutdown exits with failure when its deadline expires", () => {
  const harness = createHarness();
  installBoundedShutdown({
    component: "settlement-indexer",
    logger: harness.logger,
    onShutdown() {},
    processLike: harness.processLike,
    scheduler: harness.scheduler,
    timeoutMs: 20_000,
  });

  harness.listeners.get("SIGINT")();
  harness.scheduled.callback();

  assert.equal(harness.processLike.exitCode, 1);
  assert.deepEqual(harness.exits, [1]);
  assert.deepEqual(harness.logs, [[{
    component: "settlement-indexer",
    errorCode: "PROCESS_SHUTDOWN_TIMEOUT",
    signal: "SIGINT",
    timeoutMs: 20_000,
  }, "Process shutdown deadline exceeded"]]);
});

test("a repeated termination signal forces immediate failure", () => {
  const harness = createHarness();
  let stopCount = 0;
  installBoundedShutdown({
    component: "hedge-worker",
    logger: harness.logger,
    onShutdown() {
      stopCount += 1;
    },
    processLike: harness.processLike,
    scheduler: harness.scheduler,
    timeoutMs: 20_000,
  });

  harness.listeners.get("SIGTERM")();
  harness.listeners.get("SIGTERM")();

  assert.equal(stopCount, 1);
  assert.deepEqual(harness.exits, [1]);
  assert.equal(harness.logs[0][0].errorCode, "PROCESS_SHUTDOWN_FORCED");
});

function createHarness() {
  const listeners = new Map();
  const removed = [];
  const exits = [];
  const logs = [];
  const cleared = [];
  const scheduled = {};
  const processLike = {
    exitCode: undefined,
    exit(code) {
      exits.push(code);
    },
    off(signal, listener) {
      if (listeners.get(signal) === listener) listeners.delete(signal);
      removed.push(signal);
    },
    on(signal, listener) {
      listeners.set(signal, listener);
    },
  };
  const scheduler = {
    clearTimeout(token) {
      cleared.push(token);
    },
    setTimeout(callback, timeoutMs) {
      const token = Symbol("shutdown-deadline");
      Object.assign(scheduled, { callback, timeoutMs, token });
      return token;
    },
  };
  const logger = {
    error(fields, message) {
      logs.push([fields, message]);
    },
  };
  return { cleared, exits, listeners, logger, logs, processLike, removed, scheduled, scheduler };
}
