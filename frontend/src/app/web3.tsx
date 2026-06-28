import { RainbowKitProvider, getDefaultConfig } from "@rainbow-me/rainbowkit";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { WagmiProvider } from "wagmi";
import { foundry, mainnet, sepolia } from "wagmi/chains";
import { walletConnectProjectId } from "../lib/config";

const queryClient = new QueryClient();

const wagmiConfig = getDefaultConfig({
  appName: "Production RFQ Market Maker",
  projectId: walletConnectProjectId,
  chains: [mainnet, sepolia, foundry],
  ssr: false,
});

interface Web3ProviderProps {
  children: ReactNode;
}

export function Web3Provider({ children }: Web3ProviderProps) {
  return (
    <WagmiProvider config={wagmiConfig}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitProvider>{children}</RainbowKitProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
