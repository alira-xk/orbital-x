import type { TelemetrySubsystem } from './metricCatalog.js';
import type { TelemetryFrame } from './schema.js';

export type AnomalySeverity = 'nominal' | 'warning' | 'high' | 'critical';
export type DetectionMethod = 'rule' | 'rate_of_change' | 'isolation_forest' | 'hybrid';

export interface Anomaly {
  metric: string;
  subsystem: TelemetrySubsystem;
  value: number;
  score: number;
  expectedRange: string;
  methods: DetectionMethod[];
}

export interface AnomalyResult {
  score: number;
  severity: AnomalySeverity;
  anomalies: Anomaly[];
  evaluatedAt: string;
}

export interface SyntheticDatasetOptions {
  size?: number;
  seed?: number;
}

export interface MetricBaseline {
  subsystem: Exclude<TelemetrySubsystem, 'unknown'>;
  unit: string;
  minimum: number;
  maximum: number;
  center: number;
  maxNominalSlope: number;
}

/** Engineering nominal bands shared by the rule detector and synthetic data. */
export const METRIC_BASELINES: Readonly<Record<string, MetricBaseline>> = {
  fuel_level: { subsystem: 'propulsion', unit: '%', minimum: 0, maximum: 100, center: 88, maxNominalSlope: 1 },
  fuel_pressure: { subsystem: 'propulsion', unit: 'MPa', minimum: 2, maximum: 2.8, center: 2.7, maxNominalSlope: 0.05 },
  fuel_flow: { subsystem: 'propulsion', unit: 'kg/s', minimum: 0.4, maximum: 0.6, center: 0.5, maxNominalSlope: 0.05 },
  thrust: { subsystem: 'propulsion', unit: '%', minimum: 50, maximum: 100, center: 98, maxNominalSlope: 5 },
  engine_temperature: { subsystem: 'propulsion', unit: '°C', minimum: 60, maximum: 95, center: 78, maxNominalSlope: 2 },
  battery_level: { subsystem: 'power', unit: '%', minimum: 0, maximum: 100, center: 92, maxNominalSlope: 2 },
  battery_voltage: { subsystem: 'power', unit: 'V', minimum: 24, maximum: 29, center: 28.4, maxNominalSlope: 0.2 },
  current_draw: { subsystem: 'power', unit: 'A', minimum: 3, maximum: 8, center: 5.2, maxNominalSlope: 1 },
  solar_generation: { subsystem: 'power', unit: 'A', minimum: 6, maximum: 10, center: 8, maxNominalSlope: 1 },
  power_consumption: { subsystem: 'power', unit: 'kW', minimum: 4, maximum: 8, center: 5.5, maxNominalSlope: 1 },
  cpu_temperature: { subsystem: 'thermal', unit: '°C', minimum: 20, maximum: 80, center: 52, maxNominalSlope: 3 },
  cabin_temperature: { subsystem: 'thermal', unit: '°C', minimum: 18, maximum: 26, center: 22, maxNominalSlope: 1 },
  radiator_temperature: { subsystem: 'thermal', unit: '°C', minimum: -30, maximum: 10, center: -10, maxNominalSlope: 3 },
  radiator_efficiency: { subsystem: 'thermal', unit: 'ratio', minimum: 0.8, maximum: 1, center: 0.95, maxNominalSlope: 0.03 },
  signal_strength: { subsystem: 'communications', unit: 'dBm', minimum: -80, maximum: -40, center: -55, maxNominalSlope: 5 },
  packet_loss: { subsystem: 'communications', unit: '%', minimum: 0, maximum: 1, center: 0.1, maxNominalSlope: 0.2 },
  latency: { subsystem: 'communications', unit: 'ms', minimum: 100, maximum: 500, center: 240, maxNominalSlope: 40 },
  bandwidth: { subsystem: 'communications', unit: 'Mbps', minimum: 5, maximum: 15, center: 10, maxNominalSlope: 1 },
  cpu_usage: { subsystem: 'flight_computer', unit: '%', minimum: 0, maximum: 80, center: 35, maxNominalSlope: 10 },
  memory_usage: { subsystem: 'flight_computer', unit: '%', minimum: 0, maximum: 80, center: 55, maxNominalSlope: 5 },
  storage_used: { subsystem: 'flight_computer', unit: '%', minimum: 0, maximum: 90, center: 42, maxNominalSlope: 1 },
  process_health: { subsystem: 'flight_computer', unit: '%', minimum: 80, maximum: 100, center: 100, maxNominalSlope: 2 },
  position_x: { subsystem: 'navigation', unit: 'km', minimum: -7000, maximum: 7000, center: 6778, maxNominalSlope: 10 },
  position_y: { subsystem: 'navigation', unit: 'km', minimum: -7000, maximum: 7000, center: 0, maxNominalSlope: 10 },
  position_z: { subsystem: 'navigation', unit: 'km', minimum: -7000, maximum: 7000, center: 0, maxNominalSlope: 10 },
  velocity_x: { subsystem: 'navigation', unit: 'km/s', minimum: -10, maximum: 10, center: 0, maxNominalSlope: 1 },
  velocity_y: { subsystem: 'navigation', unit: 'km/s', minimum: -10, maximum: 10, center: 7.8, maxNominalSlope: 1 },
  velocity_z: { subsystem: 'navigation', unit: 'km/s', minimum: -10, maximum: 10, center: 0, maxNominalSlope: 1 },
  orientation_roll: { subsystem: 'navigation', unit: 'degrees', minimum: -180, maximum: 180, center: 0, maxNominalSlope: 10 },
  orientation_pitch: { subsystem: 'navigation', unit: 'degrees', minimum: -180, maximum: 180, center: 0, maxNominalSlope: 10 },
  orientation_yaw: { subsystem: 'navigation', unit: 'degrees', minimum: -180, maximum: 180, center: 0, maxNominalSlope: 10 },
};

