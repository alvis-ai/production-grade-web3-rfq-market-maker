import {
  Agent as HttpAgent,
  request as httpRequest,
  type AgentOptions as HttpAgentOptions,
  type IncomingMessage,
} from "node:http";
import { Agent as HttpsAgent, request as httpsRequest } from "node:https";
import { bytesToHex, hashTypedData, hexToBytes } from "viem";
import { publicKeyToAddress } from "viem/accounts";
import { recover } from "tiny-secp256k1";
import { APIError } from "../../shared/errors/api-error.js";
import {
  cancelResponseBody,
  readBoundedJsonResponse,
} from "../../shared/http/bounded-json-response.js";
import type { SignedQuote } from "../../shared/types/rfq.js";
import {
  assertAuthorizedSignQuoteInput,
  assertSignature,
  assertSignedQuote,
  buildQuoteTypedData,
  type SignQuoteInput,
  type SignerService,
} from "./signer.service.js";
import {
  buildSignerQuoteFinalization,
  quoteFinalizationHash,
} from "./signer-quote-commit.js";

export interface RemoteSignerConfig {
  baseUrl: string;
  allowInsecureHttp: boolean;
  authToken: string;
  requestTimeoutMs: number;
  maxConnections: number;
  atomicQuoteCommit: boolean;
  authorizationWaitMs: number;
  settlementAddress: `0x${string}`;
  trustedSignerAddress: `0x${string}`;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const configFields = [
  "baseUrl",
  "allowInsecureHttp",
  "authToken",
  "requestTimeoutMs",
  "maxConnections",
  "atomicQuoteCommit",
  "authorizationWaitMs",
  "settlementAddress",
  "trustedSignerAddress",
] as const;
const authTokenPattern = /^[A-Za-z0-9._~-]{43,256}$/;
const maxResponseBytes = 1_024;

export class RemoteSignerService implements SignerService {
  readonly signaturesSelfVerified = true as const;
  readonly commitsQuoteFinalization?: true;
  readonly waitsForDurableAuthorization?: true;
  private readonly baseUrl: string;
  private readonly authToken: string;
  private readonly requestTimeoutMs: number;
  private readonly pooledTransport?: PooledSignerTransport;
  private readonly settlementAddress: `0x${string}`;
  private readonly trustedSignerAddress: `0x${string}`;

  constructor(
    config: RemoteSignerConfig,
    private readonly fetchFn?: FetchLike,
  ) {
    assertConfig(config);
    if (fetchFn !== undefined && typeof fetchFn !== "function") {
      throw new Error("Remote signer fetch dependency must be a function");
    }
    this.baseUrl = normalizeBaseUrl(config.baseUrl, config.allowInsecureHttp);
    this.authToken = config.authToken;
    this.requestTimeoutMs = config.requestTimeoutMs;
    this.commitsQuoteFinalization = config.atomicQuoteCommit ? true : undefined;
    this.waitsForDurableAuthorization = config.authorizationWaitMs > 0 ? true : undefined;
    this.settlementAddress = normalizeAddress(config.settlementAddress, "settlementAddress");
    this.trustedSignerAddress = normalizeAddress(config.trustedSignerAddress, "trustedSignerAddress");
    if (fetchFn === undefined) {
      this.pooledTransport = new PooledSignerTransport(
        this.baseUrl,
        this.requestTimeoutMs,
        config.maxConnections,
      );
    }
  }

