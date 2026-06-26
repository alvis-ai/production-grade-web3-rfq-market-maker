export function QuoteStatusPanel() {
  return (
    <aside className="panel">
      <h2>Quote State</h2>
      <dl className="quote-state">
        <div>
          <dt>Status</dt>
          <dd>Not requested</dd>
        </div>
        <div>
          <dt>Invariant</dt>
          <dd>Risk before signing</dd>
        </div>
        <div>
          <dt>Settlement</dt>
          <dd>EIP-712 verification</dd>
        </div>
      </dl>
    </aside>
  );
}
