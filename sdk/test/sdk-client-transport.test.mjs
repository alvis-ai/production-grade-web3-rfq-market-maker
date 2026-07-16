import assert from "node:assert/strict";
import test from "node:test";
import { RFQClient, RFQClientError } from "../dist/index.js";

test("RFQClient cancels oversized JSON and metrics response streams", async () => {
  const canceledPaths = [];
  const client = new RFQClient("http://127.0.0.1:3000", {
    maxResponseBytes: 1_024,
    fetch: async (url) => oversizedResponse(() => canceledPaths.push(new URL(url).pathname)),
  });

  await assert.rejects(
    client.health(),
    (error) => {
      assert.ok(error instanceof RFQClientError);
      assert.equal(error.status, 200);
      assert.equal(error.code, "RFQ_CLIENT_ERROR");
      assert.equal(error.message, "RFQ health response exceeded 1024 bytes");
      return true;
    },
  );
  await assert.rejects(
    client.metrics(),
    (error) => {
      assert.ok(error instanceof RFQClientError);
      assert.equal(error.status, 200);
      assert.equal(error.message, "RFQ metrics response exceeded 1024 bytes");
      return true;
    },
  );
  assert.deepEqual(canceledPaths, ["/health", "/metrics"]);
});

test("RFQClient keeps stalled response bodies inside one request deadline", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal;
  let bodyCanceled = false;
  const client = new RFQClient("http://127.0.0.1:3000", {
    requestTimeoutMs: 100,
    fetch: async (_url, init) => {
      requestSignal = init.signal;
      return new Response(new ReadableStream({
        cancel() {
          bodyCanceled = true;
        },
      }));
    },
  });

  const rejected = assert.rejects(
    client.health(),
    (error) => {
      assert.ok(error instanceof RFQClientError);
      assert.equal(error.status, 0);
      assert.equal(error.code, "RFQ_CLIENT_ERROR");
      assert.equal(error.message, "RFQ health request timed out");
      return true;
    },
  );
  await settle();
  context.mock.timers.tick(100);
  await rejected;
  assert.equal(requestSignal.aborted, true);
  assert.equal(bodyCanceled, true);
});

test("RFQClient preserves timeouts while reading non-success response bodies", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });

  for (const [operation, expectedMessage] of [
    [(client) => client.health(), "RFQ health request timed out"],
    [(client) => client.ready(), "RFQ readiness request timed out"],
  ]) {
    const client = new RFQClient("http://127.0.0.1:3000", {
      requestTimeoutMs: 100,
      fetch: async () => new Response(new ReadableStream({}), { status: 503 }),
    });
    const rejected = assert.rejects(
      operation(client),
      (error) => {
        assert.ok(error instanceof RFQClientError);
        assert.equal(error.status, 0);
        assert.equal(error.message, expectedMessage);
        return true;
      },
    );
    await settle();
    context.mock.timers.tick(100);
    await rejected;
  }
});

test("RFQClient aborts connection stalls and maps transport failures", async (context) => {
  context.mock.timers.enable({ apis: ["setTimeout"] });
  let requestSignal;
  const stalledClient = new RFQClient("http://127.0.0.1:3000", {
    requestTimeoutMs: 100,
    fetch: async (_url, init) => {
      requestSignal = init.signal;
      return new Promise(() => undefined);
    },
  });

  const rejected = assert.rejects(stalledClient.metrics(), /RFQ metrics request timed out/);
  await settle();
  context.mock.timers.tick(100);
  await rejected;
  assert.equal(requestSignal.aborted, true);

  const failedClient = new RFQClient("http://127.0.0.1:3000", {
    fetch: async () => {
      throw new Error("credential-bearing upstream detail");
    },
  });
  await assert.rejects(
    failedClient.health(),
    (error) => {
      assert.ok(error instanceof RFQClientError);
      assert.equal(error.status, 0);
      assert.equal(error.message, "RFQ health request failed");
      assert.equal(error.message.includes("credential-bearing"), false);
      return true;
    },
  );
});

test("RFQClient rejects declared oversized bodies before reading them", async () => {
  let bodyCanceled = false;
  const client = new RFQClient("http://127.0.0.1:3000", {
    maxResponseBytes: 1_024,
    fetch: async () => new Response(new ReadableStream({
      cancel() {
        bodyCanceled = true;
      },
    }), {
      headers: {
        "content-length": "1025",
        "x-trace-id": "tr_sdk_oversized",
      },
    }),
  });

  await assert.rejects(
    client.health(),
    (error) => {
      assert.ok(error instanceof RFQClientError);
      assert.equal(error.message, "RFQ health response exceeded 1024 bytes");
      assert.equal(error.traceId, "tr_sdk_oversized");
      return true;
    },
  );
  assert.equal(bodyCanceled, true);
});

function oversizedResponse(onCancel) {
  return new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(new Uint8Array(1_025));
    },
    cancel() {
      onCancel();
    },
  }));
}

async function settle() {
  await new Promise((resolve) => setImmediate(resolve));
  await new Promise((resolve) => setImmediate(resolve));
}
