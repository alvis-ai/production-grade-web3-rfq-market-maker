import type { Address } from "@rfq-market-maker/sdk";

const defaultRFQApiBaseUrl = "http://localhost:3000";
const defaultWalletConnectProjectId = "00000000000000000000000000000000";

export const rfqApiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_RFQ_API_BASE_URL);
export const rfqSettlementAddress = normalizeAddress(import.meta.env.VITE_RFQ_SETTLEMENT_ADDRESS);
export const walletConnectProjectId = normalizeRequiredValue(
  import.meta.env.VITE_WALLETCONNECT_PROJECT_ID,
  defaultWalletConnectProjectId,
);

export function normalizeBaseUrl(value: string | undefined): string {
  const normalized = value?.trim().replace(/\/+$/, "");
  return normalized && normalized.length > 0 ? normalized : defaultRFQApiBaseUrl;
}

export function normalizeAddress(value: string | undefined): Address | undefined {
  const normalized = value?.trim();
  return normalized && /^0x[a-fA-F0-9]{40}$/.test(normalized) ? (normalized as Address) : undefined;
}

function normalizeRequiredValue(value: string | undefined, fallback: string): string {
  const normalized = value?.trim();
  return normalized && normalized.length > 0 ? normalized : fallback;
}
