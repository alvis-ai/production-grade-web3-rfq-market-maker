import { RainbowKitProvider, connectorsForWallets } from "@rainbow-me/rainbowkit";
import { injectedWallet, metaMaskWallet, walletConnectWallet } from "@rainbow-me/rainbowkit/wallets";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { ReactNode } from "react";
import { WagmiProvider, createConfig, http } from "wagmi";
import { foundry, mainnet, sepolia } from "wagmi/chains";
import { walletConnectProjectId } from "../lib/config";

const queryClient = new QueryClient();

const appName = "Production RFQ Market Maker";
const chains = [mainnet, sepolia, foundry] as const;

const connectors = connectorsForWallets(
  [
    {
      groupName: "Reference Wallets",
      wallets: [injectedWallet, metaMaskWallet, walletConnectWallet],
    },
  ],
  {
    appName,
    projectId: walletConnectProjectId,
  },
);

const wagmiConfig = createConfig({
  chains,
  connectors,
  transports: {
    [mainnet.id]: http(),
    [sepolia.id]: http(),
    [foundry.id]: http(),
  },
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
