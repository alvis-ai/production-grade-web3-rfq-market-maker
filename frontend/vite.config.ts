import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

export default defineConfig({
  plugins: [react()],
  build: {
    chunkSizeWarningLimit: 1700,
    rollupOptions: {
      output: {
        manualChunks(id) {
          if (id.includes("node_modules/react") || id.includes("node_modules/react-dom")) {
            return "react-vendor";
          }
          if (id.includes("@rainbow-me")) {
            return "wallet-rainbowkit";
          }
          if (id.includes("@walletconnect")) {
            return "walletconnect";
          }
          if (id.includes("@reown")) {
            return "reown";
          }
          if (id.includes("@metamask") || id.includes("metamask-sdk")) {
            return "metamask";
          }
          if (id.includes("@coinbase")) {
            return "coinbase-wallet";
          }
          if (
            id.includes("node_modules/wagmi") ||
            id.includes("node_modules/@wagmi") ||
            id.includes("node_modules/viem") ||
            id.includes("node_modules/ox") ||
            id.includes("node_modules/abitype")
          ) {
            return "wallet-viem";
          }
          if (id.includes("/sdk/src/")) {
            return "rfq-sdk";
          }
        },
      },
    },
  },
  server: {
    port: 5173,
  },
});
