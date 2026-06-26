export function QuoteForm() {
  return (
    <form className="panel">
      <h2>Request Quote</h2>
      <label>
        Chain ID
        <input value="1" readOnly />
      </label>
      <label>
        Token In
        <input value="0xUSDC" readOnly />
      </label>
      <label>
        Token Out
        <input value="0xWETH" readOnly />
      </label>
      <label>
        Amount In
        <input value="1000000000" readOnly />
      </label>
      <button type="button">Prepare Quote</button>
    </form>
  );
}
