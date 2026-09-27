import type { HistoryPoint } from '../domain/telemetry';

const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:3000/api';

export interface TelemetryHistoryRequest {
  spacecraftId: string;
  metric: string;
  from: string;
  to: string;
  bucketSeconds?: 2 | 5 | 15 | 60 | 300;
  limit: number;
  signal?: AbortSignal;
}

function toHistoryPoint(value: unknown): HistoryPoint | null {
  if (typeof value !== 'object' || value === null) {
    return null;
  }
  const row = value as Record<string, unknown>;
  if (
    typeof row.timestamp !== 'string'
    || !Number.isFinite(Date.parse(row.timestamp))
    || typeof row.value !== 'number'
    || !Number.isFinite(row.value)
  ) {
    return null;
  }
  const point: HistoryPoint = { timestamp: row.timestamp, value: row.value };
  if (typeof row.min === 'number' && Number.isFinite(row.min)) {
    point.min = row.min;
  }
  if (typeof row.max === 'number' && Number.isFinite(row.max)) {
    point.max = row.max;
  }
  return point;
}

export async function fetchTelemetryHistory(
  request: TelemetryHistoryRequest,
): Promise<HistoryPoint[]> {
  const query = new URLSearchParams({
    metric: request.metric,
    from: request.from,
    to: request.to,
    limit: String(request.limit),
  });
  if (request.bucketSeconds !== undefined) {
    query.set('bucketSeconds', String(request.bucketSeconds));
  }

  const response = await fetch(
    `${API_URL}/telemetry/history/${encodeURIComponent(request.spacecraftId)}?${query.toString()}`,
    { signal: request.signal },
  );
  if (!response.ok) {
    throw new Error(`Telemetry history request failed (${response.status})`);
  }

  const body = await response.json() as unknown;
  if (typeof body !== 'object' || body === null) {
    throw new Error('Telemetry history request failed: malformed response');
  }
  const envelope = body as Record<string, unknown>;
  if (envelope.success !== true || !Array.isArray(envelope.data)) {
    throw new Error('Telemetry history request failed: malformed response');
  }
  const points = envelope.data.map(toHistoryPoint);
  if (points.some((point) => point === null)) {
    throw new Error('Telemetry history request failed: malformed response');
  }
  return points as HistoryPoint[];
}
