/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_RFQ_API_BASE_URL?: string;
  readonly VITE_RFQ_SETTLEMENT_ADDRESS?: string;
  readonly VITE_WALLETCONNECT_PROJECT_ID?: string;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
