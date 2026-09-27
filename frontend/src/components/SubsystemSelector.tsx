import type { SubsystemId, TelemetryFrame } from '../domain/telemetry';
import { metricsForSubsystem, SUBSYSTEMS } from '../domain/telemetry';

function currentSummary(subsystem: SubsystemId, telemetry: TelemetryFrame | null): string {
  const metric = metricsForSubsystem(subsystem)[0];
  const value = telemetry?.[metric.key];
  if (typeof value !== 'number' || !Number.isFinite(value)) return 'No data';
  return `${value.toFixed(metric.precision)} ${metric.unit}`;
}

export function SubsystemSelector({
  selected,
  onSelect,
  telemetry,
}: {
  selected: SubsystemId;
  onSelect(subsystem: SubsystemId): void;
  telemetry: TelemetryFrame | null;
}) {
  return (
    <div className="subsystem-strip" role="group" aria-label="Spacecraft subsystems">
      {SUBSYSTEMS.map((subsystem) => (
        <button
          key={subsystem.id}
          type="button"
          className="subsystem-control"
          aria-pressed={selected === subsystem.id}
          onClick={() => onSelect(subsystem.id)}
          style={{ '--subsystem-color': subsystem.color } as React.CSSProperties}
        >
          <span className="subsystem-code">{subsystem.shortLabel}</span>
          <span className="subsystem-name">{subsystem.label}</span>
          <span className="subsystem-reading">{currentSummary(subsystem.id, telemetry)}</span>
        </button>
      ))}
    </div>
  );
}
