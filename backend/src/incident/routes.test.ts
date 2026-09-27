import request from 'supertest';
import { createApp } from '../app.js';
import type { AuthService } from '../auth/service.js';
import type { AlertListQuery, AlertRepository, IncidentDetail, IncidentListQuery, IncidentRepository, IncidentSummary } from './repository.js';
import { AlertSeverity, AlertStatus, IncidentStatus, type AlertRecord, type IncidentRecord, type TimelineEvent } from './types.js';
import { UnauthorizedError } from '../utils/errors.js';
import { logger } from '../utils/logger.js';

const actor = { id: '00000000-0000-4000-8000-000000000099', username: 'operator', role: 'operator' };
const incidentId = '00000000-0000-4000-8000-000000000010';

const alert: AlertRecord = {
  id: '00000000-0000-4000-8000-000000000020',
  spacecraftId: 'ORBITAL-X1',
  subsystem: 'propulsion',
  severity: AlertSeverity.CRITICAL,
  metric: 'fuel_pressure',
  value: 1.7,
  expectedRange: '2-2.8 MPa',
  anomalyScore: 0.94,
  detectionMethod: 'hybrid',
  fingerprint: 'fingerprint',
  occurrenceCount: 2,
  status: AlertStatus.ACTIVE,
  createdAt: '2026-09-17T09:00:00.000Z',
  lastSeenAt: '2026-09-17T09:01:00.000Z',
  acknowledgedAt: null,
  acknowledgedBy: null,
  resolvedAt: null,
  resolvedBy: null,
  updatedAt: '2026-09-17T09:01:00.000Z',
};

const incident: IncidentRecord = {
  id: incidentId,
  incidentNumber: 1000,
  displayNumber: 'INC-1000',
  spacecraftId: 'ORBITAL-X1',
  title: 'propulsion: fuel_pressure',
  description: null,
  severity: AlertSeverity.CRITICAL,
  status: IncidentStatus.OPEN,
  rootCause: null,
  affectedSubsystems: ['propulsion'],
  createdAt: '2026-09-17T09:00:00.000Z',
  acknowledgedAt: null,
  acknowledgedBy: null,
  resolvedAt: null,
  resolvedBy: null,
  updatedAt: '2026-09-17T09:01:00.000Z',
};

const timeline: TimelineEvent[] = [
  {
    id: 1,
    incidentId,
    actorId: null,
    eventType: 'created',
    description: 'Created alert for fuel_pressure',
    metadata: { alertId: alert.id },
    timestamp: '2026-09-17T09:00:00.000Z',
  },
  {
    id: 2,
    incidentId,
    actorId: actor.id,
    eventType: 'commented',
    description: 'Inspect the pressure feed',
    metadata: null,
    timestamp: '2026-09-17T09:02:00.000Z',
  },
];

class RecordingAlertRepository implements AlertRepository {
  readonly queries: AlertListQuery[] = [];
  result: AlertRecord[] = [alert];
  failure: Error | undefined;

  async list(query: AlertListQuery): Promise<AlertRecord[]> {
    this.queries.push(query);
    if (this.failure) throw this.failure;
    return this.result;
  }
}

class RecordingIncidentRepository implements IncidentRepository {
  readonly listQueries: IncidentListQuery[] = [];
  readonly detailCalls: Array<{ id: string; limit?: number }> = [];
  readonly transitionCalls: Array<{ id: string; expectedStatus: IncidentStatus; status: IncidentStatus; actorId: string | null }> = [];
  readonly commentCalls: Array<{ id: string; actorId: string | null; description: string }> = [];
  listResult: IncidentSummary[] = [{ ...incident, alertCount: 1 }];
  detailResult: IncidentDetail | null = { incident, alerts: [alert], timeline };
  transitionResult: IncidentRecord | null = incident;
  commentResult: TimelineEvent | null = timeline[1];
  failure: Error | undefined;
  replayCalls: string[] = [];
  replayResult: import('./repository.js').IncidentReplay = {
    incident,
    window: { from: '2026-09-17T08:59:30.000Z', to: '2026-09-17T09:01:00.000Z' },
    frames: [{ timestamp: '2026-09-17T09:00:00.000Z', spacecraft_id: 'ORBITAL-X1', simulation_time: 30, scenario: 'RECORDED_REPLAY', fuel_pressure: 1.7 }],
    markers: [{ id: 'timeline:1', timestamp: timeline[0].timestamp, kind: 'timeline', label: timeline[0].description, severity: null }],
  };

