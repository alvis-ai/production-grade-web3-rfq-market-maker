import { Suspense, lazy, useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  Address,
  HedgeIntentStatus,
  PnlSummary,
  Quote,
  QuoteRequest,
  QuoteResponse,
  QuoteStatus,
  SettlementEventStatus,
  SubmitQuoteResponse,
} from "@rfq-market-maker/sdk";
import { QuoteForm } from "../components/QuoteForm";
import { QuoteStatusPanel } from "../components/QuoteStatusPanel";
import { useQuoteLifecyclePolling } from "../hooks/useQuoteLifecyclePolling";
import { toUIError, type UIError } from "../lib/errors";
import { rfqApiBaseUrl, rfqSettlementAddress } from "../lib/config";
import {
  loadQuoteLifecycle,
  type QuoteLifecycleSnapshot,
} from "../lib/quote-lifecycle";
import { buildQuoteFromResponse, rfqClient } from "../lib/rfq";
import { validateQuoteFormRequest } from "../lib/quote-request";
import type { WalletState } from "../lib/wallet-submit";

const WalletSubmitControl = lazy(() => import("../components/WalletSubmitControl"));

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
  const [quotedRequest, setQuotedRequest] = useState<QuoteRequest>();
  const [quote, setQuote] = useState<QuoteResponse>();
  const [quoteStatus, setQuoteStatus] = useState<QuoteStatus>();
  const [settlementStatus, setSettlementStatus] = useState<SettlementEventStatus>();
  const [hedgeStatus, setHedgeStatus] = useState<HedgeIntentStatus>();
  const [pnlSummary, setPnlSummary] = useState<PnlSummary>();
  const [submitResult, setSubmitResult] = useState<SubmitQuoteResponse>();
  const [chainTxHash, setChainTxHash] = useState<`0x${string}`>();
  const [walletState, setWalletState] = useState<WalletState>({});
  const [isWalletEnabled, setIsWalletEnabled] = useState(false);
  const [isConfirmingOnchain, setIsConfirmingOnchain] = useState(false);
  const [error, setError] = useState<UIError>();
  const [isLoading, setIsLoading] = useState(false);
  const [nowSeconds, setNowSeconds] = useState(() => Math.floor(Date.now() / 1000));
  const quoteSessionVersion = useRef(0);
  const renderedQuoteSession = quoteSessionVersion.current;

  const clearQuoteSession = useCallback(() => {
    quoteSessionVersion.current += 1;
    setQuotedRequest(undefined);
    setQuote(undefined);
    setQuoteStatus(undefined);
    setSettlementStatus(undefined);
    setHedgeStatus(undefined);
    setPnlSummary(undefined);
    setSubmitResult(undefined);
    setChainTxHash(undefined);
    setIsConfirmingOnchain(false);
    setError(undefined);
  }, []);

  const handleRequestChange = useCallback((nextRequest: QuoteRequest) => {
    setRequest(nextRequest);
    clearQuoteSession();
    setIsLoading(false);
  }, [clearQuoteSession]);

  const handleWalletChange = useCallback((nextWalletState: WalletState) => {
    setWalletState(nextWalletState);
    const walletAddress = nextWalletState.address;
    const walletChainId = nextWalletState.chainId;
    if (!walletAddress || !walletChainId) return;

    clearQuoteSession();
    setIsLoading(false);
    setRequest((current) => ({
      ...current,
      user: walletAddress as Address,
      chainId: walletChainId,
    }));
  }, [clearQuoteSession]);

  const handleOnchainError = useCallback((nextError: UIError | undefined) => {
    if (quoteSessionVersion.current !== renderedQuoteSession) return;
    setError(nextError);
  }, [renderedQuoteSession]);

  const signedQuote = useMemo<Quote | undefined>(() => {
    if (!quote || !quotedRequest) return undefined;
    return buildQuoteFromResponse(quotedRequest, quote);
  }, [quote, quotedRequest]);

  const applyQuoteLifecycle = useCallback((
    lifecycle: QuoteLifecycleSnapshot,
    expectedSession = renderedQuoteSession,
  ) => {
    if (quoteSessionVersion.current !== expectedSession) return;
    setQuoteStatus(lifecycle.quoteStatus);
    if (!lifecycle.resourceErrors?.settlement) setSettlementStatus(lifecycle.settlementStatus);
    if (!lifecycle.resourceErrors?.hedge) setHedgeStatus(lifecycle.hedgeStatus);
    if (!lifecycle.resourceErrors?.pnl) setPnlSummary(lifecycle.pnlSummary);
  }, [renderedQuoteSession]);

  const handleChainTxHash = useCallback((txHash: `0x${string}`) => {
    if (quoteSessionVersion.current !== renderedQuoteSession) return;
    setChainTxHash(txHash);
    if (!quote || !signedQuote) return;
    const quoteSession = renderedQuoteSession;
    setIsConfirmingOnchain(true);
    setError(undefined);
    void (async () => {
      try {
        const response = await rfqClient.submit({
          quote: signedQuote,
          signature: quote.signature,
          txHash,
        });
        if (quoteSessionVersion.current !== quoteSession) return;
        setSubmitResult(response);
        const lifecycle = await loadQuoteLifecycle(rfqClient, quote.quoteId, response);
        applyQuoteLifecycle(lifecycle, quoteSession);
      } catch (caught) {
        if (quoteSessionVersion.current === quoteSession) {
          setError(toUIError(caught, "Onchain confirmation failed"));
        }
      } finally {
        if (quoteSessionVersion.current === quoteSession) setIsConfirmingOnchain(false);
      }
    })();
  }, [applyQuoteLifecycle, quote, renderedQuoteSession, signedQuote]);

  useEffect(() => {
    if (!quote) return undefined;

    setNowSeconds(Math.floor(Date.now() / 1000));
    const timer = window.setInterval(() => {
      setNowSeconds(Math.floor(Date.now() / 1000));
    }, 1000);

    return () => window.clearInterval(timer);
  }, [quote]);

  const expiresInSeconds = quote ? Math.max(0, quote.deadline - nowSeconds) : undefined;
  const canSubmit = Boolean(signedQuote && quote && expiresInSeconds !== undefined && expiresInSeconds > 0);

  const loadTrackedLifecycle = useCallback(async () => {
    if (!quote) throw new Error("No active quote to track");
    return loadQuoteLifecycle(rfqClient, quote.quoteId, submitResult);
  }, [quote, submitResult]);

  const applyTrackedLifecycle = useCallback((lifecycle: QuoteLifecycleSnapshot) => {
    applyQuoteLifecycle(lifecycle, renderedQuoteSession);
  }, [applyQuoteLifecycle, renderedQuoteSession]);

  const shouldTrackLifecycle = Boolean(quote && (chainTxHash || submitResult));
  const { isPolling: isStatusPolling, pollingError } = useQuoteLifecyclePolling({
    enabled: shouldTrackLifecycle,
    load: loadTrackedLifecycle,
    onUpdate: applyTrackedLifecycle,
  });

  async function requestQuote() {
    clearQuoteSession();
    const quoteSession = quoteSessionVersion.current;
    setIsLoading(true);
    try {
      const safeRequest = validateQuoteFormRequest(request);
      const response = await rfqClient.quote(safeRequest);
      if (quoteSessionVersion.current !== quoteSession) return;
      setQuotedRequest(safeRequest);
      setQuote(response);
    } catch (caught) {
      if (quoteSessionVersion.current !== quoteSession) return;
      setQuote(undefined);
      setError(toUIError(caught, "Quote request failed"));
    } finally {
      if (quoteSessionVersion.current === quoteSession) {
        setIsLoading(false);
      }
    }
  }

  async function submitQuote() {
    if (!quote || !signedQuote) return;
    if (!canSubmit) {
      setError({ message: "Quote expired; request a new quote" });
      return;
    }

    setError(undefined);
    const quoteSession = quoteSessionVersion.current;
    try {
      const response = await rfqClient.submit({
        quote: signedQuote,
        signature: quote.signature,
      });
      if (quoteSessionVersion.current !== quoteSession) return;
      setSubmitResult(response);
      const lifecycle = await loadQuoteLifecycle(rfqClient, quote.quoteId, response);
      applyQuoteLifecycle(lifecycle, quoteSession);
    } catch (caught) {
      if (quoteSessionVersion.current === quoteSession) {
        setError(toUIError(caught, "Submit failed"));
      }
    }
  }

  async function refreshStatus() {
    if (!quote) return;
    setError(undefined);
    const quoteSession = quoteSessionVersion.current;
    try {
      const lifecycle = await loadQuoteLifecycle(rfqClient, quote.quoteId, submitResult);
      applyQuoteLifecycle(lifecycle, quoteSession);
    } catch (caught) {
      if (quoteSessionVersion.current === quoteSession) {
        setError(toUIError(caught, "Status refresh failed"));
      }
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
            <div className="status-pill">Reference</div>
            <div className="api-endpoint" title={rfqApiBaseUrl}>
              API {rfqApiBaseUrl}
            </div>
          </div>
        </header>
        <div className="workspace-grid">
          <QuoteForm request={request} isLoading={isLoading} onChange={handleRequestChange} onSubmit={requestQuote} />
          <QuoteStatusPanel
            quote={quote}
            quoteStatus={quoteStatus}
            settlementStatus={settlementStatus}
            hedgeStatus={hedgeStatus}
            pnlSummary={pnlSummary}
            submitResult={submitResult}
            error={error ?? pollingError}
            canSubmit={canSubmit}
            isStatusPolling={isStatusPolling}
            expiresInSeconds={expiresInSeconds}
            walletAddress={walletState.address}
            activeChainId={walletState.chainId}
            settlementAddress={rfqSettlementAddress}
            chainTxHash={chainTxHash}
            onSubmit={submitQuote}
            onRefresh={refreshStatus}
            onchainAction={
              isWalletEnabled ? (
                <Suspense fallback={<button type="button" disabled>Loading Wallet</button>}>
                  <WalletSubmitControl
                    quote={quote}
                    signedQuote={signedQuote}
                    canSubmit={canSubmit && !isConfirmingOnchain}
                    onWalletChange={handleWalletChange}
                    onTxHash={handleChainTxHash}
                    onError={handleOnchainError}
                  />
                </Suspense>
              ) : (
                <button type="button" onClick={() => setIsWalletEnabled(true)}>
                  Enable Wallet
                </button>
              )
            }
          />
        </div>
      </section>
    </main>
  );
}
