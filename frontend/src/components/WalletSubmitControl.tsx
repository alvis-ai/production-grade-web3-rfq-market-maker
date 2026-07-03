import { useEffect } from "react";
import type { Quote, QuoteResponse } from "@rfq-market-maker/sdk";
import { buildSubmitQuoteWriteRequest } from "@rfq-market-maker/sdk";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useWriteContract } from "wagmi";
import { Web3Provider } from "../app/web3";
import { rfqSettlementAddress } from "../lib/config";
import { toUIError, type UIError } from "../lib/errors";
import {
  prepareWalletSubmit,
  walletMatchesQuote as quoteMatchesWallet,
  type WalletState,
} from "../lib/wallet-submit";
import "@rainbow-me/rainbowkit/styles.css";

interface WalletSubmitControlProps {
  quote?: QuoteResponse;
  signedQuote?: Quote;
  canSubmit: boolean;
  onWalletChange: (state: WalletState) => void;
  onTxHash: (txHash: `0x${string}`) => void;
  onError: (error: UIError) => void;
}

export default function WalletSubmitControl(props: WalletSubmitControlProps) {
  return (
    <Web3Provider>
      <WalletSubmitInner {...props} />
    </Web3Provider>
  );
}

function WalletSubmitInner({
  quote,
  signedQuote,
  canSubmit,
  onWalletChange,
  onTxHash,
  onError,
}: WalletSubmitControlProps) {
  const { address } = useAccount();
  const activeChainId = useChainId();
  const { writeContractAsync, isPending } = useWriteContract();

  useEffect(() => {
    onWalletChange({ address, chainId: activeChainId });
  }, [activeChainId, address, onWalletChange]);

  const walletState: WalletState = { address, chainId: activeChainId };
  const walletMatchesQuote = quoteMatchesWallet(signedQuote, walletState);
  const walletSubmit = prepareWalletSubmit({ quote, signedQuote, wallet: walletState });
  const canSubmitOnchain = Boolean(
    canSubmit &&
    rfqSettlementAddress &&
    walletSubmit.ok &&
    walletMatchesQuote &&
    !isPending,
  );

  async function submitQuoteOnchain() {
    if (!rfqSettlementAddress) return;

    const preparedSubmit = prepareWalletSubmit({ quote, signedQuote, wallet: walletState });
    if (!preparedSubmit.ok) {
      onError({ message: preparedSubmit.error });
      return;
    }

    try {
      const txHash = await writeContractAsync(
        buildSubmitQuoteWriteRequest({
          settlementAddress: rfqSettlementAddress,
          quote: preparedSubmit.quote,
          signature: preparedSubmit.signature,
        }),
      );
      onTxHash(txHash);
    } catch (caught) {
      onError(toUIError(caught, "Onchain submit failed"));
    }
  }

  return (
    <>
      <ConnectButton />
      <button type="button" disabled={!canSubmitOnchain} onClick={submitQuoteOnchain}>
        {isPending ? "Submitting Onchain..." : "Submit Onchain"}
      </button>
    </>
  );
}
