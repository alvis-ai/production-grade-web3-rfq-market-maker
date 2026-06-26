import { QuoteForm } from "../components/QuoteForm";
import { QuoteStatusPanel } from "../components/QuoteStatusPanel";

export function QuotePage() {
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
          <QuoteForm />
          <QuoteStatusPanel />
        </div>
      </section>
    </main>
  );
}
