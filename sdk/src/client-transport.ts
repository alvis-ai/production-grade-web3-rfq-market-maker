import { RFQClientError } from "./client-error.js";
import type { RFQClientFetch } from "./client-request.js";

const maxTraceIdLength = 128;
const traceIdPattern = /^tr_[A-Za-z0-9._:-]+$/;

export interface BoundedClientResponse {
  readonly response: Response;
  readJson(label: string): Promise<unknown>;
  readText(label: string): Promise<string>;
}

type ResponseHandler<T> = (response: BoundedClientResponse) => Promise<T>;

export class RFQClientTransport {
  constructor(
    private readonly fetchImpl: RFQClientFetch,
    private readonly requestTimeoutMs: number,
    private readonly maxResponseBytes: number,
  ) {}

  async request<T>(
    input: string,
    init: RequestInit | undefined,
    operationLabel: string,
    handleResponse: ResponseHandler<T>,
  ): Promise<T> {
    const controller = new AbortController();
    const timeoutError = new RFQClientError(`${operationLabel} timed out`, 0);
    let timeout: ReturnType<typeof setTimeout> | undefined;
    const timeoutPromise = new Promise<never>((_resolve, reject) => {
      timeout = setTimeout(() => {
        controller.abort(timeoutError);
        reject(timeoutError);
      }, this.requestTimeoutMs);
    });

    const requestPromise = this.performRequest(
      input,
      init,
      operationLabel,
      controller.signal,
      handleResponse,
    );

    try {
      return await Promise.race([requestPromise, timeoutPromise]);
    } catch (error) {
      if (error instanceof RFQClientError) throw error;
      if (controller.signal.aborted && controller.signal.reason instanceof RFQClientError) {
        throw controller.signal.reason;
      }
      throw new RFQClientError(`${operationLabel} failed`, 0);
    } finally {
      if (timeout !== undefined) clearTimeout(timeout);
    }
  }

  private async performRequest<T>(
    input: string,
    init: RequestInit | undefined,
    operationLabel: string,
    signal: AbortSignal,
    handleResponse: ResponseHandler<T>,
  ): Promise<T> {
    let response: Response;
    try {
      response = await this.fetchImpl(input, { ...init, signal });
    } catch {
      if (signal.aborted && signal.reason instanceof RFQClientError) throw signal.reason;
      throw new RFQClientError(`${operationLabel} failed`, 0);
    }

    try {
      return await handleResponse(new StreamingClientResponse(response, this.maxResponseBytes, signal));
    } catch (error) {
      await cancelResponseBody(response);
      throw error;
    }
  }
}

class StreamingClientResponse implements BoundedClientResponse {
  private consumed = false;

  constructor(
    readonly response: Response,
    private readonly maxResponseBytes: number,
    private readonly signal: AbortSignal,
  ) {}

  async readJson(label: string): Promise<unknown> {
    const raw = await this.readBody(label);
    try {
      return JSON.parse(raw) as unknown;
    } catch {
      throw this.responseError(`${label} returned malformed JSON`);
    }
  }

  async readText(label: string): Promise<string> {
    return this.readBody(label);
  }

  private async readBody(label: string): Promise<string> {
    if (this.consumed) throw this.responseError(`${label} body was already consumed`);
    this.consumed = true;
    this.throwIfAborted();

    const contentLength = this.response.headers.get("content-length");
    if (contentLength !== null) {
      if (!/^(0|[1-9][0-9]*)$/.test(contentLength)) {
        await cancelResponseBody(this.response);
        throw this.responseError(`${label} returned invalid content-length`);
      }
      const declaredBytes = Number(contentLength);
      if (!Number.isSafeInteger(declaredBytes) || declaredBytes > this.maxResponseBytes) {
        await cancelResponseBody(this.response);
        throw this.responseError(`${label} exceeded ${this.maxResponseBytes} bytes`);
      }
    }

    if (!this.response.body) return "";

    const reader = this.response.body.getReader();
    const decoder = new TextDecoder("utf-8", { fatal: true });
    const textChunks: string[] = [];
    let receivedBytes = 0;
    const cancelOnAbort = () => {
      void reader.cancel(this.signal.reason).catch(() => undefined);
    };
    this.signal.addEventListener("abort", cancelOnAbort, { once: true });

    try {
      while (true) {
        this.throwIfAborted();
        const { done, value } = await reader.read();
        this.throwIfAborted();
        if (done) break;
        receivedBytes += value.byteLength;
        if (receivedBytes > this.maxResponseBytes) {
          await reader.cancel().catch(() => undefined);
          throw this.responseError(`${label} exceeded ${this.maxResponseBytes} bytes`);
        }
        textChunks.push(decoder.decode(value, { stream: true }));
      }
      textChunks.push(decoder.decode());
      return textChunks.join("");
    } catch (error) {
      await reader.cancel().catch(() => undefined);
      if (error instanceof RFQClientError) throw error;
      if (this.signal.aborted && this.signal.reason instanceof RFQClientError) {
        throw this.signal.reason;
      }
      throw this.responseError(`${label} could not be read`);
    } finally {
      this.signal.removeEventListener("abort", cancelOnAbort);
      reader.releaseLock();
    }
  }

  private throwIfAborted(): void {
    if (!this.signal.aborted) return;
    if (this.signal.reason instanceof RFQClientError) throw this.signal.reason;
    throw new RFQClientError("RFQ request aborted", 0);
  }

  private responseError(message: string): RFQClientError {
    return new RFQClientError(
      message,
      this.response.status,
      "RFQ_CLIENT_ERROR",
      traceIdFromResponse(this.response),
    );
  }
}

async function cancelResponseBody(response: Response): Promise<void> {
  await response.body?.cancel().catch(() => undefined);
}

function traceIdFromResponse(response: Response): string | undefined {
  const value = response.headers.get("x-trace-id");
  if (value === null) return undefined;
  const normalized = value.trim();
  if (normalized.length === 0 || normalized.length > maxTraceIdLength || !traceIdPattern.test(normalized)) {
    return undefined;
  }
  return normalized;
}
