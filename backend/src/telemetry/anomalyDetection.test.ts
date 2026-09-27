import { detectAnomalies, generateSyntheticDataset, IsolationForest, StreamingAnomalyDetector, type AnomalyResult } from './anomalyDetection.js';
import type { TelemetryFrame } from './schema.js';

const normalFrame: TelemetryFrame & { fuel_pressure: number; engine_temperature: number } = {
  timestamp: '2026-09-10T12:00:00.000Z',
  spacecraft_id: 'ORBITAL-X1',
  simulation_time: 0,
  scenario: 'NORMAL',
  fuel_pressure: 2.45,
  engine_temperature: 78.0,
};

const leakingFrame: TelemetryFrame & { fuel_pressure: number; engine_temperature: number; fuel_flow: number; fuel_level: number; thrust: number } = {
  timestamp: '2026-09-10T12:00:30.000Z',
  spacecraft_id: 'ORBITAL-X1',
  simulation_time: 30,
  scenario: 'PROPULSION_LEAK',
  fuel_pressure: 1.7,
  engine_temperature: 62.0,
  fuel_flow: 0.62,
  fuel_level: 72.0,
  thrust: 88.0,
};

describe('detectAnomalies', () => {
  it('returns a result object with an anomaly score and severity', () => {
    const result: AnomalyResult = detectAnomalies(normalFrame);

    expect(result).toHaveProperty('score');
    expect(result).toHaveProperty('severity');
    expect(result).toHaveProperty('anomalies');
    expect(result.score).toBeGreaterThanOrEqual(0);
    expect(result.score).toBeLessThanOrEqual(1);
  });

  it('flags a propulsion leak scenario as an anomaly', () => {
    const result = detectAnomalies(leakingFrame);

    expect(result.score).toBeGreaterThan(0.5);
    expect(result.severity).toBe('high');
    expect(result.anomalies.length).toBeGreaterThan(0);
  });

  it('returns anomaly details with metric, subsystem, and expected range', () => {
    const result = detectAnomalies(leakingFrame);
    const propulsionAnomaly = result.anomalies.find(({ metric }) => metric === 'fuel_pressure');

    expect(propulsionAnomaly).toBeDefined();
    expect(propulsionAnomaly!.subsystem).toBe('propulsion');
    expect(typeof propulsionAnomaly!.score).toBe('number');
    expect(typeof propulsionAnomaly!.expectedRange).toBe('string');
  });

  it('flags a rapid fuel-pressure drop as rate of change', () => {
    const previous = { ...normalFrame, timestamp: '2026-09-10T12:00:00.000Z', fuel_pressure: 2.7 };
    const current = { ...normalFrame, timestamp: '2026-09-10T12:00:01.000Z', fuel_pressure: 2.1 };
    const result = detectAnomalies(current, previous);
    expect(result.anomalies.find((item) => item.metric === 'fuel_pressure')?.methods).toContain('rate_of_change');
  });

  it('uses simulation time instead of a bursty delivery timestamp for rate checks', () => {
    const previous = {
      ...normalFrame,
      simulation_time: 0,
      position_y: 0,
    } as TelemetryFrame;
    const current = {
      ...normalFrame,
      timestamp: '2026-09-10T12:00:00.025Z',
      simulation_time: 1,
      position_y: 7.8,
    } as TelemetryFrame;

    expect(detectAnomalies(current, previous).anomalies.find((item) => item.metric === 'position_y')).toBeUndefined();
  });

  it('does not invent findings for unknown metrics', () => {
    const result = detectAnomalies({ ...normalFrame, vendor_counter: 42 } as TelemetryFrame);
    expect(result.anomalies.find((item) => item.metric === 'vendor_counter')).toBeUndefined();
  });

  it('retains the previous frame and reports a propulsion leak as high', () => {
    const detector = new StreamingAnomalyDetector({ seed: 3 });
    expect(detector.detect(normalFrame).severity).toBe('nominal');
    const result = detector.detect(leakingFrame);
    expect(result.score).toBeGreaterThan(0.5);
    expect(result.severity).toBe('high');
    expect(result.anomalies.some((item) => item.metric === 'fuel_pressure')).toBe(true);
  });

  it('merges rule and rate findings and formats engineering limits with units', () => {
    const previous = { ...normalFrame, fuel_pressure: 2.7 };
    const current = { ...normalFrame, timestamp: '2026-09-10T12:00:01.000Z', fuel_pressure: 1.6 };

    const finding = detectAnomalies(current, previous).anomalies.find((item) => item.metric === 'fuel_pressure');

    expect(finding?.methods).toEqual(expect.arrayContaining(['rule', 'rate_of_change']));
    expect(finding?.expectedRange).toContain('MPa');
    expect(finding?.score).toBe(1);
  });

  it('grades rate findings by excess above the nominal slope', () => {
    const previous = { ...normalFrame, fuel_pressure: 2.7 };
    const slightResult = detectAnomalies(
      { ...normalFrame, timestamp: '2026-09-10T12:00:01.000Z', fuel_pressure: 2.645 } as TelemetryFrame,
      previous,
    );
    const largerResult = detectAnomalies(
      { ...normalFrame, timestamp: '2026-09-10T12:00:01.000Z', fuel_pressure: 2.64 } as TelemetryFrame,
      previous,
    );
    const slight = slightResult.anomalies.find((item) => item.metric === 'fuel_pressure');
    const larger = largerResult.anomalies.find((item) => item.metric === 'fuel_pressure');

    expect(slight?.methods).toContain('rate_of_change');
    expect(slightResult.severity).toBe('warning');
    expect(slight?.score).toBeLessThan(0.85);
    expect(larger!.score).toBeGreaterThan(slight!.score);
  });

  it('skips rate findings without a positive finite elapsed time', () => {
    const current = { ...normalFrame, fuel_pressure: 2.1 };
    const sameTime = { ...normalFrame, fuel_pressure: 2.7 };

    expect(detectAnomalies(current).anomalies.find((item) => item.metric === 'fuel_pressure')).toBeUndefined();
    expect(detectAnomalies(current, sameTime).anomalies.find((item) => item.metric === 'fuel_pressure')).toBeUndefined();
  });

  it('skips rate findings for negative and invalid elapsed time', () => {
    const current = { ...normalFrame, fuel_pressure: 2.1 };
    const future = { ...normalFrame, timestamp: '2026-09-10T12:00:01.000Z', fuel_pressure: 2.7 };
    const invalid = { ...normalFrame, timestamp: 'not-a-time', fuel_pressure: 2.7 };

    expect(detectAnomalies(current, future).anomalies.find((item) => item.metric === 'fuel_pressure')).toBeUndefined();
    expect(detectAnomalies(current, invalid).anomalies.find((item) => item.metric === 'fuel_pressure')).toBeUndefined();
  });

  it.each([
    [-17.5, 0.35, 'warning'],
    [-30, 0.6, 'high'],
    [-42.5, 0.85, 'critical'],
  ] as const)('maps an exact score boundary to %s severity', (fuelLevel, expectedScore, severity) => {
    const result = detectAnomalies({ ...normalFrame, fuel_level: fuelLevel } as TelemetryFrame);
    expect(result.score).toBeCloseTo(expectedScore);
    expect(result.severity).toBe(severity);
  });

  it('returns the frame timestamp and does not mutate either frame', () => {
    const previous = { ...normalFrame, fuel_pressure: 2.7 };
    const current = { ...normalFrame, timestamp: '2026-09-10T12:00:01.000Z', fuel_pressure: 2.1 };
    const beforePrevious = structuredClone(previous);
    const beforeCurrent = structuredClone(current);

    const result = detectAnomalies(current, previous);

    expect(result.evaluatedAt).toBe(current.timestamp);
    expect(previous).toEqual(beforePrevious);
    expect(current).toEqual(beforeCurrent);
  });

  it('rejects non-finite known metrics without replacing streaming history', () => {
    const detector = new StreamingAnomalyDetector({ seed: 3 });
    detector.detect(normalFrame);
    expect(() => detector.detect(
      { ...normalFrame, timestamp: '2026-09-10T12:00:01.000Z', fuel_pressure: Number.NaN } as TelemetryFrame,
    )).toThrow('fuel_pressure');

    const result = detector.detect(
      { ...normalFrame, timestamp: '2026-09-10T12:00:02.000Z', fuel_pressure: 2.3 } as TelemetryFrame,
    );
    expect(result.anomalies.find((item) => item.metric === 'fuel_pressure')?.methods).toContain('rate_of_change');
  });

  it('rejects non-finite known metrics in the stateless detector', () => {
    expect(() => detectAnomalies({ ...normalFrame, fuel_pressure: Number.POSITIVE_INFINITY } as TelemetryFrame)).toThrow(
      'fuel_pressure',
    );
  });
});

