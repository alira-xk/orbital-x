import type { HistoryPoint, TelemetryFrame } from '../domain/telemetry';

const SCENE_ORBIT_RADIUS = 3.2;
type Vector3Tuple = [number, number, number];

function finiteFrameNumber(frame: TelemetryFrame | null, field: string): number {
  const value = frame?.[field];
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

export function mergeTelemetrySeries(
  history: readonly HistoryPoint[],
  liveFrame: TelemetryFrame | null,
  metric: string,
  windowStart: number,
  maxPoints: number,
): HistoryPoint[] {
  const points = new Map<string, HistoryPoint>();

  for (const point of history) {
    const time = Date.parse(point.timestamp);
    if (Number.isFinite(time) && time >= windowStart && Number.isFinite(point.value)) {
      points.set(point.timestamp, { ...point });
    }
  }

  const liveValue = liveFrame?.[metric];
  const liveTime = liveFrame === null ? Number.NaN : Date.parse(liveFrame.timestamp);
  if (
    liveFrame !== null
    && typeof liveValue === 'number'
    && Number.isFinite(liveValue)
    && Number.isFinite(liveTime)
    && liveTime >= windowStart
  ) {
    points.set(liveFrame.timestamp, { timestamp: liveFrame.timestamp, value: liveValue });
  }

  return [...points.values()]
    .sort((left, right) => Date.parse(left.timestamp) - Date.parse(right.timestamp))
    .slice(-Math.max(0, maxPoints));
}

export function normalizeNavigation(frame: TelemetryFrame | null): {
  position: Vector3Tuple;
  rawPosition: Vector3Tuple;
  velocityMagnitude: number;
} {
  const rawPosition: Vector3Tuple = [
    finiteFrameNumber(frame, 'position_x'),
    finiteFrameNumber(frame, 'position_y'),
    finiteFrameNumber(frame, 'position_z'),
  ];
  const magnitude = Math.hypot(...rawPosition);
  const position: Vector3Tuple = magnitude === 0
    ? [SCENE_ORBIT_RADIUS, 0, 0]
    : rawPosition.map((value) => (value / magnitude) * SCENE_ORBIT_RADIUS) as Vector3Tuple;
  const velocityMagnitude = Math.hypot(
    finiteFrameNumber(frame, 'velocity_x'),
    finiteFrameNumber(frame, 'velocity_y'),
    finiteFrameNumber(frame, 'velocity_z'),
  );

  return { position, rawPosition, velocityMagnitude };
}
