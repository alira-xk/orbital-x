import {
  TelemetryWorker,
  type TelemetryBroadcaster,
  type TelemetryRedisClient,
  type TelemetryStreamEntry,
  type TelemetryStreamReadResult,
} from '../workers/telemetry-worker.js';
import type { TelemetryFrame } from './schema.js';
import type { TelemetryRepository } from './repository.js';
import { StreamingAnomalyDetector, type AnomalyResult } from './anomalyDetection.js';
import { logger } from '../utils/logger.js';

class RecordingRedis implements TelemetryRedisClient {
  readonly acknowledged: string[] = [];
  readonly groupCommands: Array<Array<string | number>> = [];
  readonly readCommands: Array<Array<string | number>> = [];
  readonly pendingReads: TelemetryStreamReadResult[] = [];
  readonly newReads: TelemetryStreamReadResult[] = [];
  groupError: Error | null = null;

  async xgroup(...args: Array<string | number>): Promise<void> {
    this.groupCommands.push(args);
    if (this.groupError !== null) {
      throw this.groupError;
    }
  }

  async xreadgroup(...args: Array<string | number>): Promise<TelemetryStreamReadResult> {
    this.readCommands.push(args);
    return args.at(-1) === '0'
      ? this.pendingReads.shift() ?? null
      : this.newReads.shift() ?? null;
  }

  async xack(_stream: string, _group: string, ...entryIds: string[]): Promise<number> {
    this.acknowledged.push(...entryIds);
    return entryIds.length;
  }
}

class RecordingRepository implements TelemetryRepository {
  readonly frames: TelemetryFrame[] = [];

  async store(frame: TelemetryFrame): Promise<void> {
    this.frames.push(frame);
  }
}

class FailsOnceRepository extends RecordingRepository {
  private failed = false;

  async store(frame: TelemetryFrame): Promise<void> {
    if (!this.failed && fuelPressure(frame) === 9.99) {
      this.failed = true;
      throw new Error('database unavailable');
    }
    await super.store(frame);
  }
}

class RecordingBroadcaster implements TelemetryBroadcaster {
  readonly frames: TelemetryFrame[] = [];

  async broadcast(frame: TelemetryFrame): Promise<void> {
    this.frames.push(frame);
  }
}

const validEnvelope = JSON.stringify({
  schema_version: 1,
  event_type: 'telemetry.frame',
  payload: {
    timestamp: '2026-09-10T12:00:00.000Z',
    spacecraft_id: 'ORBITAL-X1',
    simulation_time: 1,
    scenario: 'NORMAL',
    fuel_pressure: 2.45,
  },
});

const nominalResult: AnomalyResult = {
  score: 0,
  severity: 'nominal',
  anomalies: [],
  evaluatedAt: '2026-09-10T12:00:00.000Z',
};

const anomalousResult: AnomalyResult = {
  score: 0.7,
  severity: 'high',
  anomalies: [{
    metric: 'fuel_pressure',
    subsystem: 'propulsion',
    value: 2.45,
    score: 0.7,
    expectedRange: '2–2.8 MPa',
    methods: ['rate_of_change'],
  }],
  evaluatedAt: '2026-09-10T12:00:00.000Z',
};

function fuelPressure(frame: TelemetryFrame): number | undefined {
  const value = (frame as unknown as Record<string, unknown>).fuel_pressure;
  return typeof value === 'number' ? value : undefined;
}

