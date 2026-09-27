import request from 'supertest';
import { createApp } from '../app.js';
import type {
  LatestTelemetry,
  TelemetryHistoryQuery,
  TelemetryReading,
  TelemetryReadRepository,
} from '../telemetry/repository.js';
import { logger } from '../utils/logger.js';

const latestData = {
  fuel_pressure: {
    spacecraft_id: 'ORBITAL-X1',
    timestamp: '2026-09-10T12:00:00.000Z',
    subsystem: 'propulsion',
    metric: 'fuel_pressure',
    value: 2.45,
    unit: null,
  },
};

const historyData: TelemetryReading[] = [
  {
    spacecraft_id: 'ORBITAL-X1',
    timestamp: '2026-09-10T11:59:58.000Z',
    subsystem: 'propulsion',
    metric: 'fuel_pressure',
    value: 2.4,
    unit: null,
  },
  {
    spacecraft_id: 'ORBITAL-X1',
    timestamp: '2026-09-10T12:00:00.000Z',
    subsystem: 'propulsion',
    metric: 'fuel_pressure',
    value: 2.45,
    unit: null,
  },
];

class RecordingTelemetryRepository implements TelemetryReadRepository {
  readonly historyQueries: TelemetryHistoryQuery[] = [];
  latestResult: LatestTelemetry = latestData;
  historyResult: readonly TelemetryReading[] = historyData;
  failure: Error | undefined;

  async latest(_spacecraftId: string): Promise<LatestTelemetry> {
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return this.latestResult;
  }

  async history(query: TelemetryHistoryQuery): Promise<readonly TelemetryReading[]> {
    this.historyQueries.push(query);
    if (this.failure !== undefined) {
      throw this.failure;
    }
    return this.historyResult;
  }
}

describe('telemetry routes', () => {
  beforeAll(() => {
    jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('returns the newest value keyed by metric for a spacecraft', async () => {
    const app = createApp({ telemetryRepository: new RecordingTelemetryRepository() });

    const response = await request(app).get('/api/telemetry/latest/ORBITAL-X1');

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: latestData });
  });

  it('returns chronological history and forwards validated bounds to storage', async () => {
    const repository = new RecordingTelemetryRepository();
    const app = createApp({ telemetryRepository: repository });

    const response = await request(app)
      .get('/api/telemetry/history/ORBITAL-X1')
      .query({
        metric: 'fuel_pressure',
        from: '2026-09-10T11:59:00.000Z',
        to: '2026-09-10T12:01:00.000Z',
        limit: '1000',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: historyData });
    expect(repository.historyQueries).toEqual([{
      spacecraftId: 'ORBITAL-X1',
      metric: 'fuel_pressure',
      from: '2026-09-10T11:59:00.000Z',
      to: '2026-09-10T12:01:00.000Z',
      limit: 1000,
    }]);
  });

  it('defaults the history limit to 100', async () => {
    const repository = new RecordingTelemetryRepository();
    const app = createApp({ telemetryRepository: repository });

    const response = await request(app)
      .get('/api/telemetry/history/ORBITAL-X1')
      .query({ metric: 'fuel_pressure' });

    expect(response.status).toBe(200);
    expect(repository.historyQueries).toEqual([{
      spacecraftId: 'ORBITAL-X1',
      metric: 'fuel_pressure',
      limit: 100,
    }]);
  });

  it('forwards an allowlisted history bucket to storage', async () => {
    const repository = new RecordingTelemetryRepository();
    const app = createApp({ telemetryRepository: repository });

    const response = await request(app)
      .get('/api/telemetry/history/ORBITAL-X1')
      .query({
        metric: 'fuel_pressure',
        from: '2026-09-10T11:00:00.000Z',
        to: '2026-09-10T12:00:00.000Z',
        bucketSeconds: '300',
        limit: '500',
      });

    expect(response.status).toBe(200);
    expect(repository.historyQueries).toEqual([{
      spacecraftId: 'ORBITAL-X1',
      metric: 'fuel_pressure',
      from: '2026-09-10T11:00:00.000Z',
      to: '2026-09-10T12:00:00.000Z',
      bucketSeconds: 300,
      limit: 500,
    }]);
  });

  it.each([
    ['a missing metric', {}],
    ['a blank metric', { metric: '   ' }],
    ['an invalid from timestamp', { metric: 'fuel_pressure', from: 'yesterday' }],
    ['an invalid to timestamp', { metric: 'fuel_pressure', to: 'tomorrow' }],
    ['a zero limit', { metric: 'fuel_pressure', limit: '0' }],
    ['a limit above 1000', { metric: 'fuel_pressure', limit: '1001' }],
    ['a fractional limit', { metric: 'fuel_pressure', limit: '1.5' }],
    ['a bucket below the allowlist', { metric: 'fuel_pressure', bucketSeconds: '1' }],
    ['a bucket outside the allowlist', { metric: 'fuel_pressure', bucketSeconds: '3' }],
    ['a bucket above the allowlist', { metric: 'fuel_pressure', bucketSeconds: '301' }],
    ['a fractional bucket', { metric: 'fuel_pressure', bucketSeconds: '2.5' }],
  ])('rejects %s', async (_caseName, query) => {
    const repository = new RecordingTelemetryRepository();
    const app = createApp({ telemetryRepository: repository });

    const response = await request(app)
      .get('/api/telemetry/history/ORBITAL-X1')
      .query(query);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(repository.historyQueries).toEqual([]);
  });

  it('rejects an inverted history range', async () => {
    const repository = new RecordingTelemetryRepository();
    const app = createApp({ telemetryRepository: repository });

    const response = await request(app)
      .get('/api/telemetry/history/ORBITAL-X1')
      .query({
        metric: 'fuel_pressure',
        from: '2026-09-10T12:01:00.000Z',
        to: '2026-09-10T11:59:00.000Z',
      });

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(repository.historyQueries).toEqual([]);
  });

  it('rejects a blank spacecraft ID', async () => {
    const repository = new RecordingTelemetryRepository();
    const app = createApp({ telemetryRepository: repository });

    const response = await request(app).get('/api/telemetry/latest/%20');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('returns the standard service-unavailable response when storage is absent', async () => {
    const app = createApp();

    const response = await request(app).get('/api/telemetry/latest/ORBITAL-X1');

    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Telemetry storage is unavailable',
    });
  });

  it('returns the standard service-unavailable response when a storage read fails', async () => {
    const repository = new RecordingTelemetryRepository();
    repository.failure = new Error('database unavailable');
    const app = createApp({ telemetryRepository: repository });

    const response = await request(app)
      .get('/api/telemetry/history/ORBITAL-X1')
      .query({ metric: 'fuel_pressure' });

    expect(response.status).toBe(503);
    expect(response.body.error).toEqual({
      code: 'SERVICE_UNAVAILABLE',
      message: 'Telemetry storage is unavailable',
    });
  });
});
