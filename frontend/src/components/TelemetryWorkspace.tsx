import { RefreshCw } from "lucide-react";
import { useState } from "react";
import {
  SUBSYSTEMS,
  TIME_RANGES,
  type SubsystemId,
  type TelemetryFrame,
  type TimeRangeId,
} from "../domain/telemetry";
import { useTelemetryHistory } from "../hooks/useTelemetryHistory";
import type { TelemetryConnectionStatus } from "../hooks/useTelemetrySocket";
import { TelemetryChart } from "./TelemetryChart";

export function TelemetryWorkspace({
  spacecraftId,
  selectedSubsystem,
  telemetry,
  connectionStatus,
}: {
  spacecraftId: string;
  selectedSubsystem: SubsystemId;
  telemetry: TelemetryFrame | null;
  connectionStatus: TelemetryConnectionStatus;
}) {
  const [rangeId, setRangeId] = useState<TimeRangeId>("15m");
  const history = useTelemetryHistory({
    spacecraftId,
    subsystemId: selectedSubsystem,
    rangeId,
    liveFrame: telemetry,
    connectionStatus,
  });
  const subsystemLabel =
    SUBSYSTEMS.find(({ id }) => id === selectedSubsystem)?.label ??
    selectedSubsystem;
  const rangeLabel =
    TIME_RANGES.find(({ id }) => id === rangeId)?.label ?? rangeId;
  const isEmpty =
    history.series.length > 0 &&
    history.series.every(({ points }) => points.length === 0);

  return (
    <section
      className="instrument-panel telemetry-workspace"
      aria-label="Telemetry analytics"
    >
      <div className="section-heading workspace-heading">
        <div>
          <p className="eyebrow">Selected subsystem</p>
          <h2>{subsystemLabel} telemetry</h2>
        </div>
        <span className="instrument-index">Measurements</span>
      </div>

      <div className="workspace-controls">
        <div
          className="range-controls"
          role="group"
          aria-label="Telemetry time range"
        >
          {TIME_RANGES.map((range) => (
            <button
              key={range.id}
              type="button"
              aria-pressed={rangeId === range.id}
              onClick={() => setRangeId(range.id)}
            >
              {range.label}
            </button>
          ))}
        </div>
        <p>Selected range: {rangeLabel}</p>
      </div>

      {connectionStatus !== "connected" && (
        <p
          className="workspace-notice"
          role="status"
          aria-label="Live telemetry status"
        >
          Live telemetry {connectionStatus}. Recorded history remains available.
        </p>
      )}

      {history.isLoading ? (
        <div className="chart-loading-grid" data-testid="chart-loading-grid">
          <p role="status" aria-label="Telemetry history status">
            Loading recorded telemetry…
          </p>
          {[0, 1, 2, 3].map((index) => (
            <div key={index} className="chart-skeleton" aria-hidden="true" />
          ))}
        </div>
      ) : (
        <>
          {history.hasError && !history.isStale && (
            <div
              className="workspace-notice workspace-notice--error"
              role="alert"
            >
              <span>Could not load recorded telemetry.</span>
              <button
                type="button"
                onClick={() => void history.retry()}
                aria-label="Retry history"
              >
                <RefreshCw size={14} aria-hidden="true" /> Retry
              </button>
            </div>
          )}
          {history.isStale && (
            <div
              className="workspace-notice workspace-notice--warning"
              role="status"
              aria-label="Telemetry history status"
            >
              <span>Showing retained telemetry; refresh failed.</span>
              <button
                type="button"
                onClick={() => void history.retry()}
                aria-label="Retry history"
              >
                <RefreshCw size={14} aria-hidden="true" /> Retry
              </button>
            </div>
          )}
          {!history.hasError && isEmpty && (
            <p
              className="workspace-notice"
              role="status"
              aria-label="Telemetry history status"
            >
              No telemetry has been recorded for this range.
            </p>
          )}
          {history.isFetching && !history.isLoading && !history.hasError && (
            <p
              className="refresh-status"
              role="status"
              aria-label="Telemetry history status"
            >
              Refreshing history…
            </p>
          )}
          <div className="chart-grid">
            {history.series.map(({ metric, points }) => (
              <TelemetryChart
                key={metric.key}
                metric={metric}
                points={points}
              />
            ))}
          </div>
        </>
      )}
    </section>
  );
}
