import { recoverTypedDataAddress } from "viem";
import { APIError } from "../../shared/errors/api-error.js";
import type { SignedQuote } from "../../shared/types/rfq.js";
import {
  assertSignQuoteInput,
  assertSignature,
  assertSignedQuote,
  buildQuoteTypedData,
  type SignQuoteInput,
  type SignerService,
} from "./signer.service.js";

export interface RemoteSignerConfig {
  baseUrl: string;
  allowInsecureHttp: boolean;
  authToken: string;
  requestTimeoutMs: number;
  settlementAddress: `0x${string}`;
  trustedSignerAddress: `0x${string}`;
}

type FetchLike = (input: string | URL | Request, init?: RequestInit) => Promise<Response>;

const configFields = [
  "baseUrl",
  "allowInsecureHttp",
  "authToken",
  "requestTimeoutMs",
  "settlementAddress",
  "trustedSignerAddress",
] as const;
const authTokenPattern = /^[A-Za-z0-9._~-]{43,256}$/;
const maxResponseBytes = 1_024;

export class RemoteSignerService implements SignerService {
  private readonly baseUrl: string;
  private readonly authToken: string;
  private readonly requestTimeoutMs: number;
  private readonly settlementAddress: `0x${string}`;
  private readonly trustedSignerAddress: `0x${string}`;

  constructor(
    config: RemoteSignerConfig,
    private readonly fetchFn: FetchLike = fetch,
  ) {
    assertConfig(config);
    if (typeof fetchFn !== "function") throw new Error("Remote signer fetch dependency must be a function");
    this.baseUrl = normalizeBaseUrl(config.baseUrl, config.allowInsecureHttp);
    this.authToken = config.authToken;
    this.requestTimeoutMs = config.requestTimeoutMs;
    this.settlementAddress = normalizeAddress(config.settlementAddress, "settlementAddress");
    this.trustedSignerAddress = normalizeAddress(config.trustedSignerAddress, "trustedSignerAddress");
  }

  async signQuote(input: SignQuoteInput): Promise<`0x${string}`> {
    assertSignQuoteInput(input);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timeout.unref();
    try {
      const response = await this.fetchFn(new URL("/internal/sign", this.baseUrl), {
        method: "POST",
        headers: {
          authorization: `Bearer ${this.authToken}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(input),
        signal: controller.signal,
      }).catch(() => {
        throw signerUnavailable();
      });
      if (!response.ok) throw signerUnavailable();
      const body = await readBoundedJson(response);
      if (!isRecord(body) || Object.keys(body).length !== 1 ||
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
      return signature as `0x${string}`;
    } finally {
      clearTimeout(timeout);
    }
  }

  async checkHealth(): Promise<void> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), this.requestTimeoutMs);
    timeout.unref();
    try {
      const response = await this.fetchFn(new URL("/ready", this.baseUrl), {
        method: "GET",
        signal: controller.signal,
      }).catch(() => {
        throw signerUnavailable();
      });
      if (!response.ok) throw signerUnavailable();
      const body = await readBoundedJson(response);
      if (!isRecord(body) || Object.keys(body).length !== 1 || body.status !== "ok") {
        throw signerUnavailable();
      }
    } finally {
      clearTimeout(timeout);
    }
  }

  async verifyQuoteSignature(quote: SignedQuote, signature: `0x${string}`): Promise<boolean> {
    try {
      assertSignedQuote(quote);
      assertSignature(signature);
      const recovered = await recoverTypedDataAddress({
        ...buildQuoteTypedData(quote, this.settlementAddress),
        signature,
      });
      return recovered.toLowerCase() === this.trustedSignerAddress;
    } catch {
      return false;
    }
  }
}

async function readBoundedJson(response: Response): Promise<unknown> {
  let text: string;
  try {
    text = await response.text();
  } catch {
    throw signerUnavailable();
  }
  if (Buffer.byteLength(text, "utf8") > maxResponseBytes) throw signerUnavailable();
  try {
    return JSON.parse(text) as unknown;
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
  normalizeBaseUrl(value.baseUrl as string, value.allowInsecureHttp);
  if (typeof value.authToken !== "string" || !authTokenPattern.test(value.authToken)) {
    throw new Error("Remote signer authToken must be 43-256 URL-safe characters");
  }
  if (!Number.isSafeInteger(value.requestTimeoutMs) ||
      (value.requestTimeoutMs as number) < 100 || (value.requestTimeoutMs as number) > 60_000) {
    throw new Error("Remote signer requestTimeoutMs must be between 100 and 60000");
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
