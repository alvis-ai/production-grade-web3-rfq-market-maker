import type {
  HedgeIntentStatus,
  PnlSummary,
  QuoteResponse,
  QuoteStatus,
  SettlementEventStatus,
  SubmitQuoteResponse,
} from "@rfq-market-maker/sdk";
import type { UIError } from "../lib/errors";

interface QuoteStatusPanelProps {
  quote?: QuoteResponse;
  quoteStatus?: QuoteStatus;
  settlementStatus?: SettlementEventStatus;
  hedgeStatus?: HedgeIntentStatus;
  pnlSummary?: PnlSummary;
  submitResult?: SubmitQuoteResponse;
  error?: UIError;
  canSubmit: boolean;
  canSubmitOnchain: boolean;
  walletAddress?: string;
  activeChainId?: number;
  settlementAddress?: string;
  chainTxHash?: `0x${string}`;
  onSubmit: () => void;
  onSubmitOnchain: () => void;
  onRefresh: () => void;
}

export function QuoteStatusPanel({
  quote,
  quoteStatus,
  settlementStatus,
  hedgeStatus,
  pnlSummary,
  submitResult,
  error,
  canSubmit,
  canSubmitOnchain,
  walletAddress,
  activeChainId,
  settlementAddress,
  chainTxHash,
  onSubmit,
  onSubmitOnchain,
  onRefresh,
}: QuoteStatusPanelProps) {
  const settlementEventId = quoteStatus?.settlementEventId ?? submitResult?.settlementEventId;
  const hedgeOrderId = quoteStatus?.hedgeOrderId ?? submitResult?.hedgeOrderId;
  const pnlId = quoteStatus?.pnlId ?? submitResult?.pnlId;

  return (
    <aside className="panel">
      <h2>Quote State</h2>
      <dl className="quote-state">
        <div>
          <dt>Status</dt>
          <dd>{quoteStatus?.status ?? (quote ? "signed" : "not requested")}</dd>
        </div>
        <div>
          <dt>Quote ID</dt>
          <dd>{quote?.quoteId ?? "-"}</dd>
        </div>
        <div>
          <dt>Snapshot</dt>
          <dd>{quote?.snapshotId ?? "-"}</dd>
        </div>
        <div>
          <dt>Amount Out</dt>
          <dd>{quote?.amountOut ?? "-"}</dd>
        </div>
        <div>
          <dt>Min Amount Out</dt>
          <dd>{quote?.minAmountOut ?? "-"}</dd>
        </div>
        <div>
          <dt>Deadline</dt>
          <dd>{quote?.deadline ?? "-"}</dd>
        </div>
        <div>
          <dt>Tx Hash</dt>
          <dd>{chainTxHash ?? quoteStatus?.txHash ?? submitResult?.txHash ?? "-"}</dd>
        </div>
        <div>
          <dt>Settlement ID</dt>
          <dd>{settlementEventId ?? "-"}</dd>
        </div>
        <div>
          <dt>Settlement Status</dt>
          <dd>{settlementStatus?.status ?? "-"}</dd>
        </div>
        <div>
          <dt>Quote Hash</dt>
          <dd>{settlementStatus?.quoteHash ?? "-"}</dd>
        </div>
        <div>
          <dt>Block</dt>
          <dd>{settlementStatus?.blockNumber ?? "-"}</dd>
        </div>
        <div>
          <dt>Hedge ID</dt>
          <dd>{hedgeOrderId ?? "-"}</dd>
        </div>
        <div>
          <dt>Hedge Status</dt>
          <dd>{hedgeStatus?.status ?? "-"}</dd>
        </div>
        <div>
          <dt>PnL ID</dt>
          <dd>{pnlId ?? "-"}</dd>
        </div>
        <div>
          <dt>Realized PnL</dt>
          <dd>{pnlSummary?.grossPnlTokenOut ?? "-"}</dd>
        </div>
        <div>
          <dt>Wallet</dt>
          <dd>{walletAddress ?? "-"}</dd>
        </div>
        <div>
          <dt>Chain ID</dt>
          <dd>{activeChainId ?? "-"}</dd>
        </div>
        <div>
          <dt>Settlement</dt>
          <dd>{settlementAddress ?? "-"}</dd>
        </div>
        <div>
          <dt>Contract Call</dt>
          <dd>{quote ? "submitQuote(Quote, signature)" : "-"}</dd>
        </div>
      </dl>
      {error ? (
        <div className="error-box" role="alert">
          <p>{error.message}</p>
          {error.code || error.status || error.traceId || error.retryAfterSeconds ? (
            <dl>
              {error.code ? (
                <div>
                  <dt>Code</dt>
                  <dd>{error.code}</dd>
                </div>
              ) : null}
              {error.status ? (
                <div>
                  <dt>HTTP</dt>
                  <dd>{error.status}</dd>
                </div>
              ) : null}
              {error.traceId ? (
                <div>
                  <dt>Trace</dt>
                  <dd>{error.traceId}</dd>
                </div>
              ) : null}
              {error.retryAfterSeconds ? (
                <div>
                  <dt>Retry After</dt>
                  <dd>{error.retryAfterSeconds}s</dd>
                </div>
              ) : null}
            </dl>
          ) : null}
        </div>
      ) : null}
      <div className="action-row">
        <button type="button" disabled={!canSubmit} onClick={onSubmit}>
          Submit API
        </button>
        <button type="button" disabled={!canSubmitOnchain} onClick={onSubmitOnchain}>
          Submit Onchain
        </button>
        <button type="button" className="secondary-button" disabled={!quote} onClick={onRefresh}>
          Refresh
        </button>
      </div>
    </aside>
  );
}
