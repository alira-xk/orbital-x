const mockInitializeDatabase = jest.fn<Promise<void>, []>();
const mockInitializeRedis = jest.fn<Promise<void>, []>();
const mockListen = jest.fn((_port: number, callback: () => void): void => callback());
const mockCloseHttp = jest.fn((callback: (error?: Error) => void): void => callback());
const mockHttpServer = {
  listening: true,
  listen: mockListen,
  close: mockCloseHttp,
};
const mockCreateServer = jest.fn(() => mockHttpServer);
const mockBroadcaster = {
  broadcast: jest.fn<Promise<void>, [unknown]>().mockResolvedValue(undefined),
  close: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
};
const mockAttachBroadcaster = jest.fn(() => mockBroadcaster);
const mockConsume = jest.fn<Promise<void>, []>().mockResolvedValue(undefined);
const mockWorkerStop = jest.fn<void, []>();
const mockTelemetryWorker = jest.fn((_dependencies: unknown) => ({ consume: mockConsume, stop: mockWorkerStop }));
const mockRepository = { store: jest.fn() };
const mockPostgresTelemetryRepository = jest.fn(() => mockRepository);
const mockAlertRepository = { list: jest.fn() };
const mockIncidentRepository = { list: jest.fn(), detail: jest.fn(), transition: jest.fn(), comment: jest.fn() };
const mockAuthRepository = { findByLogin: jest.fn(), findById: jest.fn(), createSession: jest.fn(), rotateSession: jest.fn() };
const mockPostgresAlertRepository = jest.fn(() => mockAlertRepository);
const mockPostgresIncidentRepository = jest.fn(() => mockIncidentRepository);
const mockPostgresAuthRepository = jest.fn(() => mockAuthRepository);
const mockAuthServiceInstance = { me: jest.fn() };
const mockAuthService = jest.fn(() => mockAuthServiceInstance);
const mockHandleEvidence = jest.fn<Promise<void>, [TelemetryFrame, AnomalyResult]>().mockResolvedValue(undefined);
const mockAlertService = jest.fn(() => ({ handleEvidence: mockHandleEvidence }));
const mockCreateApp = jest.fn(() => ({ listen: mockListen }));
const mockWorkerRedis = {
  quit: jest.fn<Promise<'OK'>, []>().mockResolvedValue('OK'),
};
const mockRedis = {
  status: 'ready',
  quit: jest.fn<Promise<'OK'>, []>().mockResolvedValue('OK'),
  disconnect: jest.fn<void, []>(),
  duplicate: jest.fn(() => mockWorkerRedis),
};
const mockPool = {
  end: jest.fn<Promise<void>, []>().mockResolvedValue(undefined),
};
const mockLogger = {
  info: jest.fn(),
  warn: jest.fn(),
  error: jest.fn(),
};

jest.mock('node:http', () => ({ createServer: mockCreateServer }));
jest.mock('./app.js', () => ({ createApp: mockCreateApp }));
jest.mock('./config/index.js', () => ({
  config: {
    port: 3000,
    nodeEnv: 'test',
    telemetry: {
      streamName: 'telemetry:stream',
      consumerGroup: 'telemetry-workers',
      consumerId: 'telemetry-worker',
      websocketPath: '/ws',
    },
    commands: {
      streamName: 'commands:stream',
      resultStreamName: 'command-results:stream',
      resultGroup: 'backend-command-results',
    },
  },
}));
jest.mock('./config/database.js', () => ({
  db: { getClient: jest.fn() },
  initializeDatabase: mockInitializeDatabase,
  pool: mockPool,
}));
jest.mock('./config/redis.js', () => ({
  initializeRedis: mockInitializeRedis,
  redis: mockRedis,
}));
jest.mock('./telemetry/broadcaster.js', () => ({
  attachTelemetryWebSocketServer: mockAttachBroadcaster,
}));
jest.mock('./telemetry/repository.js', () => ({
  PostgresTelemetryRepository: mockPostgresTelemetryRepository,
}));
jest.mock('./incident/repository.js', () => ({
  PostgresAlertRepository: mockPostgresAlertRepository,
  PostgresIncidentRepository: mockPostgresIncidentRepository,
}));
jest.mock('./incident/alertService.js', () => ({ AlertService: mockAlertService }));
jest.mock('./auth/repository.js', () => ({ PostgresAuthRepository: mockPostgresAuthRepository }));
jest.mock('./auth/service.js', () => ({ AuthService: mockAuthService }));
jest.mock('./workers/telemetry-worker.js', () => ({ TelemetryWorker: mockTelemetryWorker }));
jest.mock('./utils/logger.js', () => ({ logger: mockLogger }));

import { startBackend } from './index.js';
import { StreamingAnomalyDetector, type AnomalyResult } from './telemetry/anomalyDetection.js';
import type { TelemetryFrame } from './telemetry/schema.js';

function createDeferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
} {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((deferredResolve) => {
    resolve = deferredResolve;
  });
  return { promise, resolve };
}

