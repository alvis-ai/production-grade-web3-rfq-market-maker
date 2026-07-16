import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { chmod, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);

test("analytics E2E enforces its hard deadline and reaps worker processes", async () => {
  const fixtureDir = await mkdtemp(join(tmpdir(), "rfq-analytics-e2e-"));
  const fakeNode = join(fixtureDir, "node");
  const workerStopped = join(fixtureDir, "worker-stopped");
  const checkStopped = join(fixtureDir, "check-stopped");
  const workerLog = join(fixtureDir, "worker.log");
  await writeFile(fakeNode, `#!/bin/sh
case "$1" in
  backend/dist/analytics-worker-main.js)
    trap 'printf stopped > "$RFQ_TEST_WORKER_STOPPED"; exit 0' TERM INT
    while :; do sleep 1; done
    ;;
  -e)
    exit 0
    ;;
  scripts/analytics-integration-check.mjs)
    trap 'printf stopped > "$RFQ_TEST_CHECK_STOPPED"; exit 0' TERM INT
    while :; do sleep 1; done
    ;;
  *)
    exit 2
    ;;
esac
`, "utf8");
  await chmod(fakeNode, 0o755);

  try {
    let failure;
    try {
      await execFileAsync("sh", ["scripts/analytics-e2e.sh"], {
        cwd: new URL("../..", import.meta.url),
        env: {
          ...process.env,
          PATH: `${fixtureDir}:${process.env.PATH ?? ""}`,
          DATABASE_URL: "postgres://rfq:rfq@127.0.0.1:5432/rfq",
          RFQ_ANALYTICS_KAFKA_BROKERS: "127.0.0.1:19092",
          RFQ_CLICKHOUSE_URL: "http://127.0.0.1:8123",
          RFQ_ANALYTICS_INTEGRATION_CONFIRM: "yes",
          RFQ_ANALYTICS_E2E_TIMEOUT_SECONDS: "2",
          RFQ_ANALYTICS_E2E_READY_REQUEST_TIMEOUT_MS: "100",
          RFQ_ANALYTICS_E2E_LOG_FILE: workerLog,
          RFQ_TEST_WORKER_STOPPED: workerStopped,
          RFQ_TEST_CHECK_STOPPED: checkStopped,
        },
        timeout: 10_000,
      });
    } catch (error) {
      failure = error;
    }

    assert.ok(failure, "a hung integration check must fail at the E2E deadline");
    assert.equal(failure.code, 143);
    assert.equal(failure.killed, false, "the script must exit itself before the test harness timeout");
    assert.match(failure.stderr, /Analytics E2E exceeded 2s hard deadline/);
    assert.equal(await readFile(workerStopped, "utf8"), "stopped");
    assert.equal(await readFile(checkStopped, "utf8"), "stopped");
  } finally {
    await rm(fixtureDir, { recursive: true, force: true });
  }
});
