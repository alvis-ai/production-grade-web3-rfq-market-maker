import type { FormEvent } from "react";
import type { QuoteRequest } from "@rfq-market-maker/sdk";

interface QuoteFormProps {
  request: QuoteRequest;
  isLoading: boolean;
  onChange: (request: QuoteRequest) => void;
  onSubmit: () => void;
}

const maxSafeIntegerInput = Number.MAX_SAFE_INTEGER;

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

  function updateIntegerField(key: "chainId" | "slippageBps", value: string, min: number, max: number) {
    const parsed = parseIntegerInput(value, min, max);
    if (parsed === undefined) return;
    updateField(key, parsed);
  }

  return (
    <form className="panel" onSubmit={handleSubmit}>
      <h2>Request Quote</h2>
      <label>
        Chain ID
        <input
          inputMode="numeric"
          pattern="[0-9]*"
          value={request.chainId}
          onChange={(event) => updateIntegerField("chainId", event.target.value, 1, maxSafeIntegerInput)}
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
          pattern="[0-9]*"
          value={request.slippageBps}
          onChange={(event) => updateIntegerField("slippageBps", event.target.value, 0, 10_000)}
        />
      </label>
      <button type="submit" disabled={isLoading}>
        {isLoading ? "Requesting..." : "Request Quote"}
      </button>
    </form>
  );
}

export function parseIntegerInput(value: string, min: number, max: number): number | undefined {
  if (!/^[0-9]+$/.test(value)) {
    return undefined;
  }

  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) {
    return undefined;
  }

  return parsed;
}
