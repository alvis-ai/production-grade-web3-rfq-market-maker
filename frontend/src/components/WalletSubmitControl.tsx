import { useEffect, useState } from "react";
import type { Quote, QuoteResponse } from "@rfq-market-maker/sdk";
import { buildErc20AllowanceReadRequest, buildErc20ApprovalWriteRequest, buildSubmitQuoteWriteRequest } from "@rfq-market-maker/sdk";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, usePublicClient, useReadContract, useWriteContract } from "wagmi";
import { Web3Provider } from "../app/web3";
import { rfqSettlementAddress } from "../lib/config";
import { toUIError, type UIError } from "../lib/errors";
import {
  prepareWalletSubmit,
  walletMatchesQuote as quoteMatchesWallet,
  type WalletState,
} from "../lib/wallet-submit";
import "@rainbow-me/rainbowkit/styles.css";

const zeroAddress = "0x0000000000000000000000000000000000000000" as const;

interface WalletSubmitControlProps {
  quote?: QuoteResponse;
  signedQuote?: Quote;
  canSubmit: boolean;
  onWalletChange: (state: WalletState) => void;
  onTxHash: (txHash: `0x${string}`) => void;
  onError: (error: UIError | undefined) => void;
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
  const walletState: WalletState = { address, chainId: activeChainId };
  const walletMatchesQuote = quoteMatchesWallet(signedQuote, walletState);
  const walletSubmit = prepareWalletSubmit({ quote, signedQuote, wallet: walletState });
  const { writeContractAsync, isPending } = useWriteContract();
  const publicClient = usePublicClient({
    chainId: walletSubmit.ok ? walletSubmit.quote.chainId : activeChainId,
  });
  const [isApprovalFlowPending, setIsApprovalFlowPending] = useState(false);

  useEffect(() => {
    onWalletChange({ address, chainId: activeChainId });
  }, [activeChainId, address, onWalletChange]);

  const allowanceReadRequest = buildErc20AllowanceReadRequest({
    token: walletSubmit.ok ? walletSubmit.quote.tokenIn : zeroAddress,
    owner: walletSubmit.ok ? walletSubmit.quote.user : zeroAddress,
    spender: rfqSettlementAddress ?? zeroAddress,
  });
  const allowanceQuery = useReadContract({
    ...allowanceReadRequest,
    chainId: walletSubmit.ok ? walletSubmit.quote.chainId : activeChainId,
    query: {
      enabled: Boolean(rfqSettlementAddress && walletSubmit.ok && walletMatchesQuote),
    },
  });
  const allowanceStatus = resolveAllowanceStatus(
    Boolean(rfqSettlementAddress && walletSubmit.ok && walletMatchesQuote),
    allowanceQuery.data,
    allowanceQuery.isLoading,
    allowanceQuery.isError,
    walletSubmit.ok ? walletSubmit.quote.amountIn : undefined,
  );
  const actionPending = isPending || isApprovalFlowPending;
  const canSubmitOnchain = Boolean(
    canSubmit &&
    rfqSettlementAddress &&
    walletSubmit.ok &&
    walletMatchesQuote &&
    allowanceStatus === "sufficient" &&
    !actionPending,
  );
  const canApprove = Boolean(
    canSubmit &&
    rfqSettlementAddress &&
    walletSubmit.ok &&
    walletMatchesQuote &&
    allowanceStatus === "insufficient" &&
    !actionPending,
  );
  const canRetryAllowance = Boolean(
    canSubmit &&
    rfqSettlementAddress &&
    walletSubmit.ok &&
    walletMatchesQuote &&
    allowanceStatus === "error" &&
    !actionPending,
  );

  async function submitQuoteOnchain() {
    if (!rfqSettlementAddress) return;
    if (!canSubmit) {
      onError({ message: "Quote expired; request a new quote" });
      return;
    }

    const preparedSubmit = prepareWalletSubmit({ quote, signedQuote, wallet: walletState });
    if (!preparedSubmit.ok) {
      onError({ message: preparedSubmit.error });
      return;
    }
    if (allowanceStatus !== "sufficient") {
      onError({ message: "Approve token allowance before submitting onchain" });
      return;
    }

    onError(undefined);
    try {
      const txHash = await writeContractAsync({
        ...buildSubmitQuoteWriteRequest({
          settlementAddress: rfqSettlementAddress,
          quote: preparedSubmit.quote,
          signature: preparedSubmit.signature,
        }),
        chainId: preparedSubmit.quote.chainId,
      });
      onTxHash(txHash);
    } catch (caught) {
      onError(toUIError(caught, "Onchain submit failed"));
    }
  }

