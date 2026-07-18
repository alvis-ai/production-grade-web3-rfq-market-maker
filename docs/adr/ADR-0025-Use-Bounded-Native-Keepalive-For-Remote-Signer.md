# ADR-0025: Use Bounded Native Keepalive For Remote Signer

## Status

Accepted

## Context

ADR-0024 measured about 2.30 ms inside the isolated signer but 6.41 ms in the gateway signing stage. The roughly 4.1 ms remainder included service transport, JSON adaptation and mandatory gateway EIP-712 recovery. The existing `RemoteSignerService` used Node's global Fetch implementation. It reused connections, but every request still crossed the Fetch `Request`, `Response` and Web Streams adapters.

A real Compose microbenchmark ran inside the backend container against the same signer service, local EIP-712 signing and Redis Stream audit admission used by the quote path. Each client executed 20 warmups and 200 measured sequential requests with identical validated envelopes. Two Fetch runs reported p50 3.43-3.77 ms and p99 4.24-4.92 ms. A native `http.request` client with one explicit keep-alive socket reported p50 1.68-1.78 ms and p99 2.57-3.52 ms. The repeated result justifies replacing the adapter overhead without weakening the signer protocol.

## Decision

The default `RemoteSignerService` transport uses Node's native HTTP or HTTPS request API with a process-owned keep-alive agent:

1. `RFQ_SIGNER_SERVICE_MAX_CONNECTIONS` defaults to 32 and accepts only 1 through 256. It bounds active, free and total sockets per API process.
2. HTTPS retains Node's default hostname and certificate validation and continues to consume the mounted CA through `NODE_EXTRA_CA_CERTS`.
3. One AbortController deadline still covers connection establishment, request write, response streaming and JSON decoding.
4. Successful bodies are validated against `Content-Length`, streamed through the existing 1 KiB limit and decoded as fatal UTF-8 before JSON parsing.
5. Non-2xx, oversized, malformed, aborted and stalled responses destroy the affected stream and map to the same generic `SIGNER_UNAVAILABLE` result.
6. Gateway EIP-712 recovery and trusted-signer comparison remain mandatory after transport decoding.
7. Gateway shutdown destroys the pool. Injected Fetch remains only for deterministic adapter tests.

## Consequences

### Positive

- The measured signer transport common path removes about 1.7-2.1 ms without changing authorization, key isolation, audit admission or signature verification.
- Connection count is bounded and reviewable instead of inherited from a global dispatcher.
- Request `Content-Length` avoids chunked encoding for the small fixed signer envelope.
- Native response handling keeps the byte cap before complete buffering.

### Negative

- The project owns more HTTP response-state code and must test abort, malformed length, oversize and socket cleanup behavior.
- Every API replica can open up to the configured connection limit, so deployment capacity planning must multiply it by replica count.
- HTTP/1.1 still uses one in-flight request per socket and can queue when admitted concurrency exceeds the pool.
- This optimization alone does not prove p50 below 10 ms for the complete quote path.

### Mitigation

Unit and loopback integration tests cover injected transport failures, native connection reuse, bounded socket cleanup, timeout after response headers and oversized streaming responses. Production sizing must keep total API pool capacity within signer and KMS concurrency budgets. Quote-stage and signer-internal histograms remain the acceptance evidence.

The rebuilt dependency stack used 10 warmups and 100 measured quotes per window. Concurrency one returned zero errors, p50 12.72 ms, p99 17.56 ms and 5.48 ms average gateway signing, compared with the prior image's p50 14.88 ms, p99 19.44 ms and 6.41 ms signing. Two clean concurrency-five runs returned zero errors, p50 24.39-26.27 ms, p99 36.84-40.47 ms and signing 6.05-6.42 ms. A separate concurrency-five diagnostic reached p99 135.07 ms when issuance finalization entered the 250 ms histogram bucket; backlog and mirror errors remained zero and the spike did not repeat in two clean windows. The transport improvement is visible end to end, but p50 still fails 10 ms and the isolated issuance spike prevents a claim of stable production p99.

## Alternatives Considered

- Keep global Fetch: rejected because repeated real-service measurements showed roughly twice the native common-path latency.
- Use an unbounded native agent: rejected because API replica scaling could overload signer and KMS capacity.
- Disable TLS or certificate verification: rejected because transport latency cannot replace workload authentication.
- Move the KMS credential into the API: rejected because it collapses the signer isolation boundary.
- Adopt HTTP/2 or gRPC immediately: deferred because native HTTP/1.1 removes measured adapter overhead with a much smaller protocol and deployment change; multiplexed transport remains a candidate if pool queueing dominates under production concurrency.
