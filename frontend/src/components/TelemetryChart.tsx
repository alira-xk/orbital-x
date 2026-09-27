import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { HistoryPoint, MetricDefinition } from "../domain/telemetry";

function formatValue(value: number, metric: MetricDefinition): string {
  return value.toFixed(metric.precision);
}

interface TelemetryTooltipProps {
  active?: boolean;
  label?: unknown;
  payload?: ReadonlyArray<{
    dataKey?: unknown;
    value?: unknown;
  }>;
  metric: MetricDefinition;
}

function TelemetryTooltip({
  active,
  label,
  payload,
  metric,
}: TelemetryTooltipProps) {
  const reading = payload?.find(({ dataKey }) => dataKey === "value")?.value;
  if (!active || typeof reading !== "number") {
    return null;
  }

  const timestamp = new Date(String(label));
  const timeLabel = Number.isNaN(timestamp.getTime())
    ? String(label)
    : timestamp.toISOString().slice(11, 19);

  return (
    <div
      className="telemetry-tooltip"
      data-testid="telemetry-tooltip"
      style={{ borderLeftColor: "var(--accent-blue)" }}
    >
      <time dateTime={String(label)}>{timeLabel}</time>
      <strong>
        {formatValue(reading, metric)}
        {metric.unit && <span> {metric.unit}</span>}
      </strong>
    </div>
  );
}

export function TelemetryChart({
  metric,
  points,
}: {
  metric: MetricDefinition;
  points: readonly HistoryPoint[];
}) {
  const current = points.at(-1)?.value;
  const minimum =
    points.length === 0
      ? undefined
      : Math.min(...points.map((point) => point.min ?? point.value));
  const maximum =
    points.length === 0
      ? undefined
      : Math.max(...points.map((point) => point.max ?? point.value));
  const hasEnvelope = points.some(
    ({ min, max }) => min !== undefined || max !== undefined,
  );
  const reducedMotion =
    typeof window !== "undefined" &&
    typeof window.matchMedia === "function" &&
    window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  return (
    <figure
      className="telemetry-chart"
      aria-label={`${metric.label} telemetry chart`}
    >
      <figcaption className="chart-header">
        <div>
          <p className="eyebrow">{metric.key.replaceAll("_", " ")}</p>
          <h3>{metric.label}</h3>
        </div>
        <p className="chart-current">
          {current === undefined ? "—" : formatValue(current, metric)}
          <span>{metric.unit}</span>
        </p>
      </figcaption>

      <dl className="chart-summary">
        <div>
          <dt>Minimum</dt>
          <dd>{minimum === undefined ? "—" : formatValue(minimum, metric)}</dd>
        </div>
        <div>
          <dt>Maximum</dt>
          <dd>{maximum === undefined ? "—" : formatValue(maximum, metric)}</dd>
        </div>
        <div>
          <dt>Samples</dt>
          <dd>{points.length}</dd>
        </div>
      </dl>

      <div className="chart-plot" aria-hidden="true">
        {points.length === 0 ? (
          <p className="chart-empty">No recorded telemetry</p>
        ) : (
          <ResponsiveContainer width="100%" height="100%">
            <LineChart
              data={[...points]}
              margin={{ top: 12, right: 10, bottom: 4, left: 0 }}
            >
              <CartesianGrid
                stroke="var(--border-subtle)"
                strokeDasharray="2 5"
                vertical={false}
              />
              <XAxis
                dataKey="timestamp"
                tickFormatter={(timestamp: string) =>
                  new Date(timestamp).toISOString().slice(11, 19)
                }
                stroke="var(--text-tertiary)"
                tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
                minTickGap={28}
              />
              <YAxis
                stroke="var(--text-tertiary)"
                tick={{ fill: "var(--text-tertiary)", fontSize: 10 }}
                domain={["auto", "auto"]}
                width={58}
              />
              <Tooltip
                content={(props) => (
                  <TelemetryTooltip {...props} metric={metric} />
                )}
                cursor={{
                  stroke: "var(--text-tertiary)",
                  strokeDasharray: "2 4",
                }}
              />
              {hasEnvelope && (
                <Line
                  dataKey="min"
                  stroke={"var(--accent-blue)"}
                  strokeOpacity={0.28}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
              {hasEnvelope && (
                <Line
                  dataKey="max"
                  stroke={"var(--accent-blue)"}
                  strokeOpacity={0.28}
                  dot={false}
                  isAnimationActive={false}
                />
              )}
              <Line
                type="monotone"
                dataKey="value"
                stroke={"var(--accent-blue)"}
                strokeWidth={1.8}
                dot={false}
                activeDot={{ r: 3, fill: "var(--accent-blue)" }}
                isAnimationActive={!reducedMotion}
              />
            </LineChart>
          </ResponsiveContainer>
        )}
      </div>
    </figure>
  );
}