const invalidFrames: Array<[string, string[]]> = [
  ['malformed JSON', ['telemetry:frame', '{not-json']],
  [
    'a wrong event type',
    [
      'telemetry:frame',
      JSON.stringify({
        schema_version: 1,
        event_type: 'telemetry.other',
        payload: {
          timestamp: '2026-09-10T12:00:00.000Z',
          spacecraft_id: 'ORBITAL-X1',
          simulation_time: 1,
          scenario: 'NORMAL',
          fuel_pressure: 2.45,
        },
      }),
    ],
  ],
  [
    'a missing required payload field',
    [
      'telemetry:frame',
      JSON.stringify({
        schema_version: 1,
        event_type: 'telemetry.frame',
        payload: {
          timestamp: '2026-09-10T12:00:00.000Z',
          spacecraft_id: 'ORBITAL-X1',
          simulation_time: 1,
          fuel_pressure: 2.45,
        },
      }),
    ],
  ],
  [
    'a non-finite metric',
    [
      'telemetry:frame',
      '{"schema_version":1,"event_type":"telemetry.frame","payload":{"timestamp":"2026-09-10T12:00:00.000Z","spacecraft_id":"ORBITAL-X1","simulation_time":1,"scenario":"NORMAL","fuel_pressure":1e999}}',
    ],
  ],
  ['additional stream fields', ['telemetry:frame', validEnvelope, 'unexpected', 'value']],
];

