/**
 * Registers the app-shell service worker (public/sw.js).
 * Production only: in development a worker would serve stale files and fight hot reload.
 * Failure is silent on purpose: the app works the same without it.
 */
export function registerServiceWorker(): void {
  if (!import.meta.env.PROD || !('serviceWorker' in navigator)) return;
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(() => { /* private mode, blocked storage, old browser */ });
  });
}
