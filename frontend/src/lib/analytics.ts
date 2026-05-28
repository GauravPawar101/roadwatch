export function trackEvent(eventName: string, data: Record<string, any> = {}) {
  try {
    const payload = { event: eventName, timestamp: Date.now(), ...data };
    const w = window as any;

    // Push to dataLayer if available
    if (w.dataLayer && typeof w.dataLayer.push === 'function') {
      w.dataLayer.push(payload);
    }

    // If an analytics endpoint is configured, send via sendBeacon (fire-and-forget)
    const analyticsUrl = (import.meta as any).env?.VITE_ANALYTICS_URL as string | undefined;
    if (analyticsUrl) {
      try {
        const body = JSON.stringify(payload);
        // Prefer sendBeacon for reliability on page unload
        if (navigator && typeof navigator.sendBeacon === 'function') {
          const blob = new Blob([body], { type: 'application/json' });
          navigator.sendBeacon(analyticsUrl, blob);
        } else {
          // Fallback to fetch
          fetch(analyticsUrl, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body }).catch(() => {});
        }
      } catch (e) {
        // ignore send errors
      }
    }

    // Dev fallback
    if (process.env.NODE_ENV !== 'production') console.log('[analytics]', payload);
  } catch (e) {
    // ignore
  }
}

export default { trackEvent };
