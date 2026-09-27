// @vitest-environment jsdom
import type { PropsWithChildren } from 'react';
import { act, renderHook, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { TelemetryConnectionStatus } from './useTelemetrySocket';
import { useTelemetryHistory } from './useTelemetryHistory';

function jsonResponse(value: number): Response {
  return new Response(JSON.stringify({
    success: true,
    data: [{
      spacecraft_id: 'ORBITAL-X1',
      timestamp: '2026-09-10T11:59:30.000Z',
      subsystem: 'propulsion',
      metric: 'fuel_pressure',
      value,
      unit: 'MPa',
    }],
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

function createWrapper(): ({ children }: PropsWithChildren) => JSX.Element {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });
  return function Wrapper({ children }: PropsWithChildren) {
    return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('useTelemetryHistory', () => {
  it('loads the selected subsystem series and merges the matching live value', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-10T12:00:00.000Z'));
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(2.4))));

    const { result } = renderHook(() => useTelemetryHistory({
      spacecraftId: 'ORBITAL-X1',
      subsystemId: 'propulsion',
      rangeId: '1m',
      liveFrame: {
        timestamp: '2026-09-10T12:00:00.000Z',
        spacecraft_id: 'ORBITAL-X1',
        simulation_time: 1,
        scenario: 'NORMAL',
        fuel_pressure: 2.45,
      },
      connectionStatus: 'connected',
    }), { wrapper: createWrapper() });

    await waitFor(() => expect(result.current.isLoading).toBe(false));

    expect(result.current.series).toHaveLength(5);
    expect(result.current.series.find(({ metric }) => metric.key === 'fuel_pressure')?.points).toEqual([
      { timestamp: '2026-09-10T11:59:30.000Z', value: 2.4 },
      { timestamp: '2026-09-10T12:00:00.000Z', value: 2.45 },
    ]);
  });

  it('revalidates active history after the live connection recovers', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-10T12:00:00.000Z'));
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(jsonResponse(2.4)));
    vi.stubGlobal('fetch', fetchMock);
    const initialProps: { connectionStatus: TelemetryConnectionStatus } = {
      connectionStatus: 'reconnecting',
    };
    const { result, rerender } = renderHook(
      ({ connectionStatus }) => useTelemetryHistory({
        spacecraftId: 'ORBITAL-X1',
        subsystemId: 'propulsion',
        rangeId: '1m',
        liveFrame: null,
        connectionStatus,
      }),
      { wrapper: createWrapper(), initialProps },
    );
    await waitFor(() => expect(result.current.isLoading).toBe(false));
    const initialRequestCount = fetchMock.mock.calls.length;

    rerender({ connectionStatus: 'connected' });

    await waitFor(() => expect(fetchMock.mock.calls.length).toBeGreaterThan(initialRequestCount));
  });

  it('retains successful points and marks them stale when retry fails', async () => {
    vi.spyOn(Date, 'now').mockReturnValue(Date.parse('2026-09-10T12:00:00.000Z'));
    let shouldFail = false;
    vi.stubGlobal('fetch', vi.fn().mockImplementation(() => (
      shouldFail
        ? Promise.resolve(new Response('unavailable', { status: 503 }))
        : Promise.resolve(jsonResponse(2.4))
    )));
    const { result } = renderHook(() => useTelemetryHistory({
      spacecraftId: 'ORBITAL-X1',
      subsystemId: 'propulsion',
      rangeId: '1m',
      liveFrame: null,
      connectionStatus: 'connected',
    }), { wrapper: createWrapper() });
    await waitFor(() => expect(result.current.isLoading).toBe(false));

    shouldFail = true;
    await act(async () => {
      await result.current.retry();
    });

    await waitFor(() => expect(result.current.isStale).toBe(true));
    expect(result.current.series.some(({ points }) => points.length > 0)).toBe(true);
    expect(result.current.hasError).toBe(true);
  });
});
