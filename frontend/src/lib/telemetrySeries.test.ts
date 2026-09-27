import { describe, expect, it } from 'vitest';
import type { HistoryPoint, TelemetryFrame } from '../domain/telemetry';
import { mergeTelemetrySeries, normalizeNavigation } from './telemetrySeries';

describe('mergeTelemetrySeries', () => {
  const history: HistoryPoint[] = [
    { timestamp: '2026-09-10T12:00:02.000Z', value: 2.4 },
    { timestamp: '2026-09-10T12:00:01.000Z', value: 2.3 },
  ];

  it('sorts history and replaces an equal-timestamp point with the live reading', () => {
    const live: TelemetryFrame = {
      timestamp: '2026-09-10T12:00:02.000Z',
      spacecraft_id: 'ORBITAL-X1',
      simulation_time: 2,
      scenario: 'NORMAL',
      fuel_pressure: 2.45,
    };

    expect(mergeTelemetrySeries(history, live, 'fuel_pressure', 0, 10)).toEqual([
      { timestamp: '2026-09-10T12:00:01.000Z', value: 2.3 },
      { timestamp: '2026-09-10T12:00:02.000Z', value: 2.45 },
    ]);
    expect(history[0].value).toBe(2.4);
  });

  it('ignores a live frame when the requested metric is absent or non-numeric', () => {
    const live: TelemetryFrame = {
      timestamp: '2026-09-10T12:00:03.000Z',
      spacecraft_id: 'ORBITAL-X1',
      simulation_time: 3,
      scenario: 'NORMAL',
      fuel_pressure: 'invalid',
    };

    expect(mergeTelemetrySeries(history, live, 'fuel_pressure', 0, 10)).toEqual([
      { timestamp: '2026-09-10T12:00:01.000Z', value: 2.3 },
      { timestamp: '2026-09-10T12:00:02.000Z', value: 2.4 },
    ]);
    expect(mergeTelemetrySeries(history, live, 'battery_level', 0, 10)).toHaveLength(2);
  });

  it('prunes old points and retains only the newest bounded set', () => {
    const points: HistoryPoint[] = [
      { timestamp: '2026-09-10T12:00:00.000Z', value: 1 },
      { timestamp: '2026-09-10T12:00:01.000Z', value: 2 },
      { timestamp: '2026-09-10T12:00:02.000Z', value: 3 },
      { timestamp: '2026-09-10T12:00:03.000Z', value: 4 },
    ];

    expect(mergeTelemetrySeries(
      points,
      null,
      'fuel_pressure',
      Date.parse('2026-09-10T12:00:01.000Z'),
      2,
    )).toEqual([
      { timestamp: '2026-09-10T12:00:02.000Z', value: 3 },
      { timestamp: '2026-09-10T12:00:03.000Z', value: 4 },
    ]);
  });
});

describe('normalizeNavigation', () => {
  it('normalizes position to scene radius and calculates velocity magnitude', () => {
    const result = normalizeNavigation({
      timestamp: '2026-09-10T12:00:00.000Z',
      spacecraft_id: 'ORBITAL-X1',
      simulation_time: 0,
      scenario: 'NORMAL',
      position_x: 3,
      position_y: 4,
      position_z: 0,
      velocity_x: 3,
      velocity_y: 4,
      velocity_z: 0,
    });

    expect(result.position[0]).toBeCloseTo(1.92);
    expect(result.position[1]).toBeCloseTo(2.56);
    expect(result.position[2]).toBeCloseTo(0);
    expect(result.velocityMagnitude).toBe(5);
    expect(result.rawPosition).toEqual([3, 4, 0]);
  });

  it('uses a stable orbital position for absent or zero navigation data', () => {
    expect(normalizeNavigation(null)).toEqual({
      position: [3.2, 0, 0],
      rawPosition: [0, 0, 0],
      velocityMagnitude: 0,
    });
  });
});