  async function approveToken() {
    if (!rfqSettlementAddress) return;
    if (!canSubmit) {
      onError({ message: "Quote expired; request a new quote" });
      return;
    }
    const preparedSubmit = prepareWalletSubmit({ quote, signedQuote, wallet: walletState });
    if (!preparedSubmit.ok) {
      onError({ message: preparedSubmit.error });
      return;
    }
    if (!publicClient) {
      onError({ message: "Wallet RPC client is unavailable" });
      return;
    }

    onError(undefined);
    setIsApprovalFlowPending(true);
    try {
      assertQuoteActive(preparedSubmit.quote.deadline);
      const requiredAllowance = BigInt(preparedSubmit.quote.amountIn);
      const refreshed = await allowanceQuery.refetch();
      const currentAllowance = parseAllowance(refreshed.data);
      if (currentAllowance >= requiredAllowance) return;

      if (currentAllowance > 0n) {
        const resetHash = await writeContractAsync({
          ...buildErc20ApprovalWriteRequest({
            token: preparedSubmit.quote.tokenIn,
            spender: rfqSettlementAddress,
            amount: 0n,
          }),
          chainId: preparedSubmit.quote.chainId,
        });
        await waitForSuccessfulApproval(publicClient, resetHash);
        assertQuoteActive(preparedSubmit.quote.deadline);
      }

      const approvalHash = await writeContractAsync({
        ...buildErc20ApprovalWriteRequest({
          token: preparedSubmit.quote.tokenIn,
          spender: rfqSettlementAddress,
          amount: preparedSubmit.quote.amountIn,
        }),
        chainId: preparedSubmit.quote.chainId,
      });
      await waitForSuccessfulApproval(publicClient, approvalHash);
      const confirmed = await allowanceQuery.refetch();
      if (parseAllowance(confirmed.data) < requiredAllowance) {
        throw new Error("Token allowance did not reach the required amount");
      }
    } catch (caught) {
      onError(toUIError(caught, "Token approval failed"));
    } finally {
      setIsApprovalFlowPending(false);
    }
  }

  async function retryAllowance() {
    if (!canSubmit) {
      onError({ message: "Quote expired; request a new quote" });
      return;
    }
    onError(undefined);
    try {
      await allowanceQuery.refetch();
    } catch (caught) {
      onError(toUIError(caught, "Token allowance check failed"));
    }
  }

  const action = walletSubmit.ok && walletMatchesQuote
    ? walletAction(allowanceStatus, actionPending)
    : { label: "Submit Onchain", kind: "submit" as const };
  const actionDisabled = action.kind === "approve"
    ? !canApprove
    : action.kind === "retry"
      ? !canRetryAllowance
      : !canSubmitOnchain;
  const onAction = action.kind === "approve"
    ? approveToken
    : action.kind === "retry"
      ? retryAllowance
      : submitQuoteOnchain;

  return (
    <>
      <ConnectButton />
      <button type="button" disabled={actionDisabled} onClick={onAction}>
        {action.label}
      </button>
    </>
  );
}

type AllowanceStatus = "not_applicable" | "loading" | "error" | "insufficient" | "sufficient";

function resolveAllowanceStatus(
  applicable: boolean,
  allowance: unknown,
  isLoading: boolean,
  isError: boolean,
  amountIn: string | undefined,
): AllowanceStatus {
  if (!applicable) return "not_applicable";
  if (isLoading) return "loading";
  if (isError || typeof allowance !== "bigint" || allowance < 0n ||
      typeof amountIn !== "string" || !/^[1-9][0-9]*$/.test(amountIn)) return "error";
  return allowance >= BigInt(amountIn) ? "sufficient" : "insufficient";
}

function walletAction(status: AllowanceStatus, pending: boolean): {
  label: string;
  kind: "approve" | "retry" | "submit";
} {
  if (status === "loading") return { label: "Checking Allowance...", kind: "retry" };
  if (status === "error") return { label: "Retry Allowance", kind: "retry" };
  if (status === "insufficient") {
    return { label: pending ? "Approving Token..." : "Approve Token", kind: "approve" };
  }
  return { label: pending ? "Submitting Onchain..." : "Submit Onchain", kind: "submit" };
}

function parseAllowance(value: unknown): bigint {
  if (typeof value !== "bigint" || value < 0n) throw new Error("Token allowance response is invalid");
  return value;
}

function assertQuoteActive(deadline: number): void {
  if (!Number.isSafeInteger(deadline) || deadline <= Math.floor(Date.now() / 1_000)) {
    throw new Error("Quote expired; request a new quote");
  }
}

async function waitForSuccessfulApproval(
  publicClient: { waitForTransactionReceipt(input: { hash: `0x${string}` }): Promise<unknown> },
  hash: `0x${string}`,
): Promise<void> {
  const receipt = await publicClient.waitForTransactionReceipt({ hash });
  if (typeof receipt !== "object" || receipt === null || Array.isArray(receipt) ||
      !Object.prototype.hasOwnProperty.call(receipt, "status") ||
      (receipt as { status?: unknown }).status !== "success") {
    throw new Error("Token approval transaction reverted");
  }
}
