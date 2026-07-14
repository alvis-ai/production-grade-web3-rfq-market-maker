import { useEffect, useState } from "react";
import type { UIError } from "../lib/errors";
import { toUIError } from "../lib/errors";
import {
  pollQuoteLifecycle,
  type QuoteLifecycleSnapshot,
} from "../lib/quote-lifecycle";

interface UseQuoteLifecyclePollingOptions {
  enabled: boolean;
  load: () => Promise<QuoteLifecycleSnapshot>;
  onUpdate: (snapshot: QuoteLifecycleSnapshot) => void | Promise<void>;
}

interface QuoteLifecyclePollingState {
  isPolling: boolean;
  pollingError?: UIError;
}

export function useQuoteLifecyclePolling({
  enabled,
  load,
  onUpdate,
}: UseQuoteLifecyclePollingOptions): QuoteLifecyclePollingState {
  const [isPolling, setIsPolling] = useState(false);
  const [pollingError, setPollingError] = useState<UIError>();

  useEffect(() => {
    if (!enabled) {
      setIsPolling(false);
      setPollingError(undefined);
      return undefined;
    }

    const controller = new AbortController();
    setIsPolling(true);
    void pollQuoteLifecycle({
      load,
      onUpdate: async (snapshot) => {
        await onUpdate(snapshot);
        if (!controller.signal.aborted) setPollingError(undefined);
      },
      onError: (error) => {
        if (!controller.signal.aborted) {
          setPollingError(toUIError(error, "Status tracking failed"));
        }
      },
      signal: controller.signal,
    }).finally(() => {
      if (!controller.signal.aborted) setIsPolling(false);
    });

    return () => controller.abort();
  }, [enabled, load, onUpdate]);

  return { isPolling, pollingError };
}
