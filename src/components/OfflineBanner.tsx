import { OFFLINE_BANNER_HEIGHT, offlineMessage } from '../utils/offline';

/** A strip across the top while the browser is offline. Role=status so screen readers announce it. */
export function OfflineBanner({ lastUpdated }: { lastUpdated: Date | null }) {
  return (
    <div
      role="status"
      style={{
        position: 'fixed', top: 0, left: 0, right: 0, height: OFFLINE_BANNER_HEIGHT, zIndex: 2000,
        display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '0 12px',
        background: '#422006', color: '#fde68a', borderBottom: '1px solid #92400e',
        font: '600 12px/1 system-ui, -apple-system, sans-serif', textAlign: 'center', overflow: 'hidden', whiteSpace: 'nowrap', textOverflow: 'ellipsis',
      }}
    >
      <span aria-hidden style={{ marginRight: 8 }}>⚠</span>
      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{offlineMessage(lastUpdated)}</span>
    </div>
  );
}
