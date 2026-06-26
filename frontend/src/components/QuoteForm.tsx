import type { FormEvent } from "react";
import type { QuoteRequest } from "@rfq-market-maker/sdk";

interface QuoteFormProps {
  request: QuoteRequest;
  isLoading: boolean;
  onChange: (request: QuoteRequest) => void;
  onSubmit: () => void;
}

export function QuoteForm({ request, isLoading, onChange, onSubmit }: QuoteFormProps) {
  function updateField<K extends keyof QuoteRequest>(key: K, value: QuoteRequest[K]) {
    onChange({
      ...request,
      [key]: value,
    });
  }

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    onSubmit();
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h2>Request Quote</h2>
      <label>
        Chain ID
        <input
          inputMode="numeric"
          value={request.chainId}
          onChange={(event) => updateField("chainId", Number(event.target.value))}
        />
      </label>
      <label>
        Token In
        <input value={request.tokenIn} onChange={(event) => updateField("tokenIn", event.target.value as `0x${string}`)} />
      </label>
      <label>
        Token Out
        <input value={request.tokenOut} onChange={(event) => updateField("tokenOut", event.target.value as `0x${string}`)} />
      </label>
      <label>
        Amount In
        <input value={request.amountIn} onChange={(event) => updateField("amountIn", event.target.value)} />
      </label>
      <label>
        Slippage Bps
        <input
          inputMode="numeric"
          value={request.slippageBps}
          onChange={(event) => updateField("slippageBps", Number(event.target.value))}
        />
      </label>
      <button type="submit" disabled={isLoading}>
        {isLoading ? "Requesting..." : "Request Quote"}
      </button>
    </form>
  );
}