describe('TelemetryWorker', () => {
  beforeAll(() => {
    jest.spyOn(logger, 'debug').mockImplementation(() => undefined);
    jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('acknowledges an entry only after all valid numeric metrics persist', async () => {
    const redis = new RecordingRedis();
    const repository = new RecordingRepository();
    const broadcaster = new RecordingBroadcaster();
    const worker = new TelemetryWorker({ redis, repository, broadcaster });

    await worker.processEntry('1-0', ['telemetry:frame', validEnvelope]);

    expect(repository.frames).toHaveLength(1);
    expect(broadcaster.frames).toEqual([
      {
        timestamp: '2026-09-10T12:00:00.000Z',
        spacecraft_id: 'ORBITAL-X1',
        simulation_time: 1,
        scenario: 'NORMAL',
        fuel_pressure: 2.45,
      },
    ]);
    expect(redis.acknowledged).toEqual(['1-0']);
  });

  it('detects a validated frame after storage and sends anomalous results before broadcast', async () => {
    const order: string[] = [];
    const redis = new RecordingRedis();
    const repository: TelemetryRepository = {
      store: jest.fn(async () => {
        order.push('store');
      }),
    };
    const anomalyDetector = {
      detect: jest.fn((frame: TelemetryFrame) => {
        order.push('detect');
        expect(frame.spacecraft_id).toBe('ORBITAL-X1');
        return anomalousResult;
      }),
    };
    const anomalySink = jest.fn(async (frame: TelemetryFrame, result: AnomalyResult) => {
      order.push('sink');
      expect(frame.spacecraft_id).toBe('ORBITAL-X1');
      expect(result).toBe(anomalousResult);
    });
    const broadcaster: TelemetryBroadcaster = {
      broadcast: jest.fn(async () => {
        order.push('broadcast');
      }),
    };
    const worker = new TelemetryWorker({
      redis,
      repository,
      broadcaster,
      anomalyDetector,
      anomalySink,
    });

    await worker.processEntry('anomaly-0', ['telemetry:frame', validEnvelope]);

    expect(order).toEqual(['store', 'detect', 'sink', 'broadcast']);
    expect(anomalyDetector.detect).toHaveBeenCalledTimes(1);
    expect(anomalySink).toHaveBeenCalledTimes(1);
    expect(redis.acknowledged).toEqual(['anomaly-0']);
  });

  it('does not invoke the anomaly sink for nominal detector results', async () => {
    const redis = new RecordingRedis();
    const anomalyDetector = { detect: jest.fn(() => nominalResult) };
    const anomalySink = jest.fn<Promise<void>, [TelemetryFrame, AnomalyResult]>();
    const worker = new TelemetryWorker({
      redis,
      repository: new RecordingRepository(),
      broadcaster: new RecordingBroadcaster(),
      anomalyDetector,
      anomalySink,
    });

    await worker.processEntry('nominal-0', ['telemetry:frame', validEnvelope]);

    expect(anomalyDetector.detect).toHaveBeenCalledTimes(1);
    expect(anomalySink).not.toHaveBeenCalled();
    expect(redis.acknowledged).toEqual(['nominal-0']);
  });

  it('never invokes the anomaly detector for invalid telemetry', async () => {
    const redis = new RecordingRedis();
    const anomalyDetector = { detect: jest.fn(() => anomalousResult) };
    const anomalySink = jest.fn<Promise<void>, [TelemetryFrame, AnomalyResult]>();
    const worker = new TelemetryWorker({
      redis,
      repository: new RecordingRepository(),
      broadcaster: new RecordingBroadcaster(),
      anomalyDetector,
      anomalySink,
    });

    await worker.processEntry('invalid-anomaly-0', invalidFrames[2][1]);

    expect(anomalyDetector.detect).not.toHaveBeenCalled();
    expect(anomalySink).not.toHaveBeenCalled();
    expect(redis.acknowledged).toEqual(['invalid-anomaly-0']);
  });

  it('leaves an anomalous entry pending when the anomaly sink rejects', async () => {
    const redis = new RecordingRedis();
    const repository = new RecordingRepository();
    const broadcaster = new RecordingBroadcaster();
    const anomalyDetector = { detect: jest.fn(() => anomalousResult) };
    const anomalySink = jest.fn(async (): Promise<void> => {
      throw new Error('anomaly sink unavailable');
    });
    const worker = new TelemetryWorker({
      redis,
      repository,
      broadcaster,
      anomalyDetector,
      anomalySink,
    });

    await expect(worker.processEntry('sink-failure-0', ['telemetry:frame', validEnvelope]))
      .rejects.toThrow('anomaly sink unavailable');

    expect(repository.frames).toHaveLength(1);
    expect(anomalySink).toHaveBeenCalledTimes(1);
    expect(broadcaster.frames).toEqual([]);
    expect(redis.acknowledged).toEqual([]);
  });

  it('retries the original real-detector evidence after a sink failure and an intervening frame', async () => {
    const redis = new RecordingRedis();
    const broadcaster = new RecordingBroadcaster();
    const anomalySink = jest.fn<Promise<void>, [TelemetryFrame, AnomalyResult]>()
      .mockRejectedValueOnce(new Error('anomaly sink unavailable'))
      .mockResolvedValue(undefined);
    const worker = new TelemetryWorker({
      redis,
      repository: new RecordingRepository(),
      broadcaster,
      anomalyDetector: new StreamingAnomalyDetector({ seed: 3 }),
      anomalySink,
    });
    const envelope = (timestamp: string, simulationTime: number, fuelPressure: number): string[] => [
      'telemetry:frame',
      JSON.stringify({
        schema_version: 1,
        event_type: 'telemetry.frame',
        payload: {
          timestamp,
          spacecraft_id: 'ORBITAL-X1',
          simulation_time: simulationTime,
          scenario: 'NORMAL',
          fuel_pressure: fuelPressure,
        },
      }),
    ];
    const baseline = envelope('2026-09-10T12:00:00.000Z', 0, 2.7);
    const failed = envelope('2026-09-10T12:00:01.000Z', 1, 2.45);
    const intervening = envelope('2026-09-10T12:00:02.000Z', 2, 2.44);

    await worker.processEntry('baseline-0', baseline);
    await expect(worker.processEntry('failed-0', failed)).rejects.toThrow('anomaly sink unavailable');
    expect(redis.acknowledged).toEqual(['baseline-0']);

    await worker.processEntry('intervening-0', intervening);
    expect(redis.acknowledged).toEqual(['baseline-0', 'intervening-0']);

    await worker.processEntry('failed-0', failed);

    expect(anomalySink.mock.calls.map(([frame, result]) => ({
      timestamp: frame.timestamp,
      severity: result.severity,
      methods: result.anomalies[0]?.methods,
    }))).toEqual([
      { timestamp: '2026-09-10T12:00:01.000Z', severity: 'critical', methods: ['rate_of_change'] },
      { timestamp: '2026-09-10T12:00:01.000Z', severity: 'critical', methods: ['rate_of_change'] },
    ]);
    expect(broadcaster.frames.map(frame => frame.timestamp)).toEqual([
      '2026-09-10T12:00:00.000Z',
      '2026-09-10T12:00:02.000Z',
      '2026-09-10T12:00:01.000Z',
    ]);
    expect(redis.acknowledged).toEqual(['baseline-0', 'intervening-0', 'failed-0']);
  });

  it('applies backpressure until every cached result is recovered', async () => {
    const capacity = 100;
    const redis = new RecordingRedis();
    const failedEvidence = new Map<string, AnomalyResult>();
    const recoveredEvidence = new Map<string, AnomalyResult>();
    let sinkAvailable = false;
    const anomalyDetector = {
      detect: jest.fn((frame: TelemetryFrame): AnomalyResult => ({
        score: 1,
        severity: 'critical',
        anomalies: [{
          metric: 'fuel_pressure',
          subsystem: 'propulsion',
          value: fuelPressure(frame)!,
          score: 1,
          expectedRange: '2â€“2.8 MPa',
          methods: ['rule'],
        }],
        evaluatedAt: frame.timestamp,
      })),
    };
    const anomalySink = async (frame: TelemetryFrame, result: AnomalyResult): Promise<void> => {
      if (!sinkAvailable) {
        failedEvidence.set(frame.timestamp, result);
        throw new Error('anomaly sink unavailable');
      }
      recoveredEvidence.set(frame.timestamp, result);
    };
    const worker = new TelemetryWorker({
      redis,
      repository: new RecordingRepository(),
      broadcaster: new RecordingBroadcaster(),
      anomalyDetector,
      anomalySink,
    });
    const entry = (index: number): TelemetryStreamEntry => {
      const timestamp = new Date(Date.parse('2026-09-10T12:00:00.000Z') + index * 1000).toISOString();
      return [`capacity-${index}`, ['telemetry:frame', JSON.stringify({
        schema_version: 1,
        event_type: 'telemetry.frame',
        payload: {
          timestamp,
          spacecraft_id: 'ORBITAL-X1',
          simulation_time: index,
          scenario: 'PROPULSION_LEAK',
          fuel_pressure: 1.5,
        },
      })]];
    };
    const failedEntries = Array.from({ length: capacity }, (_, index) => entry(index));
    const queuedEntry = entry(capacity);
    redis.newReads.push(
      [['telemetry:stream', failedEntries]],
      [['telemetry:stream', [queuedEntry]]],
    );

    await expect(worker.consumeOnce()).rejects.toThrow('anomaly sink unavailable');
    expect(failedEvidence.size).toBe(capacity);

    await worker.consumeOnce().catch(() => undefined);

    expect(failedEvidence.size).toBe(capacity);
    expect(redis.readCommands.filter(command => command.at(-1) === '>')).toHaveLength(1);

    sinkAvailable = true;
    redis.pendingReads.push([['telemetry:stream', failedEntries]]);
    await worker.consumeOnce();

    for (const [, fields] of failedEntries) {
      const timestamp = JSON.parse(fields[1]).payload.timestamp as string;
      expect(recoveredEvidence.get(timestamp)).toBe(failedEvidence.get(timestamp));
    }
    expect(anomalyDetector.detect).toHaveBeenCalledTimes(capacity + 1);
    expect(redis.readCommands.filter(command => command.at(-1) === '>')).toHaveLength(2);
    expect(redis.acknowledged).toEqual([...failedEntries.map(([id]) => id), queuedEntry[0]]);
  });

  it('drains cached pending results behind an older uncached entry at capacity', async () => {
    const capacity = 100;
    const redis = new RecordingRedis();
    let dependenciesAvailable = false;
    const repository: TelemetryRepository = {
      store: jest.fn(async (frame: TelemetryFrame): Promise<void> => {
        if (!dependenciesAvailable && fuelPressure(frame) === 9.99) {
          throw new Error('database unavailable');
        }
      }),
    };
    const anomalyDetector = {
      detect: jest.fn((frame: TelemetryFrame): AnomalyResult => ({
        ...anomalousResult,
        evaluatedAt: frame.timestamp,
      })),
    };
    const anomalySink = jest.fn(async (): Promise<void> => {
      if (!dependenciesAvailable) throw new Error('anomaly sink unavailable');
    });
    const worker = new TelemetryWorker({
      redis,
      repository,
      broadcaster: new RecordingBroadcaster(),
      anomalyDetector,
      anomalySink,
    });
    const entry = (id: string, index: number, pressure: number): TelemetryStreamEntry => [
      id,
      ['telemetry:frame', JSON.stringify({
        schema_version: 1,
        event_type: 'telemetry.frame',
        payload: {
          timestamp: new Date(Date.parse('2026-09-10T12:00:00.000Z') + index * 1000).toISOString(),
          spacecraft_id: 'ORBITAL-X1',
          simulation_time: index,
          scenario: 'PROPULSION_LEAK',
          fuel_pressure: pressure,
        },
      })],
    ];
    const olderUncachedEntry = entry('older-uncached', 0, 9.99);
    const cachedEntries = Array.from(
      { length: capacity },
      (_, index) => entry(`cached-${index}`, index + 1, 1.5),
    );
    const freshEntry = entry('fresh', capacity + 1, 1.5);
    redis.pendingReads.push(null, [['telemetry:stream', [olderUncachedEntry]]]);
    redis.newReads.push(
      [['telemetry:stream', [olderUncachedEntry]]],
      [['telemetry:stream', cachedEntries]],
      [['telemetry:stream', [freshEntry]]],
    );

    await expect(worker.consumeOnce()).rejects.toThrow('database unavailable');
    await expect(worker.consumeOnce()).rejects.toThrow('database unavailable');
    expect(anomalyDetector.detect).toHaveBeenCalledTimes(capacity);

    dependenciesAvailable = true;
    redis.pendingReads.push([['telemetry:stream', [olderUncachedEntry, ...cachedEntries]]]);
    await worker.consumeOnce();

    expect(redis.acknowledged).toEqual([...cachedEntries.map(([id]) => id), freshEntry[0]]);
    expect(anomalyDetector.detect).toHaveBeenCalledTimes(capacity + 1);
    expect(redis.readCommands.filter(command => command.at(-1) === '>')).toHaveLength(3);

    redis.pendingReads.push([['telemetry:stream', [olderUncachedEntry]]]);
    await worker.consumeOnce();

    expect(redis.acknowledged).toEqual([
      ...cachedEntries.map(([id]) => id),
      freshEntry[0],
      olderUncachedEntry[0],
    ]);
    expect(anomalyDetector.detect).toHaveBeenCalledTimes(capacity + 2);
  });

  it.each(invalidFrames)('discards and acknowledges %s', async (_reason, fields) => {
    const redis = new RecordingRedis();
    const repository = new RecordingRepository();
    const broadcaster = new RecordingBroadcaster();
    const worker = new TelemetryWorker({ redis, repository, broadcaster });

    await worker.processEntry('invalid-0', fields);

    expect(repository.frames).toEqual([]);
    expect(broadcaster.frames).toEqual([]);
    expect(redis.acknowledged).toEqual(['invalid-0']);
  });

  it('leaves an entry pending when persistence fails', async () => {
    const redis = new RecordingRedis();
    const repository: TelemetryRepository = {
      store: async (): Promise<void> => {
        throw new Error('database unavailable');
      },
    };
    const broadcaster = new RecordingBroadcaster();
    const worker = new TelemetryWorker({ redis, repository, broadcaster });

    await expect(worker.processEntry('store-failure-0', ['telemetry:frame', validEnvelope]))
      .rejects.toThrow('database unavailable');

    expect(broadcaster.frames).toEqual([]);
    expect(redis.acknowledged).toEqual([]);
  });

  it('leaves an entry pending when broadcasting fails', async () => {
    const redis = new RecordingRedis();
    const repository = new RecordingRepository();
    const broadcaster: TelemetryBroadcaster = {
      broadcast: async (): Promise<void> => {
        throw new Error('websocket unavailable');
      },
    };
    const worker = new TelemetryWorker({ redis, repository, broadcaster });

    await expect(worker.processEntry('broadcast-failure-0', ['telemetry:frame', validEnvelope]))
      .rejects.toThrow('websocket unavailable');

    expect(repository.frames).toHaveLength(1);
    expect(redis.acknowledged).toEqual([]);
  });

  it('creates a consumer group, reads pending entries, then reads new entries through XREADGROUP', async () => {
    const redis = new RecordingRedis();
    redis.newReads.push([['telemetry:stream', [['2-0', ['telemetry:frame', validEnvelope]]]]]);
    const repository = new RecordingRepository();
    const broadcaster = new RecordingBroadcaster();
    const worker = new TelemetryWorker({ redis, repository, broadcaster, consumerId: 'test-consumer' });

    await worker.ensureGroup();
    await worker.consumeOnce();

    expect(redis.groupCommands).toEqual([
      ['CREATE', 'telemetry:stream', 'telemetry-workers', '$', 'MKSTREAM'],
    ]);
    expect(redis.readCommands).toEqual([
      ['GROUP', 'telemetry-workers', 'test-consumer', 'COUNT', 100, 'STREAMS', 'telemetry:stream', '0'],
      ['GROUP', 'telemetry-workers', 'test-consumer', 'BLOCK', 1000, 'COUNT', 100, 'STREAMS', 'telemetry:stream', '>'],
    ]);
    expect(redis.acknowledged).toEqual(['2-0']);
  });

  it('uses a stable default consumer ID so its pending entries survive a worker restart', async () => {
    const redis = new RecordingRedis();
    const worker = new TelemetryWorker({
      redis,
      repository: new RecordingRepository(),
      broadcaster: new RecordingBroadcaster(),
    });

    await worker.consumeOnce();

    expect(redis.readCommands[0]).toEqual([
      'GROUP', 'telemetry-workers', 'telemetry-worker', 'COUNT', 100, 'STREAMS', 'telemetry:stream', '0',
    ]);
  });

  it('recovers a middle failed entry and acknowledges both it and its independently processed tail', async () => {
    const redis = new RecordingRedis();
    const failedEnvelope = validEnvelope.replace('2.45', '9.99');
    const tailEnvelope = validEnvelope.replace('2.45', '7.77');
    redis.newReads.push([[
      'telemetry:stream',
      [
        ['3-0', ['telemetry:frame', validEnvelope]],
        ['4-0', ['telemetry:frame', failedEnvelope]],
        ['5-0', ['telemetry:frame', tailEnvelope]],
      ],
    ]]);
    redis.pendingReads.push(
      null,
      [['telemetry:stream', [['4-0', ['telemetry:frame', failedEnvelope]]]]],
    );
    const repository = new FailsOnceRepository();
    const broadcaster = new RecordingBroadcaster();
    const worker = new TelemetryWorker({ redis, repository, broadcaster });

    await expect(worker.consumeOnce()).rejects.toThrow('database unavailable');
    expect(redis.acknowledged).toEqual(['3-0', '5-0']);

    await worker.consumeOnce();

    expect(repository.frames.map(fuelPressure)).toEqual([2.45, 7.77, 9.99]);
    expect(redis.acknowledged).toEqual(['3-0', '5-0', '4-0']);
  });

  it('logs consumer group creation failures with stream and group context', async () => {
    const redis = new RecordingRedis();
    const groupError = new Error('redis unavailable');
    redis.groupError = groupError;
    const logError = jest.spyOn(logger, 'error').mockClear();
    const worker = new TelemetryWorker({
      redis,
      repository: new RecordingRepository(),
      broadcaster: new RecordingBroadcaster(),
      consumerId: 'test-consumer',
    });

    await expect(worker.ensureGroup()).rejects.toThrow('redis unavailable');

    expect(logError).toHaveBeenCalledWith(
      expect.objectContaining({
        err: groupError,
        stream: 'telemetry:stream',
        group: 'telemetry-workers',
        consumer: 'test-consumer',
      }),
      'Telemetry consumer group creation failed',
    );
  });

  it('does not initialize or read when stopped before consumption starts', async () => {
    const redis = new RecordingRedis();
    const worker = new TelemetryWorker({
      redis,
      repository: new RecordingRepository(),
      broadcaster: new RecordingBroadcaster(),
    });

    worker.stop();
    await worker.consume();

    expect(redis.groupCommands).toEqual([]);
    expect(redis.readCommands).toEqual([]);
  });
});
