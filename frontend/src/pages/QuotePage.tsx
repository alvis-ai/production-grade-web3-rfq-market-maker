import { useEffect, useMemo, useState } from "react";
import type {
  HedgeIntentStatus,
  PnlSummary,
  Quote,
  QuoteRequest,
  QuoteResponse,
  QuoteStatus,
  SettlementEventStatus,
  SubmitQuoteResponse,
} from "@rfq-market-maker/sdk";
import { buildSubmitQuoteArgs, rfqSettlementAbi } from "@rfq-market-maker/sdk";
import { ConnectButton } from "@rainbow-me/rainbowkit";
import { useAccount, useChainId, useWriteContract } from "wagmi";
import { QuoteForm } from "../components/QuoteForm";
import { QuoteStatusPanel } from "../components/QuoteStatusPanel";
import { toUIError, type UIError } from "../lib/errors";
import { rfqApiBaseUrl, rfqSettlementAddress } from "../lib/config";
import { buildQuoteFromResponse, rfqClient } from "../lib/rfq";

const defaultRequest: QuoteRequest = {
  chainId: 1,
  user: "0x0000000000000000000000000000000000000001",
  tokenIn: "0x0000000000000000000000000000000000000002",
  tokenOut: "0x0000000000000000000000000000000000000003",
  amountIn: "1000000000",
  slippageBps: 50,
};

export function QuotePage() {
  const [request, setRequest] = useState<QuoteRequest>(defaultRequest);
  const [quote, setQuote] = useState<QuoteResponse>();
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>();
  const [settlementStatus, setSettlementStatus] = useState<SettlementEventStatus>();
  const [hedgeStatus, setHedgeStatus] = useState<HedgeIntentStatus>();
  const [pnlSummary, setPnlSummary] = useState<PnlSummary>();
  const [submitResult, setSubmitResult] = useState<SubmitQuoteResponse>();
  const [chainTxHash, setChainTxHash] = useState<`0x${string}`>();
  const [error, setError] = useState<UIError>();
  const [isLoading, setIsLoading] = useState(false);
  const { address } = useAccount();
  const activeChainId = useChainId();
  const { writeContractAsync, isPending: isOnchainSubmitPending } = useWriteContract();

  useEffect(() => {
    if (!address) return;

    setRequest((current) => ({
      ...current,
      user: address,
      chainId: activeChainId,
    }));
  }, [activeChainId, address]);

  const signedQuote = useMemo<Quote | undefined>(() => {
    if (!quote) return undefined;
    return buildQuoteFromResponse(request, quote);
  }, [quote, request]);

  const canSubmit = Boolean(signedQuote && quote && quote.deadline >= Math.floor(Date.now() / 1000));
  const canSubmitOnchain = Boolean(canSubmit && rfqSettlementAddress && address);

  async function requestQuote() {
    setIsLoading(true);
    setError(undefined);
    setSubmitResult(undefined);
    setQuoteStatus(undefined);
    setSettlementStatus(undefined);
    setHedgeStatus(undefined);
    setPnlSummary(undefined);
    setChainTxHash(undefined);
    try {
      const response = await rfqClient.quote(request);
      setQuote(response);
    } catch (caught) {
      setQuote(undefined);
      setError(toUIError(caught, "Quote request failed"));
    } finally {
      setIsLoading(false);
    }
  }

  async function submitQuote() {
    if (!quote || !signedQuote) return;
    setError(undefined);
    try {
      const response = await rfqClient.submit({
        quote: signedQuote,
        signature: quote.signature,
      });
      setSubmitResult(response);
      const status = await rfqClient.getQuote(quote.quoteId);
      setQuoteStatus(status);
      await loadPostTradeSurfaces(status, response);
    } catch (caught) {
      setError(toUIError(caught, "Submit failed"));
    }
  }

  async function submitQuoteOnchain() {
    if (!quote || !signedQuote || !rfqSettlementAddress) return;

    setError(undefined);
    try {
      const txHash = await writeContractAsync({
        address: rfqSettlementAddress,
        abi: rfqSettlementAbi,
        functionName: "submitQuote",
        args: buildSubmitQuoteArgs(signedQuote, quote.signature),
      });
      setChainTxHash(txHash);
    } catch (caught) {
      setError(toUIError(caught, "Onchain submit failed"));
    }
  }

  async function refreshStatus() {
    if (!quote) return;
    setError(undefined);
    try {
      const status = await rfqClient.getQuote(quote.quoteId);
      setQuoteStatus(status);
      await loadPostTradeSurfaces(status, submitResult);
    } catch (caught) {
      setError(toUIError(caught, "Status refresh failed"));
    }
  }

  async function loadPostTradeSurfaces(status: QuoteStatus, fallback?: SubmitQuoteResponse) {
    const settlementEventId = status.settlementEventId ?? fallback?.settlementEventId;
    const hedgeOrderId = status.hedgeOrderId ?? fallback?.hedgeOrderId;
    const pnlId = status.pnlId ?? fallback?.pnlId;

    if (settlementEventId) {
      setSettlementStatus(await rfqClient.getSettlement(settlementEventId));
    } else {
      setSettlementStatus(undefined);
    }

    if (hedgeOrderId) {
      setHedgeStatus(await rfqClient.getHedge(hedgeOrderId));
    } else {
      setHedgeStatus(undefined);
    }

    if (pnlId) {
      setPnlSummary(await rfqClient.pnl());
    } else {
      setPnlSummary(undefined);
    }
  }

  return (
    <main className="app-shell">
      <section className="trade-workspace" aria-label="RFQ trading workspace">
        <header className="workspace-header">
          <div>
            <p className="eyebrow">RFQ / Prop AMM</p>
            <h1>Production RFQ Trading Console</h1>
          </div>
          <div className="header-status">
            <ConnectButton />
            <div className="status-pill">Reference</div>
            <div className="api-endpoint" title={rfqApiBaseUrl}>
              API {rfqApiBaseUrl}
            </div>
          </div>
        </header>
        <div className="workspace-grid">
          <QuoteForm request={request} isLoading={isLoading} onChange={setRequest} onSubmit={requestQuote} />
          <QuoteStatusPanel
            quote={quote}
            quoteStatus={quoteStatus}
            settlementStatus={settlementStatus}
            hedgeStatus={hedgeStatus}
            pnlSummary={pnlSummary}
            submitResult={submitResult}
            error={error}
            canSubmit={canSubmit}
            canSubmitOnchain={canSubmitOnchain && !isOnchainSubmitPending}
            walletAddress={address}
            activeChainId={activeChainId}
            settlementAddress={rfqSettlementAddress}
            chainTxHash={chainTxHash}
            onSubmit={submitQuote}
            onSubmitOnchain={submitQuoteOnchain}
            onRefresh={refreshStatus}
          />
        </div>
      </section>
    </main>
  );
}
