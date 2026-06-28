const defaultRFQApiBaseUrl = "http://localhost:3000";

export const rfqApiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_RFQ_API_BASE_URL);

export function normalizeBaseUrl(value: string | undefined): string {
  const normalized = value?.trim().replace(/\/+$/, "");
  return normalized && normalized.length > 0 ? normalized : defaultRFQApiBaseUrl;
}
