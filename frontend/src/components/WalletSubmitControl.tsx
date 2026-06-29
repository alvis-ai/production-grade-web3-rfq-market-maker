import { useEffect } from "react";
import type { Address, Quote, QuoteResponse } from "@rfq-market-maker/sdk";
import { buildSubmitQuoteArgs, rfqSettlementAbi } from "@rfq-market-maker/sdk";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useWriteContract } from "wagmi";
import { Web3Provider } from "../app/web3";
import { rfqSettlementAddress } from "../lib/config";
import { toUIError, type UIError } from "../lib/errors";
import "@rainbow-me/rainbowkit/styles.css";

export interface WalletState {
  address?: Address;
  chainId?: number;
}

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

  const canSubmitOnchain = Boolean(canSubmit && signedQuote && quote && rfqSettlementAddress && address && !isPending);

  async function submitQuoteOnchain() {
    if (!quote || !signedQuote || !rfqSettlementAddress) return;

    try {
      const txHash = await writeContractAsync({
        address: rfqSettlementAddress,
        abi: rfqSettlementAbi,
        functionName: "submitQuote",
        args: buildSubmitQuoteArgs(signedQuote, quote.signature),
      });
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
