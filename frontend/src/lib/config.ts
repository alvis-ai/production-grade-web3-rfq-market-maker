import type { Address } from "@rfq-market-maker/sdk";

const defaultRFQApiBaseUrl = "http://localhost:3000";
const defaultRFQSettlementAddress = "0x0000000000000000000000000000000000000004";
const defaultWalletConnectProjectId = "00000000000000000000000000000000";

export const rfqApiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_RFQ_API_BASE_URL);
export const rfqSettlementAddress = normalizeAddress(import.meta.env.VITE_RFQ_SETTLEMENT_ADDRESS);
export const walletConnectProjectId = normalizeRequiredValue(
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
  defaultWalletConnectProjectId,
);

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

  return parsed.toString().replace(/\/+$/, "");
}

export function normalizeAddress(value: string | undefined): Address {
  const normalized = value?.trim();
  const candidate = normalized && normalized.length > 0 ? normalized : defaultRFQSettlementAddress;
  if (!/^0x[a-fA-F0-9]{40}$/.test(candidate)) {
    throw new Error("VITE_RFQ_SETTLEMENT_ADDRESS must be a 20-byte hex address");
  }

  return candidate as Address;
}

function normalizeRequiredValue(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}
