import { useCallback, useEffect, useState } from "react";

/**
 * Load-on-mount plus an explicit reload. That is the entire data layer here -
 * a state machine walked one step at a time does not need a cache.
 */
export function useApi<T>(load: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<Error | null>(null);
  const [loading, setLoading] = useState(true);

  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(load, deps);

  const reload = useCallback(() => {
    let cancelled = false;
    setLoading(true);
    run()
      .then((result) => {
        if (!cancelled) {
          setData(result);
          setError(null);
        }
      })
      .catch((err) => !cancelled && setError(err as Error))
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [run]);

  useEffect(reload, [reload]);

  return { data, error, loading, reload, setData };
}
