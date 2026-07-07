import { useEffect, useMemo, useState } from 'react';
import type { AiBillingRouteStep } from '../services/aiBillingGate';
import { sumPlatformMinCreditsWithQuote } from '../services/aiBillingGate';
import { platformJobKindsFromSteps } from '../services/usageQuoteGate';
import { fetchUsageQuote, type UsageQuoteResponse } from '../services/usageApi';

export function useUsageQuoteForSteps(steps: AiBillingRouteStep[]) {
  const jobKinds = useMemo(() => platformJobKindsFromSteps(steps), [steps]);
  const jobKindsKey = jobKinds.join(',');
  const [quote, setQuote] = useState<UsageQuoteResponse | null>(null);
  const [quoteLoading, setQuoteLoading] = useState(false);

  useEffect(() => {
    if (!jobKindsKey) {
      setQuote(null);
      setQuoteLoading(false);
      return;
    }
    let cancelled = false;
    setQuoteLoading(true);
    void fetchUsageQuote(jobKinds)
      .then((res) => {
        if (!cancelled) setQuote(res);
      })
      .catch(() => {
        if (!cancelled) setQuote(null);
      })
      .finally(() => {
        if (!cancelled) setQuoteLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [jobKindsKey, jobKinds]);

  const serverMinCredits = useMemo(() => {
    if (!quote) return null;
    return sumPlatformMinCreditsWithQuote(steps, quote);
  }, [quote, steps]);

  return { quote, quoteLoading, serverMinCredits };
}
