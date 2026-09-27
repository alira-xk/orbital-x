import { Radio, Satellite } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { TelemetryFrame } from '../domain/telemetry';
import type { TelemetryConnectionStatus } from '../hooks/useTelemetrySocket';

const connectionLabels: Record<TelemetryConnectionStatus, string> = {
  connecting: 'Connecting',
  connected: 'Connected',
  reconnecting: 'Reconnecting',
  disconnected: 'Disconnected',
};

function frameAge(timestamp: string | undefined, now: number): string {
  if (timestamp === undefined) return 'Awaiting frame';
  const ageSeconds = Math.max(0, Math.floor((now - Date.parse(timestamp)) / 1000));
  if (!Number.isFinite(ageSeconds)) return 'Unknown frame age';
  return ageSeconds < 60 ? `${ageSeconds}s old` : `${Math.floor(ageSeconds / 60)}m old`;
}

export function MissionHeader({
  telemetry,
  connectionStatus,
}: {
  telemetry: TelemetryFrame | null;
  connectionStatus: TelemetryConnectionStatus;
}) {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, []);

  const connectionLabel = connectionLabels[connectionStatus];

  return (
    <header className="mission-header">
      <div className="mission-brand">
        <span className="mission-mark" aria-hidden="true"><Radio size={17} /></span>
        <div>
          <p className="eyebrow">ORBITAL-X / Mission control</p>
          <div className="mission-identity">
            <Satellite size={16} aria-hidden="true" />
            <h1>ORBITAL-X1</h1>
          </div>
        </div>
      </div>
      <dl className="mission-meta">
        <div>
          <dt>UTC</dt>
          <dd>{new Date(now).toISOString().slice(11, 19)}</dd>
        </div>
        <div>
          <dt>Frame</dt>
          <dd>{frameAge(telemetry?.timestamp, now)}</dd>
        </div>
        <div>
          <dt>Scenario</dt>
          <dd>{telemetry?.scenario ?? 'Standby'}</dd>
        </div>
      </dl>
      <div
        className={`connection-state connection-state--${connectionStatus}`}
        role="status"
        aria-label="Telemetry connection"
        aria-live="polite"
      >
        <span className="status-dot" aria-hidden="true" />
        {connectionLabel}
      </div>
    </header>
  );
}
