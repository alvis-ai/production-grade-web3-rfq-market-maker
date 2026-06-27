import { useMemo, useState } from "react";
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
import { QuoteForm } from "../components/QuoteForm";
import { QuoteStatusPanel } from "../components/QuoteStatusPanel";
import { toUIError, type UIError } from "../lib/errors";
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
  const [error, setError] = useState<UIError>();
  const [isLoading, setIsLoading] = useState(false);

  const signedQuote = useMemo<Quote | undefined>(() => {
    if (!quote) return undefined;
    return buildQuoteFromResponse(request, quote);
  }, [quote, request]);

  const canSubmit = Boolean(signedQuote && quote && quote.deadline >= Math.floor(Date.now() / 1000));

  async function requestQuote() {
    setIsLoading(true);
    setError(undefined);
    setSubmitResult(undefined);
    setQuoteStatus(undefined);
    setSettlementStatus(undefined);
    setHedgeStatus(undefined);
    setPnlSummary(undefined);
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
      if (response.settlementEventId) {
        setSettlementStatus(await rfqClient.getSettlement(response.settlementEventId));
      }
      if (response.hedgeOrderId) {
        setHedgeStatus(await rfqClient.getHedge(response.hedgeOrderId));
      }
      setPnlSummary(await rfqClient.pnl());
    } catch (caught) {
      setError(toUIError(caught, "Submit failed"));
    }
  }

  async function refreshStatus() {
    if (!quote) return;
    setError(undefined);
    try {
      const status = await rfqClient.getQuote(quote.quoteId);
      setQuoteStatus(status);
    } catch (caught) {
      setError(toUIError(caught, "Status refresh failed"));
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
          <div className="status-pill">Skeleton</div>
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
            onSubmit={submitQuote}
            onRefresh={refreshStatus}
          />
        </div>
      </section>
    </main>
  );
}