describe('generateSyntheticDataset', () => {
  it('generates deterministic nominal frames', () => {
    const first = generateSyntheticDataset(4, 7);
    const second = generateSyntheticDataset(4, 7);
    expect(first).toEqual(second);
    expect(first).toHaveLength(4);
    expect(first[0].timestamp).not.toBe(first[1].timestamp);
    expect(first.every((frame) => frame.spacecraft_id === 'ORBITAL-X1')).toBe(true);
  });

  it('rejects invalid synthetic dataset arguments', () => {
    expect(() => generateSyntheticDataset(0, 7)).toThrow();
    expect(() => generateSyntheticDataset(4, Number.NaN)).toThrow();
  });
});

describe('IsolationForest', () => {
  it('scores nominal data below an extreme outlier', () => {
    const forest = new IsolationForest({ seed: 11, treeCount: 32, sampleSize: 64 });
    forest.fit(generateSyntheticDataset(128, 11));
    const nominal = generateSyntheticDataset(1, 12)[0];
    const outlier = { ...nominal, fuel_pressure: 1.2, engine_temperature: 120 };
    expect(forest.score(outlier)).toBeGreaterThan(forest.score(nominal));
    expect(forest.score(outlier)).toBeGreaterThanOrEqual(0);
    expect(forest.score(outlier)).toBeLessThanOrEqual(1);
  });

  it('is deterministic for the same seed and training data', () => {
    const data = generateSyntheticDataset(64, 4);
    const left = new IsolationForest({ seed: 9 });
    const right = new IsolationForest({ seed: 9 });
    left.fit(data);
    right.fit(data);
    expect(right.score(data[0])).toBe(left.score(data[0]));
  });

  it('caps sample size and tree count at bounded limits', () => {
    const data = generateSyntheticDataset(128, 4);
    const bounded = new IsolationForest({ seed: 3, sampleSize: 64, treeCount: 32 });
    const oversized = new IsolationForest({ seed: 3, sampleSize: 100, treeCount: 100 });
    bounded.fit(data);
    oversized.fit(data);
    expect(oversized.score(data[0])).toBe(bounded.score(data[0]));
    expect(() => new IsolationForest({ treeCount: Number.POSITIVE_INFINITY, sampleSize: Number.POSITIVE_INFINITY }).fit(data)).not.toThrow();
  });

  it('handles empty training, unknown frames, immutable data, and partial frames', () => {
    const data = generateSyntheticDataset(16, 8);
    const snapshot = structuredClone(data);
    const forest = new IsolationForest({ seed: 2 });
    expect(() => forest.fit([])).toThrow();
    forest.fit(data);
    expect(forest.score({ timestamp: data[0].timestamp, spacecraft_id: 'x', simulation_time: 0, scenario: 'x' })).toBe(0);
    expect(Number.isFinite(forest.score({ timestamp: data[0].timestamp, spacecraft_id: 'x', simulation_time: 0, scenario: 'x', fuel_pressure: 2.5 } as TelemetryFrame))).toBe(true);
    expect(data).toEqual(snapshot);
  });

  it('keeps partial-frame scores deterministic and safely handles non-finite options', () => {
    const data = generateSyntheticDataset(32, 14);
    const partial = { ...data[0], fuel_pressure: Number.NaN, engine_temperature: Number.POSITIVE_INFINITY };
    const forest = new IsolationForest({ seed: Number.NaN, treeCount: -4, sampleSize: Number.POSITIVE_INFINITY });
    forest.fit(data);
    const first = forest.score(partial);
    expect(forest.score(partial)).toBe(first);
    expect(Number.isFinite(first)).toBe(true);
    expect(first).toBeGreaterThanOrEqual(0);
    expect(first).toBeLessThanOrEqual(1);
    expect(forest.score({ ...data[0], fuel_pressure: -Infinity } as TelemetryFrame)).toBeGreaterThanOrEqual(0);
  });
});