  async replay(id: string): Promise<import('./repository.js').IncidentReplay | null> {
    this.replayCalls.push(id);
    if (this.failure) throw this.failure;
    return this.replayResult;
  }

  async list(query: IncidentListQuery): Promise<IncidentSummary[]> {
    this.listQueries.push(query);
    if (this.failure) throw this.failure;
    return this.listResult;
  }

  async detail(id: string, limit?: number): Promise<IncidentDetail | null> {
    this.detailCalls.push({ id, limit });
    if (this.failure) throw this.failure;
    return this.detailResult;
  }

  async transition(id: string, expectedStatus: IncidentStatus, status: IncidentStatus, actorId: string | null): Promise<IncidentRecord | null> {
    this.transitionCalls.push({ id, expectedStatus, status, actorId });
    if (this.failure) throw this.failure;
    return this.transitionResult;
  }

  async comment(id: string, actorId: string | null, description: string): Promise<TimelineEvent | null> {
    this.commentCalls.push({ id, actorId, description });
    if (this.failure) throw this.failure;
    return this.commentResult;
  }
}

function authService(): AuthService {
  return {
    me: async (token: string | undefined) => {
      if (token !== 'valid-access-token') throw new UnauthorizedError('Invalid or expired authentication token');
      return actor;
    },
  } as AuthService;
}

