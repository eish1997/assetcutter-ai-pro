import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';
import { fetchScriptConnectors, type ScriptConnectorsResponse } from '../services/companionScriptConnectors';
import { getCompanionLocalToken, setCompanionLocalToken } from '../../../services/companionLocalPrefs';
import { useScriptHubPrefs } from '../context/ScriptHubPrefsContext';

export function CompanionStatusBar() {
  const { mayaHost, mayaPort, setMayaEndpoint, ready: prefsReady } = useScriptHubPrefs();
  const [connectors, setConnectors] = useState<ScriptConnectorsResponse | null>(null);
  const [connectorsErr, setConnectorsErr] = useState<string | null>(null);
  const [tokenDraft, setTokenDraft] = useState('');
  const [showTokenFix, setShowTokenFix] = useState(false);

  const loadConnectors = useCallback(
    async (bust?: boolean) => {
      try {
        const snap = await fetchScriptConnectors({ mayaHost, mayaPort, bustCache: bust });
        setConnectors(snap);
        setConnectorsErr(null);
        setShowTokenFix(false);
      } catch (e) {
        const msg = e instanceof Error ? e.message : String(e);
        setConnectors(null);
        setConnectorsErr(msg);
        setShowTokenFix(msg.includes('bearer') || msg.includes('401'));
      }
    },
    [mayaHost, mayaPort],
  );

  useEffect(() => {
    if (!prefsReady) return;
    setTokenDraft(getCompanionLocalToken());
    void loadConnectors(false);
    const id = window.setInterval(() => void loadConnectors(false), 10_000);
    return () => window.clearInterval(id);
  }, [loadConnectors, prefsReady]);

  const mayaConnector = connectors?.connectors.find((c) => c.id === 'maya.command_port@v1');

  return (
    <section className="sh-panel sh-panel-tight" style={{ marginBottom: '1rem' }} aria-label="本机环境">
      <BarRow>
        <span className="sh-muted" style={{ fontSize: '0.8rem' }}>
          本机环境
        </span>
        {connectors ? (
          <span className="sh-muted" style={{ fontSize: '0.75rem' }}>
            探测 {new Date(connectors.probedAt).toLocaleTimeString()}
          </span>
        ) : null}
        <button
          type="button"
          className="sh-btn"
          style={{ fontSize: '0.75rem', padding: '0.2rem 0.5rem', marginLeft: 'auto' }}
          onClick={() => void loadConnectors(true)}
        >
          重探测
        </button>
      </BarRow>

      {connectorsErr ? (
        <p className="sh-alert" style={{ margin: '0.5rem 0 0', fontSize: '0.85rem' }} role="status">
          伴侣：{connectorsErr}
        </p>
      ) : null}

      {showTokenFix ? (
        <BarRow style={{ marginTop: '0.5rem' }}>
          <input
            className="sh-input sh-mono"
            type="password"
            style={{ flex: '1 1 12rem', minWidth: 0 }}
            value={tokenDraft}
            onChange={(e) => setTokenDraft(e.target.value)}
            placeholder="通信密码（与伴侣配对一致）"
          />
          <button
            type="button"
            className="sh-btn"
            onClick={() => {
              setCompanionLocalToken(tokenDraft);
              void loadConnectors(true);
            }}
          >
            保存并重试
          </button>
        </BarRow>
      ) : null}

      <ul style={{ margin: '0.5rem 0 0', padding: 0, listStyle: 'none', display: 'flex', flexWrap: 'wrap', gap: '0.75rem 1.25rem' }}>
        <li>
          <StatusPill
            label="伴侣"
            status={connectorsErr ? 'error' : connectors ? 'ok' : 'pending'}
            detail={connectorsErr ? '不可达' : '18765'}
          />
        </li>
        <li>
          <StatusPill
            label="Maya"
            status={
              mayaConnector?.status === 'ok'
                ? 'ok'
                : mayaConnector?.status === 'occupied'
                  ? 'occupied'
                  : mayaConnector?.status === 'skipped'
                    ? 'skipped'
                    : mayaConnector
                      ? 'error'
                      : 'pending'
            }
            detail={`${mayaHost}:${mayaPort}`}
            title={mayaConnector?.message}
          />
        </li>
        <li className="sh-muted" style={{ fontSize: '0.8rem', display: 'flex', alignItems: 'center', gap: 6 }}>
          <label>
            Host
            <input
              className="sh-input sh-mono"
              style={{ width: '6.5rem', marginLeft: 4, padding: '0.15rem 0.35rem', fontSize: '0.8rem' }}
              value={mayaHost}
              onChange={(e) => setMayaEndpoint(e.target.value, mayaPort)}
            />
          </label>
          <label>
            Port
            <input
              className="sh-input sh-mono"
              type="number"
              style={{ width: '4.5rem', marginLeft: 4, padding: '0.15rem 0.35rem', fontSize: '0.8rem' }}
              value={mayaPort}
              onChange={(e) => setMayaEndpoint(mayaHost, Number.parseInt(e.target.value, 10) || 7001)}
            />
          </label>
        </li>
      </ul>
      {mayaConnector && mayaConnector.status !== 'ok' ? (
        <p className="sh-muted" style={{ margin: '0.35rem 0 0', fontSize: '0.8rem' }}>
          {mayaConnector.message}
        </p>
      ) : null}
    </section>
  );
}

function BarRow({ children, style }: { children: ReactNode; style?: CSSProperties }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', flexWrap: 'wrap', ...style }}>
      {children}
    </div>
  );
}

function StatusPill({
  label,
  status,
  detail,
  title,
}: {
  label: string;
  status: 'ok' | 'error' | 'skipped' | 'occupied' | 'pending';
  detail: string;
  title?: string;
}) {
  const color =
    status === 'ok'
      ? '#4ade80'
      : status === 'occupied'
        ? '#fbbf24'
        : status === 'skipped'
          ? '#9ca3af'
          : status === 'pending'
            ? '#94a3b8'
            : '#f87171';
  const text =
    status === 'ok'
      ? 'OK'
      : status === 'occupied'
        ? '忙'
        : status === 'skipped'
          ? '—'
          : status === 'pending'
            ? '…'
            : 'ERR';
  return (
    <span title={title} style={{ fontSize: '0.85rem', color: '#d1d5db' }}>
      <span style={{ fontWeight: 700, color, marginRight: 6 }}>{text}</span>
      {label}
      <span className="sh-mono sh-muted" style={{ marginLeft: 6 }}>
        {detail}
      </span>
    </span>
  );
}