export const metricBaselines = METRIC_BASELINES;

function seededRandom(seed: number): () => number {
  let state = (Math.trunc(seed) >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

export function generateSyntheticDataset(size = 256, seed = 1): TelemetryFrame[] {
  if (!Number.isFinite(size) || size < 1 || !Number.isFinite(seed)) {
    throw new Error('Synthetic dataset size must be positive and seed must be finite');
  }
  const count = Math.min(4096, Math.floor(size));
  const random = seededRandom(seed);
  const start = Date.parse('2026-09-10T00:00:00.000Z');
  return Array.from({ length: count }, (_, index) => {
    const frame: Record<string, string | number> = {
      timestamp: new Date(start + index * 1000).toISOString(),
      spacecraft_id: 'ORBITAL-X1',
      simulation_time: index,
      scenario: 'NORMAL',
    };
    for (const [metric, baseline] of Object.entries(METRIC_BASELINES)) {
      frame[metric] = baseline.minimum + random() * (baseline.maximum - baseline.minimum);
    }
    return frame as unknown as TelemetryFrame;
  });
}

type ForestOptions = { seed?: number; treeCount?: number; sampleSize?: number };
type ForestNode =
  | { leaf: true; size: number }
  | { leaf: false; feature: number; split: number; left: ForestNode; right: ForestNode; size: number };

const FEATURE_NAMES = Object.keys(METRIC_BASELINES);
const EULER_GAMMA = 0.5772156649015329;
const ISOLATION_FOREST_RAW_SCORE_FLOOR = 0.4;
const ISOLATION_FOREST_SCORE_SCALE = 2;

function averagePathCorrection(size: number): number {
  if (size <= 1) return 0;
  if (size === 2) return 1;
  return 2 * (Math.log(size - 1) + EULER_GAMMA) - (2 * (size - 1)) / size;
}

function normalizedFeatures(frame: TelemetryFrame): number[] {
  const source = frame as unknown as Record<string, unknown>;
  return FEATURE_NAMES.map((name) => {
    const baseline = METRIC_BASELINES[name];
    const value = source[name];
    return typeof value === 'number' && Number.isFinite(value)
      ? (value - baseline.minimum) / (baseline.maximum - baseline.minimum)
      : Number.NaN;
  });
}

function buildTree(rows: number[][], depth: number, maxDepth: number, random: () => number): ForestNode {
  if (rows.length <= 1 || depth >= maxDepth) return { leaf: true, size: rows.length };
  const candidates = Array.from({ length: rows[0].length }, (_, i) => i).filter((feature) => {
    const values = rows.map((row) => row[feature]);
    return values.every(Number.isFinite) && Math.min(...values) < Math.max(...values);
  });
  if (candidates.length === 0) return { leaf: true, size: rows.length };
  const feature = candidates[Math.floor(random() * candidates.length)];
  const values = rows.map((row) => row[feature]);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const split = min + random() * (max - min);
  const left = rows.filter((row) => row[feature] < split);
  const right = rows.filter((row) => row[feature] >= split);
  if (left.length === 0 || right.length === 0) return { leaf: true, size: rows.length };
  return { leaf: false, feature, split, left: buildTree(left, depth + 1, maxDepth, random), right: buildTree(right, depth + 1, maxDepth, random), size: rows.length };
}

function pathLength(node: ForestNode, row: number[], depth: number): number {
  if (node.leaf) return depth + averagePathCorrection(node.size);
  const value = row[node.feature];
  // Missing metrics cannot be compared to a split. Route explicitly to the
  // larger partition, preserving a neutral path estimate without NaN bias.
  const child = Number.isFinite(value) ? (value < node.split ? node.left : node.right) : (node.left.size >= node.right.size ? node.left : node.right);
  return pathLength(child, row, depth + 1);
}

export class IsolationForest {
  private readonly seed: number;
  private readonly treeCount: number;
  private readonly sampleSize: number;
  private trees: ForestNode[] = [];
  private trainingSize = 0;

  constructor(options: ForestOptions = {}) {
    this.seed = Number.isFinite(options.seed) ? Math.trunc(options.seed!) : 1;
    const requestedTrees = options.treeCount ?? 32;
    const requestedSample = options.sampleSize ?? 64;
    this.treeCount = Number.isFinite(requestedTrees) ? Math.min(32, Math.max(1, Math.floor(requestedTrees))) : 32;
    this.sampleSize = Number.isFinite(requestedSample) ? Math.min(64, Math.max(2, Math.floor(requestedSample))) : 64;
  }

  fit(frames: readonly TelemetryFrame[]): void {
    if (frames.length === 0) throw new Error('IsolationForest requires non-empty training data');
    const rows = frames.map(normalizedFeatures);
    this.trainingSize = rows.length;
    const random = seededRandom(this.seed);
    const count = Math.min(this.sampleSize, rows.length);
    const maxDepth = Math.ceil(Math.log2(count));
    this.trees = [];
    for (let tree = 0; tree < this.treeCount; tree += 1) {
      const indices = Array.from({ length: rows.length }, (_, index) => index);
      for (let index = indices.length - 1; index > 0; index -= 1) {
        const swap = Math.floor(random() * (index + 1));
        [indices[index], indices[swap]] = [indices[swap], indices[index]];
      }
      this.trees.push(buildTree(indices.slice(0, count).map((index) => rows[index]), 0, maxDepth, random));
    }
  }

  score(frame: TelemetryFrame): number {
    const row = normalizedFeatures(frame);
    if (!row.some(Number.isFinite) || this.trees.length === 0) return 0;
    const path = this.trees.reduce((sum, tree) => sum + pathLength(tree, row, 0), 0) / this.trees.length;
    const normalizer = averagePathCorrection(Math.min(this.sampleSize, this.trainingSize));
    if (normalizer <= 0) return 0;
    const rawPathScore = Math.pow(2, -path / normalizer);
    // Raw isolation-forest scores cluster around 0.5 for nominal samples.
    // Center that conventional scale into anomaly strength before applying
    // the detector's 0.35 finding threshold.
    return Math.max(
      0,
      Math.min(1, (rawPathScore - ISOLATION_FOREST_RAW_SCORE_FLOOR) * ISOLATION_FOREST_SCORE_SCALE),
    );
  }
}

export interface StreamingAnomalyDetectorOptions {
  seed?: number;
}

const WARNING_SCORE_THRESHOLD = 0.35;
const HIGH_SCORE_THRESHOLD = 0.6;
const CRITICAL_SCORE_THRESHOLD = 0.85;
const ISOLATION_FOREST_FINDING_THRESHOLD = WARNING_SCORE_THRESHOLD;
const RATE_FINDING_SCORE_FLOOR = WARNING_SCORE_THRESHOLD;
const RATE_EXCESS_SCORE_RANGE = 1 - RATE_FINDING_SCORE_FLOOR;
let defaultForest: IsolationForest | undefined;

function clampScore(score: number): number {
  return Math.max(0, Math.min(1, score));
}

function assertValidKnownMetrics(frame: TelemetryFrame): void {
  const source = frame as unknown as Record<string, unknown>;
  for (const metric of FEATURE_NAMES) {
    if (!(metric in source)) continue;
    const value = source[metric];
    if (typeof value !== 'number' || !Number.isFinite(value)) {
      throw new Error(`Known telemetry metric ${metric} must be finite`);
    }
  }
}

function trainedForest(seed: number): IsolationForest {
  const forest = new IsolationForest({ seed });
  forest.fit(generateSyntheticDataset(256, seed));
  return forest;
}

function mergeFinding(findings: Map<string, Anomaly>, finding: Anomaly): void {
  const existing = findings.get(finding.metric);
  if (!existing) {
    findings.set(finding.metric, finding);
    return;
  }

  const methods = [...existing.methods];
  for (const method of finding.methods) {
    if (!methods.includes(method)) methods.push(method);
  }
  findings.set(finding.metric, {
    ...existing,
    score: Math.max(existing.score, finding.score),
    expectedRange: existing.expectedRange.includes(finding.expectedRange)
      ? existing.expectedRange
      : `${existing.expectedRange}; ${finding.expectedRange}`,
    methods,
  });
}

function severityFor(score: number): AnomalySeverity {
  if (score >= CRITICAL_SCORE_THRESHOLD) return 'critical';
  if (score >= HIGH_SCORE_THRESHOLD) return 'high';
  if (score >= WARNING_SCORE_THRESHOLD) return 'warning';
  return 'nominal';
}

function evaluateFrame(frame: TelemetryFrame, previousFrame: TelemetryFrame | undefined, forest: IsolationForest): AnomalyResult {
  assertValidKnownMetrics(frame);
  if (previousFrame) assertValidKnownMetrics(previousFrame);

  const source = frame as unknown as Record<string, unknown>;
  const previous = previousFrame as unknown as Record<string, unknown> | undefined;
  const findings = new Map<string, Anomaly>();
  const simulatedElapsedSeconds = previousFrame
    ? frame.simulation_time - previousFrame.simulation_time
    : Number.NaN;
  const timestampElapsedSeconds = previousFrame
    ? (Date.parse(frame.timestamp) - Date.parse(previousFrame.timestamp)) / 1000
    : Number.NaN;
  const elapsedSeconds = Number.isFinite(simulatedElapsedSeconds) && simulatedElapsedSeconds > 0
    ? simulatedElapsedSeconds
    : timestampElapsedSeconds;

  for (const [metric, baseline] of Object.entries(METRIC_BASELINES)) {
    const value = source[metric];
    if (typeof value !== 'number') continue;

    const bandWidth = baseline.maximum - baseline.minimum;
    const outsideDistance = value < baseline.minimum
      ? baseline.minimum - value
      : value > baseline.maximum
        ? value - baseline.maximum
        : 0;
    if (outsideDistance > 0) {
      mergeFinding(findings, {
        metric,
        subsystem: baseline.subsystem,
        value,
        score: clampScore((outsideDistance / bandWidth) * 2),
        expectedRange: `${baseline.minimum}–${baseline.maximum} ${baseline.unit}`,
        methods: ['rule'],
      });
    }

    const previousValue = previous?.[metric];
    if (Number.isFinite(elapsedSeconds) && elapsedSeconds > 0 && typeof previousValue === 'number') {
      const slope = Math.abs(value - previousValue) / elapsedSeconds;
      if (slope > baseline.maxNominalSlope) {
        const normalizedExcess = (slope - baseline.maxNominalSlope) / baseline.maxNominalSlope;
        mergeFinding(findings, {
          metric,
          subsystem: baseline.subsystem,
          value,
          score: clampScore(RATE_FINDING_SCORE_FLOOR + normalizedExcess * RATE_EXCESS_SCORE_RANGE),
          expectedRange: `rate ≤ ${baseline.maxNominalSlope} ${baseline.unit}/s`,
          methods: ['rate_of_change'],
        });
      }
    }
  }

  const forestScore = forest.score(frame);
  if (forestScore >= ISOLATION_FOREST_FINDING_THRESHOLD) {
    mergeFinding(findings, {
      metric: 'telemetry_profile',
      subsystem: 'unknown',
      value: forestScore,
      score: forestScore,
      expectedRange: `anomaly score < ${ISOLATION_FOREST_FINDING_THRESHOLD} unitless`,
      methods: ['isolation_forest'],
    });
  }

  const anomalies = [...findings.values()];
  const score = anomalies.length === 0 ? 0 : clampScore(Math.max(...anomalies.map((anomaly) => anomaly.score)));
  return { score, severity: severityFor(score), anomalies, evaluatedAt: frame.timestamp };
}

export function detectAnomalies(frame: TelemetryFrame, previousFrame?: TelemetryFrame): AnomalyResult {
  defaultForest ??= trainedForest(1);
  return evaluateFrame(frame, previousFrame, defaultForest);
}

export class StreamingAnomalyDetector {
  private readonly seed: number;
  private forest: IsolationForest | undefined;
  private previousFrame: TelemetryFrame | undefined;

  constructor(options: StreamingAnomalyDetectorOptions = {}) {
    this.seed = Number.isFinite(options.seed) ? Math.trunc(options.seed!) : 1;
  }

  detect(frame: TelemetryFrame): AnomalyResult {
    assertValidKnownMetrics(frame);
    this.forest ??= trainedForest(this.seed);
    const result = evaluateFrame(frame, this.previousFrame, this.forest);
    this.previousFrame = { ...frame };
    return result;
  }
}