describe('alert and incident routes', () => {
  it('returns a bounded chronological replay for an incident', async () => {
    const incidents = new RecordingIncidentRepository();
    const response = await request(createApp({ incidentRepository: incidents }))
      .get(`/api/incidents/${incidentId}/replay`);

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: incidents.replayResult });
    expect(incidents.replayCalls).toEqual([incidentId]);
  });
  beforeAll(() => {
    jest.spyOn(logger, 'info').mockImplementation(() => undefined);
    jest.spyOn(logger, 'warn').mockImplementation(() => undefined);
    jest.spyOn(logger, 'error').mockImplementation(() => undefined);
  });

  afterAll(() => {
    jest.restoreAllMocks();
  });

  it('returns alert records and forwards every validated bounded filter', async () => {
    const alerts = new RecordingAlertRepository();
    const response = await request(createApp({ alertRepository: alerts }))
      .get('/api/alerts')
      .query({
        spacecraftId: 'ORBITAL-X1', status: 'active', severity: 'critical', subsystem: 'propulsion',
        metric: 'fuel_pressure', from: '2026-09-17T08:00:00.000Z', to: '2026-09-17T10:00:00.000Z',
        limit: '50', offset: '10',
      });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: [alert] });
    expect(alerts.queries).toEqual([{
      spacecraftId: 'ORBITAL-X1', status: 'active', severity: 'critical', subsystem: 'propulsion',
      metric: 'fuel_pressure', from: '2026-09-17T08:00:00.000Z', to: '2026-09-17T10:00:00.000Z',
      limit: 50, offset: 10,
    }]);
  });

  it('defaults list bounds and returns incident alert counts', async () => {
    const alerts = new RecordingAlertRepository();
    const incidents = new RecordingIncidentRepository();
    const app = createApp({ alertRepository: alerts, incidentRepository: incidents });

    const [alertResponse, incidentResponse] = await Promise.all([
      request(app).get('/api/alerts'),
      request(app).get('/api/incidents').query({ spacecraftId: 'ORBITAL-X1', status: 'open', severity: 'critical' }),
    ]);

    expect(alertResponse.status).toBe(200);
    expect(incidentResponse.status).toBe(200);
    expect(incidentResponse.body).toEqual({ success: true, data: [{ ...incident, alertCount: 1 }] });
    expect(alerts.queries).toEqual([{ limit: 100, offset: 0 }]);
    expect(incidents.listQueries).toEqual([{
      spacecraftId: 'ORBITAL-X1', status: 'open', severity: 'critical', limit: 100, offset: 0,
    }]);
  });

  it('returns bounded incident details without changing chronological timeline order', async () => {
    const incidents = new RecordingIncidentRepository();
    const response = await request(createApp({ incidentRepository: incidents }))
      .get(`/api/incidents/${incidentId}`)
      .query({ limit: '25' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: { incident, alerts: [alert], timeline } });
    expect(response.body.data.timeline.map((event: TimelineEvent) => event.id)).toEqual([1, 2]);
    expect(incidents.detailCalls).toEqual([{ id: incidentId, limit: 25 }]);
  });

  it.each([
    ['/api/alerts?limit=1001'],
    ['/api/alerts?offset=-1'],
    ['/api/alerts?status=unknown'],
    ['/api/alerts?severity=emergency'],
    ['/api/alerts?from=tomorrow'],
    ['/api/alerts?from=2026-09-17T10:00:00.000Z&to=2026-09-17T09:00:00.000Z'],
    ['/api/incidents?limit=0'],
    ['/api/incidents?status=active'],
    [`/api/incidents/${incidentId}?limit=1001`],
    ['/api/incidents/not-a-uuid'],
  ])('rejects invalid read request %s before repository access', async (path) => {
    const alerts = new RecordingAlertRepository();
    const incidents = new RecordingIncidentRepository();
    const response = await request(createApp({ alertRepository: alerts, incidentRepository: incidents })).get(path);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(alerts.queries).toEqual([]);
    expect(incidents.listQueries).toEqual([]);
    expect(incidents.detailCalls).toEqual([]);
  });

  it('returns structured not-found and service-unavailable read errors', async () => {
    const missing = new RecordingIncidentRepository();
    missing.detailResult = null;
    const unavailable = new RecordingAlertRepository();
    unavailable.failure = new Error('database credentials must not leak');

    const missingResponse = await request(createApp({ incidentRepository: missing })).get(`/api/incidents/${incidentId}`);
    const unavailableResponse = await request(createApp({ alertRepository: unavailable })).get('/api/alerts');
    const absentResponse = await request(createApp()).get('/api/incidents');

    expect(missingResponse.status).toBe(404);
    expect(missingResponse.body.error).toMatchObject({ code: 'NOT_FOUND', message: 'Incident not found' });
    expect(unavailableResponse.status).toBe(503);
    expect(unavailableResponse.body.error).toEqual(expect.objectContaining({
      code: 'SERVICE_UNAVAILABLE', message: 'Alert storage is unavailable',
    }));
    expect(absentResponse.status).toBe(503);
    expect(absentResponse.body.error.code).toBe('SERVICE_UNAVAILABLE');
    expect(JSON.stringify(unavailableResponse.body)).not.toContain('credentials');
  });

  it.each([
    ['acknowledge', { expectedStatus: 'open' }],
    ['status', { expectedStatus: 'open', status: 'investigating' }],
    ['comments', { comment: 'Inspect pressure feed' }],
    ['resolve', { expectedStatus: 'open' }],
  ])('requires authentication for POST /:id/%s', async (operation, body) => {
    const incidents = new RecordingIncidentRepository();
    const response = await request(createApp({ incidentRepository: incidents, authService: authService() }))
      .post(`/api/incidents/${incidentId}/${operation}`)
      .send(body);

    expect(response.status).toBe(401);
    expect(response.body.error.code).toBe('UNAUTHORIZED');
    expect(incidents.transitionCalls).toEqual([]);
    expect(incidents.commentCalls).toEqual([]);
  });

  it('persists the authenticated actor for acknowledge, status, and resolve transitions', async () => {
    const incidents = new RecordingIncidentRepository();
    incidents.transitionResult = { ...incident, status: IncidentStatus.ACKNOWLEDGED };
    const app = createApp({ incidentRepository: incidents, authService: authService() });
    const authenticated = (path: string, body: object) => request(app)
      .post(`/api/incidents/${incidentId}/${path}`)
      .set('Cookie', 'access_token=valid-access-token')
      .send(body);

    const acknowledgeResponse = await authenticated('acknowledge', { expectedStatus: 'open' });
    incidents.transitionResult = { ...incident, status: IncidentStatus.INVESTIGATING };
    const statusResponse = await authenticated('status', { expectedStatus: 'acknowledged', status: 'investigating' });
    incidents.transitionResult = { ...incident, status: IncidentStatus.RESOLVED };
    const resolveResponse = await authenticated('resolve', { expectedStatus: 'investigating' });

    expect([acknowledgeResponse.status, statusResponse.status, resolveResponse.status]).toEqual([200, 200, 200]);
    expect(incidents.transitionCalls).toEqual([
      { id: incidentId, expectedStatus: IncidentStatus.OPEN, status: IncidentStatus.ACKNOWLEDGED, actorId: actor.id },
      { id: incidentId, expectedStatus: IncidentStatus.ACKNOWLEDGED, status: IncidentStatus.INVESTIGATING, actorId: actor.id },
      { id: incidentId, expectedStatus: IncidentStatus.INVESTIGATING, status: IncidentStatus.RESOLVED, actorId: actor.id },
    ]);
  });

  it('returns conflict for a stale or invalid transition and not-found for a missing incident', async () => {
    const conflicting = new RecordingIncidentRepository();
    conflicting.transitionResult = null;
    const missing = new RecordingIncidentRepository();
    missing.transitionResult = null;
    missing.detailResult = null;
    const mutation = (repository: RecordingIncidentRepository) => request(createApp({
      incidentRepository: repository, authService: authService(),
    })).post(`/api/incidents/${incidentId}/status`)
      .set('Cookie', 'access_token=valid-access-token')
      .send({ expectedStatus: 'open', status: 'reopened' });

    const conflictResponse = await mutation(conflicting);
    const missingResponse = await mutation(missing);

    expect(conflictResponse.status).toBe(409);
    expect(conflictResponse.body.error.code).toBe('CONFLICT');
    expect(missingResponse.status).toBe(404);
    expect(missingResponse.body.error.code).toBe('NOT_FOUND');
  });

  it('trims and persists a text comment with the authenticated actor', async () => {
    const incidents = new RecordingIncidentRepository();
    const response = await request(createApp({ incidentRepository: incidents, authService: authService() }))
      .post(`/api/incidents/${incidentId}/comments`)
      .set('Cookie', 'access_token=valid-access-token')
      .send({ comment: '  <b>Inspect pressure feed</b>  ' });

    expect(response.status).toBe(200);
    expect(response.body).toEqual({ success: true, data: timeline[1] });
    expect(incidents.commentCalls).toEqual([{
      id: incidentId, actorId: actor.id, description: '<b>Inspect pressure feed</b>',
    }]);
  });

  it.each([
    [{ comment: ' ' }],
    [{ comment: 'x'.repeat(2001) }],
    [{ description: 'wrong field' }],
  ])('rejects an invalid comment body before repository access', async (body) => {
    const incidents = new RecordingIncidentRepository();
    const response = await request(createApp({ incidentRepository: incidents, authService: authService() }))
      .post(`/api/incidents/${incidentId}/comments`)
      .set('Cookie', 'access_token=valid-access-token')
      .send(body);

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
    expect(incidents.commentCalls).toEqual([]);
  });

  it('returns a structured validation error for malformed JSON', async () => {
    const response = await request(createApp({ incidentRepository: new RecordingIncidentRepository(), authService: authService() }))
      .post(`/api/incidents/${incidentId}/comments`)
      .set('Cookie', 'access_token=valid-access-token')
      .set('Content-Type', 'application/json')
      .send('{');

    expect(response.status).toBe(400);
    expect(response.body.error.code).toBe('VALIDATION_ERROR');
  });

  it('maps mutation repository failures to a structured service-unavailable response', async () => {
    const incidents = new RecordingIncidentRepository();
    incidents.failure = new Error('database unavailable');
    const response = await request(createApp({ incidentRepository: incidents, authService: authService() }))
      .post(`/api/incidents/${incidentId}/acknowledge`)
      .set('Cookie', 'access_token=valid-access-token')
      .send({ expectedStatus: 'open' });

    expect(response.status).toBe(503);
    expect(response.body.error).toEqual(expect.objectContaining({
      code: 'SERVICE_UNAVAILABLE', message: 'Incident storage is unavailable',
    }));
  });
});
