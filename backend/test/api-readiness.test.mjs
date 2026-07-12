import assert from "node:assert/strict";
import test from "node:test";
import { buildServer } from "../dist/main.js";

test("RFQ API degrades readiness when market data is stale", async () => {
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        return {
          snapshotId: "snapshot_stale",
          midPrice: "1",
          liquidityUsd: "10000000000000",
          volatilityBps: 25,
          observedAt: new Date(Date.now() - 60_000).toISOString(),
        };
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/ready");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, "degraded");
    assert.equal(response.body.components.marketData, "degraded");
    assert.equal(response.body.components.signer, "ok");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_readiness_status\{status="ready"\} 0/);
    assert.match(metrics.payload, /rfq_readiness_status\{status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="marketData",status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="signer",status="ok"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API degrades readiness when market data timestamp is too far in the future", async () => {
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        return {
          snapshotId: "snapshot_future",
          midPrice: "1",
          liquidityUsd: "10000000000000",
          volatilityBps: 25,
          observedAt: new Date(Date.now() + 60_000).toISOString(),
        };
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/ready");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, "degraded");
    assert.equal(response.body.components.marketData, "degraded");
    assert.equal(response.body.components.signer, "ok");
  } finally {
    await server.close();
  }
});

test("RFQ API degrades readiness when market data shape is invalid", async () => {
  const server = buildServer({
    logger: false,
    marketDataService: {
      async getSnapshot() {
        return {
          snapshotId: "snapshot_invalid",
          midPrice: "0",
          liquidityUsd: "10000000000000",
          volatilityBps: 25,
          observedAt: new Date().toISOString(),
        };
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/ready");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, "degraded");
    assert.equal(response.body.components.marketData, "degraded");
    assert.equal(response.body.components.signer, "ok");
  } finally {
    await server.close();
  }
});

test("RFQ API degrades readiness when signer probe fails", async () => {
  let signerCalls = 0;
  const server = buildServer({
    logger: false,
    signerService: {
      async signQuote() {
        signerCalls += 1;
        throw new Error("signer readiness probe failed");
      },
      async verifyQuoteSignature() {
        return false;
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/ready");
    const cachedResponse = await injectJson(server, "GET", "/ready");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, "degraded");
    assert.equal(response.body.components.marketData, "ok");
    assert.equal(response.body.components.signer, "degraded");
    assert.equal(cachedResponse.body.components.signer, "degraded");
    assert.equal(signerCalls, 1);

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_readiness_status\{status="ready"\} 0/);
    assert.match(metrics.payload, /rfq_readiness_status\{status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="marketData",status="ok"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="signer",status="degraded"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API caches successful signer readiness probes", async () => {
  let signerCalls = 0;
  const server = buildServer({
    logger: false,
    signerService: {
      async signQuote() {
        signerCalls += 1;
        return `0x${"11".repeat(64)}1b`;
      },
      async verifyQuoteSignature() {
        return true;
      },
    },
  });
  await server.ready();

  try {
    const first = await injectJson(server, "GET", "/ready");
    const second = await injectJson(server, "GET", "/ready");

    assert.equal(first.body.components.signer, "ok");
    assert.equal(second.body.components.signer, "ok");
    assert.equal(signerCalls, 1);
  } finally {
    await server.close();
  }
});

test("RFQ API coalesces concurrent signer readiness probes", async () => {
  let signerCalls = 0;
  let releaseSigner;
  let reportSignerStarted;
  const signerGate = new Promise((resolve) => {
    releaseSigner = resolve;
  });
  const signerStarted = new Promise((resolve) => {
    reportSignerStarted = resolve;
  });
  const server = buildServer({
    logger: false,
    signerService: {
      async signQuote() {
        signerCalls += 1;
        reportSignerStarted();
        await signerGate;
        return `0x${"11".repeat(64)}1b`;
      },
      async verifyQuoteSignature() {
        return true;
      },
    },
  });
  await server.ready();

  try {
    const firstResponse = injectJson(server, "GET", "/ready");
    const secondResponse = injectJson(server, "GET", "/ready");
    await signerStarted;
    assert.equal(signerCalls, 1);
    releaseSigner();

    const [first, second] = await Promise.all([firstResponse, secondResponse]);
    assert.equal(first.body.components.signer, "ok");
    assert.equal(second.body.components.signer, "ok");
    assert.equal(signerCalls, 1);
  } finally {
    releaseSigner();
    await server.close();
  }
});

test("RFQ API degrades readiness when pricing probe fails", async () => {
  const server = buildServer({
    logger: false,
    pricingEngine: {
      async price() {
        throw new Error("pricing readiness probe failed");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/ready");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, "degraded");
    assert.equal(response.body.components.marketData, "ok");
    assert.equal(response.body.components.pricing, "degraded");
    assert.equal(response.body.components.risk, "ok");
    assert.equal(response.body.components.signer, "ok");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_dependency_status\{component="pricing",status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="risk",status="ok"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API degrades readiness when routing probe fails", async () => {
  const server = buildServer({
    logger: false,
    routingEngine: {
      async selectRoute() {
        throw new Error("routing readiness probe failed");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/ready");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, "degraded");
    assert.equal(response.body.components.marketData, "ok");
    assert.equal(response.body.components.routing, "degraded");
    assert.equal(response.body.components.pricing, "ok");
    assert.equal(response.body.components.risk, "ok");
    assert.equal(response.body.components.signer, "ok");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_dependency_status\{component="routing",status="degraded"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="pricing",status="ok"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="risk",status="ok"\} 1/);
  } finally {
    await server.close();
  }
});

test("RFQ API degrades readiness when risk probe fails", async () => {
  const server = buildServer({
    logger: false,
    riskEngine: {
      async evaluate() {
        throw new Error("risk readiness probe failed");
      },
    },
  });
  await server.ready();

  try {
    const response = await injectJson(server, "GET", "/ready");

    assert.equal(response.statusCode, 503);
    assert.equal(response.body.status, "degraded");
    assert.equal(response.body.components.marketData, "ok");
    assert.equal(response.body.components.pricing, "ok");
    assert.equal(response.body.components.risk, "degraded");
    assert.equal(response.body.components.signer, "ok");

    const metrics = await server.inject({ method: "GET", url: "/metrics" });
    assert.equal(metrics.statusCode, 200);
    assert.match(metrics.payload, /rfq_dependency_status\{component="pricing",status="ok"\} 1/);
    assert.match(metrics.payload, /rfq_dependency_status\{component="risk",status="degraded"\} 1/);
  } finally {
    await server.close();
  }
});

async function injectJson(server, method, url, payload, headers = {}) {
  const requestHeaders = { ...headers };
  if (payload) {
    requestHeaders["content-type"] = "application/json";
  }

  const response = await server.inject({
    method,
    url,
    headers: Object.keys(requestHeaders).length > 0 ? requestHeaders : undefined,
    payload: payload ? JSON.stringify(payload) : undefined,
  });

  return {
    statusCode: response.statusCode,
    headers: response.headers,
    body: response.payload ? JSON.parse(response.payload) : undefined,
  };
}
