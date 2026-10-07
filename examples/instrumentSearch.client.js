// Browser helper for the future React UI.
// This is not mounted/served by Express. To be imported when building the dropdown.
export function createInstrumentSearchClient({
  onResults,
  onError,
  onLoading = () => { },
  fetchSearch = globalThis.fetch,
  endpoint = '/api/instruments/search',
  delayMs = 300
}) {
  let timer;
  let controller;
  let sequence = 0;
  let retryAt = 0;
  let disposed = false;

  function update(input, mode = 'symbol') {
    if (disposed) return;
    const current = ++sequence;
    clearTimeout(timer);
    controller?.abort();
    onResults([]); // Never leave selectable suggestions for the previous input.
    onLoading(false);
    const q = input.trim();
    if (!q) return;

    timer = setTimeout(async () => {
      if (current !== sequence || disposed) return;
      const remaining = Math.ceil((retryAt - Date.now()) / 1000);
      if (remaining > 0) {
        onError({ message: 'Search is temporarily paused. Try again shortly.', retryAfter: remaining });
        return;
      }
      controller = new AbortController();
      onLoading(true);
      try {
        const params = new URLSearchParams({ q, mode, limit: '10' });
        const response = await fetchSearch(`${endpoint}?${params}`, { signal: controller.signal });
        // A sequence check is needed even when fetch ignores or races with abort.
        if (current !== sequence || disposed) return;
        if (!response.ok) {
          const value = response.headers.get('Retry-After');
          const seconds = /^\d+$/.test(value ?? '') ? Number(value) : 0;
          if ([429, 503].includes(response.status) && Number.isSafeInteger(seconds * 1000) && seconds > 0) {
            retryAt = Math.max(retryAt, Date.now() + seconds * 1000);
          }
          onError({
            message: 'Instrument search failed. Please try again later.',
            status: response.status, retryAfter: Math.max(0, Math.ceil((retryAt - Date.now()) / 1000))
          });
          return;
        }
        const body = await response.json();
        if (current !== sequence || disposed) return;
        if (body.success !== true || !Array.isArray(body.data?.results)) {
          throw new Error('Invalid search response');
        }
        onResults(body.data.results);
      } catch (error) {
        if (current === sequence && !disposed && error.name !== 'AbortError') {
          onError({ message: 'Unable to load instrument suggestions. Please try again.' });
        }
      } finally {
        if (current === sequence && !disposed) onLoading(false);
      }
    }, delayMs);
  }

  function dispose() {
    disposed = true;
    sequence++;
    clearTimeout(timer);
    controller?.abort();
  }

  return { update, dispose };
}
