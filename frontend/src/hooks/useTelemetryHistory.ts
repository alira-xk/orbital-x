import { keepPreviousData, useQueries, useQueryClient } from '@tanstack/react-query';
import { useEffect, useMemo, useRef } from 'react';
import { fetchTelemetryHistory } from '../api/telemetry';
import {
  metricsForSubsystem,
  timeRangeById,
  type HistoryPoint,
  type MetricDefinition,
  type SubsystemId,
  type TelemetryFrame,
  type TimeRangeId,
} from '../domain/telemetry';
import { mergeTelemetrySeries } from '../lib/telemetrySeries';
import type { TelemetryConnectionStatus } from './useTelemetrySocket';

export interface TelemetryMetricSeries {
  metric: MetricDefinition;
  points: HistoryPoint[];
}

export interface TelemetryHistoryState {
  series: TelemetryMetricSeries[];
  isLoading: boolean;
  isFetching: boolean;
  hasError: boolean;
  isStale: boolean;
  retry(): Promise<void>;
}

export function useTelemetryHistory({
  spacecraftId,
  subsystemId,
  rangeId,
  liveFrame,
  connectionStatus,
}: {
  spacecraftId: string;
  subsystemId: SubsystemId;
  rangeId: TimeRangeId;
  liveFrame: TelemetryFrame | null;
  connectionStatus: TelemetryConnectionStatus;
}): TelemetryHistoryState {
  const queryClient = useQueryClient();
  const previousConnection = useRef(connectionStatus);
  const metrics = useMemo(() => metricsForSubsystem(subsystemId), [subsystemId]);
  const range = timeRangeById(rangeId);
  const selectedWindow = useMemo(() => ({
    selection: `${subsystemId}:${rangeId}`,
    end: Date.now(),
  }), [rangeId, subsystemId]);
  const windowEnd = selectedWindow.end;
  const windowStart = windowEnd - range.durationMs;

  const queries = useQueries({
    queries: metrics.map((metric) => ({
      queryKey: ['telemetry-history', spacecraftId, metric.key, rangeId] as const,
      queryFn: ({ signal }: { signal: AbortSignal }) => fetchTelemetryHistory({
        spacecraftId,
        metric: metric.key,
        from: new Date(windowStart).toISOString(),
        to: new Date(windowEnd).toISOString(),
        bucketSeconds: range.bucketSeconds,
        limit: range.maxPoints,
        signal,
      }),
      placeholderData: keepPreviousData,
    })),
  });

  useEffect(() => {
    const wasConnected = previousConnection.current === 'connected';
    if (!wasConnected && connectionStatus === 'connected') {
      void queryClient.invalidateQueries({
        queryKey: ['telemetry-history', spacecraftId],
      });
    }
    previousConnection.current = connectionStatus;
  }, [connectionStatus, queryClient, spacecraftId]);

  const series = metrics.map((metric, index) => ({
    metric,
    points: mergeTelemetrySeries(
      queries[index]?.data ?? [],
      liveFrame?.spacecraft_id === spacecraftId ? liveFrame : null,
      metric.key,
      windowStart,
      range.maxPoints,
    ),
  }));
  const hasError = queries.some(({ isError }) => isError);
  const hasRetainedData = series.some(({ points }) => points.length > 0);

  return {
    series,
    isLoading: queries.some(({ isLoading }) => isLoading),
    isFetching: queries.some(({ isFetching }) => isFetching),
    hasError,
    isStale: hasError && hasRetainedData,
    retry: async () => {
      await Promise.all(queries.map(({ refetch }) => refetch()));
    },
  };
}
