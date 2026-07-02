import type { Address } from "@rfq-market-maker/sdk";

const defaultRFQApiBaseUrl = "http://localhost:3000";
const defaultRFQSettlementAddress = "0x0000000000000000000000000000000000000004";
const defaultWalletConnectProjectId = "00000000000000000000000000000000";

export const rfqApiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_RFQ_API_BASE_URL);
export const rfqSettlementAddress = normalizeAddress(import.meta.env.VITE_RFQ_SETTLEMENT_ADDRESS);
export const walletConnectProjectId = normalizeWalletConnectProjectId(import.meta.env.VITE_WALLETCONNECT_PROJECT_ID);

export function normalizeBaseUrl(value: string | undefined): string {
  const normalized = value?.trim();
  const candidate = normalized && normalized.length > 0 ? normalized : defaultRFQApiBaseUrl;
  let parsed: URL;
  try {
    parsed = new URL(candidate);
  } catch {
    throw new Error("VITE_RFQ_API_BASE_URL must be an absolute http(s) URL");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("VITE_RFQ_API_BASE_URL must use http or https");
  }

  if (parsed.username || parsed.password) {
    throw new Error("VITE_RFQ_API_BASE_URL must not include credentials");
  }
  if (parsed.hostname.includes("*")) {
    throw new Error("VITE_RFQ_API_BASE_URL host must not contain wildcards");
  }
  if (parsed.search || parsed.hash || candidate.includes("?") || candidate.includes("#")) {
    throw new Error("VITE_RFQ_API_BASE_URL must not include query strings or fragments");
  }

  const pathname = parsed.pathname.replace(/\/+$/, "");
  return `${parsed.origin}${pathname}`;
}

export function normalizeAddress(value: string | undefined): Address {
  const normalized = value?.trim();
  const candidate = normalized && normalized.length > 0 ? normalized : defaultRFQSettlementAddress;
  if (!/^0x[a-fA-F0-9]{40}$/.test(candidate)) {
    throw new Error("VITE_RFQ_SETTLEMENT_ADDRESS must be a 20-byte hex address");
  }

  return candidate as Address;
}

export function normalizeWalletConnectProjectId(value: string | undefined): string {
  const normalized = value?.trim();
  const candidate = normalized && normalized.length > 0 ? normalized : defaultWalletConnectProjectId;
  if (candidate.length > 128) {
    throw new Error("VITE_WALLETCONNECT_PROJECT_ID must be 128 characters or fewer");
  }
  if (!/^[A-Za-z0-9_-]+$/.test(candidate)) {
    throw new Error("VITE_WALLETCONNECT_PROJECT_ID must contain only letters, numbers, underscore, or hyphen");
  }

  return candidate;
}