describe('backend lifecycle', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockInitializeDatabase.mockResolvedValue(undefined);
    mockInitializeRedis.mockResolvedValue(undefined);
    mockConsume.mockResolvedValue(undefined);
    mockBroadcaster.close.mockResolvedValue(undefined);
    mockRedis.status = 'ready';
    mockRedis.quit.mockResolvedValue('OK');
    mockRedis.duplicate.mockReturnValue(mockWorkerRedis);
    mockWorkerRedis.quit.mockResolvedValue('OK');
    mockPool.end.mockResolvedValue(undefined);
    mockHandleEvidence.mockResolvedValue(undefined);
  });

  it('starts HTTP and WebSocket fail-soft without creating a worker when services are unavailable', async () => {
    mockInitializeDatabase.mockRejectedValue(new Error('postgres unavailable'));
    mockInitializeRedis.mockRejectedValue(new Error('redis unavailable'));

    const runtime = await startBackend();

    expect(mockCreateApp).toHaveBeenCalledWith({
      telemetryRepository: undefined,
      alertRepository: undefined,
      incidentRepository: undefined,
      investigationClient: expect.any(Object),
      authService: undefined,
    });
    expect(mockCreateServer).toHaveBeenCalledTimes(1);
    expect(mockAttachBroadcaster).toHaveBeenCalledWith(mockHttpServer, '/ws');
    expect(mockListen).toHaveBeenCalledWith(3000, expect.any(Function));
    expect(mockTelemetryWorker).not.toHaveBeenCalled();
    expect(mockRedis.disconnect).toHaveBeenCalledTimes(1);

    await runtime.close();
  });

  it('shares one database-backed alert service with the worker evidence sink and injects HTTP repositories', async () => {
    const runtime = await startBackend();

    expect(mockPostgresTelemetryRepository).toHaveBeenCalledTimes(1);
    expect(mockPostgresAlertRepository).toHaveBeenCalledTimes(1);
    expect(mockPostgresIncidentRepository).toHaveBeenCalledTimes(1);
    expect(mockPostgresAuthRepository).toHaveBeenCalledTimes(1);
    expect(mockAuthService).toHaveBeenCalledTimes(1);
    expect(mockAlertService).toHaveBeenCalledTimes(1);
    expect(mockCreateApp).toHaveBeenCalledWith({
      telemetryRepository: mockRepository,
      alertRepository: mockAlertRepository,
      incidentRepository: mockIncidentRepository,
      investigationClient: expect.any(Object),
      authService: mockAuthServiceInstance,
      commandService: expect.any(Object),
      commandDispatcher: expect.any(Object),
    });
    expect(mockInitializeRedis).toHaveBeenCalledTimes(1);
    expect(mockRedis.duplicate).toHaveBeenCalledTimes(2);
    expect(mockTelemetryWorker).toHaveBeenCalledTimes(1);
    expect(mockTelemetryWorker).toHaveBeenCalledWith(expect.objectContaining({
      redis: mockWorkerRedis,
      repository: mockRepository,
      broadcaster: mockBroadcaster,
      streamName: 'telemetry:stream',
      consumerGroup: 'telemetry-workers',
      consumerId: 'telemetry-worker',
    }));
    const workerDependencies = mockTelemetryWorker.mock.calls[0][0] as {
      anomalyDetector?: unknown;
      anomalySink?: (frame: TelemetryFrame, result: AnomalyResult) => Promise<void>;
    };
    expect(workerDependencies.anomalyDetector).toBeInstanceOf(StreamingAnomalyDetector);
    expect(workerDependencies.anomalySink).toEqual(expect.any(Function));

    const frame: TelemetryFrame = {
      timestamp: '2026-09-13T16:35:15.000Z',
      spacecraft_id: 'ORBITAL-X1',
      simulation_time: 35,
      scenario: 'PROPULSION_LEAK',
    };
    const result: AnomalyResult = {
      score: 0.9,
      severity: 'critical',
      evaluatedAt: frame.timestamp,
      anomalies: [{
        metric: 'fuel_pressure',
        subsystem: 'propulsion',
        value: 1.7,
        score: 0.9,
        expectedRange: '2–2.8 MPa',
        methods: ['rule', 'rate_of_change'],
      }],
    };
    await workerDependencies.anomalySink?.(frame, result);
    await workerDependencies.anomalySink?.(frame, result);
    expect(mockHandleEvidence).toHaveBeenNthCalledWith(1, frame, result);
    expect(mockHandleEvidence).toHaveBeenNthCalledWith(2, frame, result);
    expect(mockConsume).toHaveBeenCalledTimes(1);

    await runtime.close();
    expect(mockWorkerStop).toHaveBeenCalledTimes(1);
  });

  it('closes the dedicated worker Redis connection during shutdown', async () => {
    const runtime = await startBackend();

    await runtime.close();

    expect(mockWorkerRedis.quit).toHaveBeenCalledTimes(2);
  });

  it('waits for in-flight consumption to settle before closing worker dependencies', async () => {
    const consumption = createDeferred<void>();
    mockConsume.mockReturnValue(consumption.promise);
    const runtime = await startBackend();

    const closePromise = runtime.close();

    try {
      expect(mockWorkerStop).toHaveBeenCalledTimes(1);
      expect(mockBroadcaster.close).not.toHaveBeenCalled();
      expect(mockCloseHttp).not.toHaveBeenCalled();
      expect(mockRedis.quit).not.toHaveBeenCalled();
      expect(mockPool.end).not.toHaveBeenCalled();
    } finally {
      consumption.resolve();
      await closePromise;
    }

    expect(mockBroadcaster.close).toHaveBeenCalledTimes(1);
    expect(mockCloseHttp).toHaveBeenCalledTimes(1);
    expect(mockRedis.quit).toHaveBeenCalledTimes(1);
    expect(mockPool.end).toHaveBeenCalledTimes(1);
  });
});
