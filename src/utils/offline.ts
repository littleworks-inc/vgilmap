/** Height of the offline banner, so layouts underneath can make room for it. */
export const OFFLINE_BANNER_HEIGHT = 30;

/** Offline wording. Never claims the data is current. */
export function offlineMessage(lastUpdated: Date | null): string {
  return lastUpdated
    ? `Offline: showing data from ${lastUpdated.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}. Alerts may have changed or ended since.`
    : 'Offline: live data can’t load. Reconnect to see current events.';
}
