import type { QuoteResponse, QuoteStatus, SubmitQuoteResponse } from "@rfq-market-maker/sdk";
import type { UIError } from "../lib/errors";

interface QuoteStatusPanelProps {
  quote?: QuoteResponse;
  quoteStatus?: QuoteStatus;
  submitResult?: SubmitQuoteResponse;
  error?: UIError;
  canSubmit: boolean;
  onSubmit: () => void;
  onRefresh: () => void;
}

export function QuoteStatusPanel({
  quote,
  quoteStatus,
  submitResult,
  error,
  canSubmit,
  onSubmit,
  onRefresh,
}: QuoteStatusPanelProps) {
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
          <dd>{submitResult?.txHash ?? quoteStatus?.txHash ?? "-"}</dd>
        </div>
      </dl>
      {error ? (
        <div className="error-box" role="alert">
          <p>{error.message}</p>
          {error.code || error.status || error.traceId ? (
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
            </dl>
          ) : null}
        </div>
      ) : null}
      <div className="action-row">
        <button type="button" disabled={!canSubmit} onClick={onSubmit}>
          Submit Quote
        </button>
        <button type="button" className="secondary-button" disabled={!quote} onClick={onRefresh}>
          Refresh
        </button>
      </div>
    </aside>
  );
}