  async signQuote(input: SignQuoteInput): Promise<`0x${string}`> {
    assertAuthorizedSignQuoteInput(input);
    if ((this.commitsQuoteFinalization === true) !== (input.commit !== undefined)) {
      throw signerUnavailable();
    }
    const body = await this.requestBoundedJson("/internal/sign", {
      method: "POST",
      headers: {
        authorization: `Bearer ${this.authToken}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    const expectedFields = this.commitsQuoteFinalization === true ? 2 : 1;
    if (!isRecord(body) || Object.keys(body).length !== expectedFields ||
        !Object.prototype.hasOwnProperty.call(body, "signature")) {
      throw signerUnavailable();
    }
    const signature = body.signature;
    try {
      assertSignature(signature as string);
    } catch {
      throw signerUnavailable();
    }
    if (!await this.verifyQuoteSignature(input.quote, signature as `0x${string}`)) {
      throw signerUnavailable();
    }
    if (this.commitsQuoteFinalization === true) {
      if (typeof body.finalizationHash !== "string" || !/^[0-9a-f]{64}$/.test(body.finalizationHash) ||
          body.finalizationHash !== quoteFinalizationHash(buildSignerQuoteFinalization(
            input,
            input.commit!,
            signature as `0x${string}`,
          ))) {
        throw signerUnavailable();
      }
    }
    return signature as `0x${string}`;
  }

  async checkHealth(): Promise<void> {
    const body = await this.requestBoundedJson("/ready", { method: "GET" });
    const expectedFields = this.commitsQuoteFinalization === true ? 2 : 1;
    const capabilities = isRecord(body) ? body.capabilities : undefined;
    const expectedCapabilities = this.waitsForDurableAuthorization === true
      ? ["atomic_quote_commit_v1", "durable_authorization_wait_v1"]
      : ["atomic_quote_commit_v1"];
    if (!isRecord(body) || Object.keys(body).length !== expectedFields || body.status !== "ok" ||
        (this.commitsQuoteFinalization === true &&
         (!Array.isArray(capabilities) || capabilities.length !== expectedCapabilities.length ||
          capabilities.some((capability, index) => capability !== expectedCapabilities[index])))) {
      throw signerUnavailable();
    }
  }

  async verifyQuoteSignature(quote: SignedQuote, signature: `0x${string}`): Promise<boolean> {
    try {
      assertSignedQuote(quote);
      assertSignature(signature);
      const digest = hashTypedData(buildQuoteTypedData(quote, this.settlementAddress));
      const rawRecoveryId = Number.parseInt(signature.slice(130, 132), 16);
      const recoveryId = rawRecoveryId < 27 ? rawRecoveryId : rawRecoveryId - 27;
      if (recoveryId !== 0 && recoveryId !== 1) return false;
      const publicKey = recover(
        hexToBytes(digest),
        hexToBytes(`0x${signature.slice(2, 130)}`),
        recoveryId,
        false,
      );
      if (!publicKey) return false;
      return publicKeyToAddress(bytesToHex(publicKey)).toLowerCase() === this.trustedSignerAddress;
    } catch {
      return false;
    }
  }

  close(): void {
    this.pooledTransport?.close();
  }

  private async requestBoundedJson(path: "/internal/sign" | "/ready", init: RequestInit): Promise<unknown> {
    if (this.pooledTransport) {
      return this.pooledTransport.requestBoundedJson(path, init);
    }
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timeout.unref();
    try {
      let response: Response;
      try {
        response = await this.fetchFn!(new URL(path, this.baseUrl), { ...init, signal: controller.signal });
      } catch {
        throw signerUnavailable();
      }
      if (!response.ok) {
        await cancelResponseBody(response);
        throw signerUnavailable();
      }
      return await readBoundedJson(response);
    } finally {
      clearTimeout(timeout);
    }
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  try {
    return await readBoundedJsonResponse(response, "Remote signer response", maxResponseBytes);
  } catch {
    throw signerUnavailable();
  }
}

function assertConfig(value: unknown): asserts value is RemoteSignerConfig {
  if (!isRecord(value)) throw new Error("Remote signer config must be an object");
  const allowed = new Set(configFields);
  if (Object.keys(value).some((field) => !allowed.has(field as typeof configFields[number]))) {
    throw new Error("Remote signer config fields are invalid");
  }
  for (const field of configFields) {
    if (!Object.prototype.hasOwnProperty.call(value, field)) {
      throw new Error(`Remote signer config.${field} must be an own field`);
    }
  }
  if (typeof value.allowInsecureHttp !== "boolean") {
    throw new Error("Remote signer allowInsecureHttp must be a boolean");
  }
  if (typeof value.atomicQuoteCommit !== "boolean") {
    throw new Error("Remote signer atomicQuoteCommit must be a boolean");
  }
  if (!Number.isSafeInteger(value.authorizationWaitMs) ||
      (value.authorizationWaitMs as number) < 0 || (value.authorizationWaitMs as number) > 100) {
    throw new Error("Remote signer authorizationWaitMs must be between 0 and 100");
  }
  if ((value.authorizationWaitMs as number) > 0 && value.atomicQuoteCommit !== true) {
    throw new Error("Remote signer authorizationWaitMs requires atomicQuoteCommit");
  }
  normalizeBaseUrl(value.baseUrl as string, value.allowInsecureHttp);
  if (typeof value.authToken !== "string" || !authTokenPattern.test(value.authToken)) {
    throw new Error("Remote signer authToken must be 43-256 URL-safe characters");
  }
  if (!Number.isSafeInteger(value.requestTimeoutMs) ||
      (value.requestTimeoutMs as number) < 100 || (value.requestTimeoutMs as number) > 60_000) {
    throw new Error("Remote signer requestTimeoutMs must be between 100 and 60000");
  }
  if (!Number.isSafeInteger(value.maxConnections) ||
      (value.maxConnections as number) < 1 || (value.maxConnections as number) > 256) {
    throw new Error("Remote signer maxConnections must be between 1 and 256");
  }
  normalizeAddress(value.settlementAddress, "settlementAddress");
  normalizeAddress(value.trustedSignerAddress, "trustedSignerAddress");
}

function normalizeBaseUrl(value: string, allowInsecureHttp: boolean): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error("Remote signer baseUrl must be a valid URL");
  }
  const loopback = url.hostname === "localhost" || url.hostname === "127.0.0.1" || url.hostname === "::1";
  if ((url.protocol !== "https:" && !(url.protocol === "http:" && (loopback || allowInsecureHttp))) ||
      url.username || url.password || url.pathname !== "/" || url.search || url.hash) {
    throw new Error("Remote signer baseUrl must be an HTTPS origin or explicitly approved local HTTP origin");
  }
  return url.origin;
}

function normalizeAddress(value: unknown, field: "settlementAddress" | "trustedSignerAddress"): `0x${string}` {
  if (typeof value !== "string" || !/^0x[0-9a-fA-F]{40}$/.test(value) || /^0x0{40}$/i.test(value)) {
    throw new Error(`Remote signer ${field} must be a non-zero 20-byte hex address`);
  }
  return value.toLowerCase() as `0x${string}`;
}

function signerUnavailable(): APIError {
  return new APIError("SIGNER_UNAVAILABLE", "Signer service unavailable", 503);
}

class PooledSignerTransport {
  private readonly baseUrl: string;
  private readonly requestFn: typeof httpRequest | typeof httpsRequest;
  private readonly agent: HttpAgent | HttpsAgent;

  constructor(baseUrl: string, private readonly requestTimeoutMs: number, maxConnections: number) {
    this.baseUrl = baseUrl;
    const options: HttpAgentOptions = {
      keepAlive: true,
      maxSockets: maxConnections,
      maxFreeSockets: maxConnections,
      maxTotalSockets: maxConnections,
      scheduling: "lifo",
    };
    if (new URL(baseUrl).protocol === "https:") {
      this.requestFn = httpsRequest;
      this.agent = new HttpsAgent(options);
    } else {
      this.requestFn = httpRequest;
      this.agent = new HttpAgent(options);
    }
  }

  async requestBoundedJson(path: "/internal/sign" | "/ready", init: RequestInit): Promise<unknown> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timeout.unref();
    try {
      return await this.request(new URL(path, this.baseUrl), init, controller.signal);
    } catch {
      throw signerUnavailable();
    } finally {
      clearTimeout(timeout);
    }
  }

  close(): void {
    this.agent.destroy();
  }

  private request(url: URL, init: RequestInit, signal: AbortSignal): Promise<unknown> {
    return new Promise((resolve, reject) => {
      const body = typeof init.body === "string" ? init.body : undefined;
      const headers = asRequestHeaders(init.headers);
      if (body !== undefined) headers["content-length"] = Buffer.byteLength(body).toString();
      const request = this.requestFn(url, {
        agent: this.agent,
        method: init.method,
        headers,
        signal,
      }, (response) => {
        if (response.statusCode === undefined || response.statusCode < 200 || response.statusCode >= 300) {
          response.destroy();
          reject(new Error("Remote signer returned a non-success status"));
          return;
        }
        readPooledJsonResponse(response).then(resolve, reject);
      });
      request.on("error", reject);
      request.end(body);
    });
  }
}

function asRequestHeaders(value: HeadersInit | undefined): Record<string, string> {
  if (value === undefined) return {};
  if (Array.isArray(value)) return Object.fromEntries(value);
  if (value instanceof Headers) return Object.fromEntries(value.entries());
  return { ...value } as Record<string, string>;
}

function readPooledJsonResponse(response: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const declaredLength = response.headers["content-length"];
    if (Array.isArray(declaredLength) ||
        (declaredLength !== undefined && !/^(0|[1-9]\d*)$/.test(declaredLength)) ||
        (declaredLength !== undefined && Number(declaredLength) > maxResponseBytes)) {
      response.destroy();
      reject(new Error("Remote signer response has an invalid content length"));
      return;
    }
    const chunks: Buffer[] = [];
    let bytes = 0;
    response.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
      if (bytes > maxResponseBytes) {
        response.destroy();
        reject(new Error("Remote signer response exceeds the byte limit"));
        return;
      }
      chunks.push(chunk);
    });
    response.on("aborted", () => reject(new Error("Remote signer response was aborted")));
    response.on("error", reject);
    response.on("end", () => {
      try {
        const raw = new TextDecoder("utf-8", { fatal: true }).decode(Buffer.concat(chunks));
        resolve(JSON.parse(raw) as unknown);
      } catch {
        reject(new Error("Remote signer response must contain valid UTF-8 JSON"));
      }
    });
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
