import { describe, expect, it } from 'vitest';
import { METRICS, SUBSYSTEMS, TIME_RANGES, metricsForSubsystem } from './telemetry';

describe('telemetry domain catalog', () => {
  it('provides one selectable definition for every spacecraft subsystem', () => {
    expect(SUBSYSTEMS.map(({ id }) => id)).toEqual([
      'propulsion',
      'power',
      'thermal',
      'communications',
      'flight_computer',
      'navigation',
    ]);
    expect(SUBSYSTEMS.every(({ label, shortLabel, color }) => (
      label.length > 0 && shortLabel.length > 0 && color.startsWith('#')
    ))).toBe(true);
  });

  it('keeps metric presentation complete and unambiguous', () => {
    const keys = METRICS.map(({ key }) => key);

    expect(keys).toHaveLength(31);
    expect(new Set(keys).size).toBe(keys.length);
    expect(METRICS.every(({ label, unit, color, precision }) => (
      label.length > 0
      && unit.length > 0
      && color.startsWith('#')
      && Number.isInteger(precision)
      && precision >= 0
    ))).toBe(true);
    expect(SUBSYSTEMS.every(({ id }) => metricsForSubsystem(id).length > 0)).toBe(true);
  });

  it('bounds every dashboard range to the approved display resolution', () => {
    expect(TIME_RANGES.map(({ id, bucketSeconds, maxPoints }) => [
      id,
      bucketSeconds ?? 'raw',
      maxPoints,
    ])).toEqual([
      ['1m', 'raw', 60],
      ['5m', 2, 150],
      ['15m', 5, 180],
      ['1h', 15, 240],
      ['6h', 60, 360],
      ['24h', 300, 288],
    ]);
  });
});
