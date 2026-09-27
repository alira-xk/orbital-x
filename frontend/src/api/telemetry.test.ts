import { afterEach, describe, expect, it, vi } from 'vitest';
import { fetchTelemetryHistory } from './telemetry';

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('fetchTelemetryHistory', () => {
  it('sends an encoded raw history request and forwards cancellation', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: [{
        spacecraft_id: 'ORBITAL-X1',
        timestamp: '2026-09-10T12:00:00.000Z',
        subsystem: 'propulsion',
        metric: 'fuel_pressure',
        value: 2.45,
        unit: 'MPa',
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } }));
    vi.stubGlobal('fetch', fetchMock);
    const controller = new AbortController();

    const result = await fetchTelemetryHistory({
      spacecraftId: 'ORBITAL X1',
      metric: 'fuel_pressure',
      from: '2026-09-10T11:59:00.000Z',
      to: '2026-09-10T12:00:00.000Z',
      limit: 60,
      signal: controller.signal,
    });

    expect(fetchMock).toHaveBeenCalledWith(
      'http://localhost:3000/api/telemetry/history/ORBITAL%20X1?metric=fuel_pressure&from=2026-09-10T11%3A59%3A00.000Z&to=2026-09-10T12%3A00%3A00.000Z&limit=60',
      { signal: controller.signal },
    );
    expect(result).toEqual([{ timestamp: '2026-09-10T12:00:00.000Z', value: 2.45 }]);
  });

  it('includes aggregation and preserves a finite min/max envelope', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({
      success: true,
      data: [{
        timestamp: '2026-09-10T11:55:00.000Z',
        value: 2.45,
        min: 2.4,
        max: 2.5,
      }],
    }), { status: 200, headers: { 'Content-Type': 'application/json' } })));

    const result = await fetchTelemetryHistory({
      spacecraftId: 'ORBITAL-X1',
      metric: 'fuel_pressure',
      from: '2026-09-10T11:00:00.000Z',
      to: '2026-09-10T12:00:00.000Z',
      bucketSeconds: 300,
      limit: 288,
    });

    expect(fetch).toHaveBeenCalledWith(expect.stringContaining('bucketSeconds=300'), {
      signal: undefined,
    });
    expect(result).toEqual([{
      timestamp: '2026-09-10T11:55:00.000Z',
      value: 2.45,
      min: 2.4,
      max: 2.5,
    }]);
  });

  it.each([
    ['an HTTP failure', new Response('unavailable', { status: 503 })],
    ['a malformed success body', new Response(JSON.stringify({ success: true, data: [{}] }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    })],
  ])('rejects %s', async (_caseName, response) => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(response));

    await expect(fetchTelemetryHistory({
      spacecraftId: 'ORBITAL-X1',
      metric: 'fuel_pressure',
      from: '2026-09-10T11:00:00.000Z',
      to: '2026-09-10T12:00:00.000Z',
      limit: 100,
    })).rejects.toThrow('Telemetry history request failed');
  });
});
