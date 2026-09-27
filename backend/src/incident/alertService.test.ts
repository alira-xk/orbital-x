import { execFile, spawn } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Pool } from 'pg';
import { AlertService } from './alertService.js';
import { PostgresAlertRepository, PostgresIncidentRepository } from './repository.js';
import { IncidentStatus } from './types.js';
import type { AnomalyResult, Anomaly } from '../telemetry/anomalyDetection.js';
import type { TelemetryDatabase } from '../telemetry/repository.js';

const execute = promisify(execFile);
const suffix = process.platform === 'win32' ? '.exe' : '';
const time = '2026-09-14T00:00:00.000Z';
const frame = { timestamp: time, spacecraft_id: 'ORBITAL-X1', simulation_time: 0, scenario: 'PROPULSION_LEAK' };
const finding: Anomaly = { metric: 'fuel_pressure', subsystem: 'propulsion', value: 1, score: 0.8, expectedRange: '2–2.8 MPa', methods: ['rule'] };
const evidence = (overrides: Partial<AnomalyResult> = {}): AnomalyResult =>
  ({ severity: 'high', score: 0.8, evaluatedAt: time, anomalies: [finding], ...overrides });

describe('alert persistence against disposable PostgreSQL', () => {
  let pool: Pool;
  let directory: string;
  let bin: string;
  let started = false;
  let database: TelemetryDatabase;
  let service: AlertService;
  let alerts: PostgresAlertRepository;
  let incidents: PostgresIncidentRepository;

  async function control(args: string[]): Promise<void> {
    await new Promise<void>((resolveExit, reject) => {
      const child = spawn(join(bin, `pg_ctl${suffix}`), args, { windowsHide: true, stdio: 'ignore' });
      child.once('error', reject);
      child.once('exit', code => code === 0 ? resolveExit() : reject(new Error(`pg_ctl: ${code}`)));
    });
  }
  beforeAll(async () => {
    const root = join(process.env.ProgramFiles ?? 'C:/Program Files', 'PostgreSQL');
    const candidates = process.env.PG_BIN ? [process.env.PG_BIN] : [
      ...(process.env.PATH ?? '').split(delimiter),
      ...(existsSync(root) ? readdirSync(root).sort().reverse().map(version => join(root, version, 'bin')) : []),
    ];
    bin = candidates.find(path => existsSync(join(path, `initdb${suffix}`))) ?? '';
    if (!bin) throw new Error('PostgreSQL binaries required; set PG_BIN');
    directory = mkdtempSync(join(tmpdir(), 'orbital-alert-pg-'));
    const server = createServer();
    await new Promise<void>(resolveListen => server.listen(0, '127.0.0.1', resolveListen));
    const address = server.address();
    if (!address || typeof address === 'string') throw new Error('Missing port');
    await new Promise<void>(resolveClose => server.close(() => resolveClose()));
    await execute(join(bin, `initdb${suffix}`), ['-D', join(directory, 'data'), '-U', 'alert_test', '-A', 'trust', '--locale=C', '--encoding=UTF8', '--no-sync'], { windowsHide: true });
    await control(['-D', join(directory, 'data'), '-l', join(directory, 'postgres.log'), '-o', `-h 127.0.0.1 -p ${address.port} -c timezone=UTC`, '-w', 'start']);
    started = true;
    pool = new Pool({ host: '127.0.0.1', port: address.port, user: 'alert_test', database: 'postgres' });
    database = { getClient: () => pool.connect() };
    await pool.query(readFileSync(resolve(__dirname, '../../../database/init.sql'), 'utf8'));
  }, 120000);
  afterAll(async () => {
    if (pool) await pool.end();
    if (started) await control(['-D', join(directory, 'data'), '-m', 'immediate', '-w', 'stop']);
    if (directory && (dirname(resolve(directory)) !== resolve(tmpdir()) || !basename(directory).startsWith('orbital-alert-pg-'))) throw new Error('Unsafe temp path');
    if (directory) rmSync(directory, { recursive: true, force: true });
  }, 60000);
  beforeEach(async () => {
    await pool.query('TRUNCATE incident_timeline, incident_alerts, alerts, incidents, users CASCADE; ALTER SEQUENCE incident_number_seq RESTART WITH 1000');
    service = new AlertService(database);
    alerts = new PostgresAlertRepository(database);
    incidents = new PostgresIncidentRepository(database);
  });

  it('bypasses nominal evidence without acquiring a connection', async () => {
    const isolated = new AlertService({ getClient: async () => { throw new Error('must not connect'); } });
    await expect(isolated.handleEvidence(frame, evidence({ severity: 'nominal' }))).resolves.toBeUndefined();
  });
  it('persists one alert per finding with canonical migrated fingerprints and one correlated incident', async () => {
    await service.handleEvidence(frame, evidence({ anomalies: [finding, { ...finding, metric: 'fuel_flow', methods: ['rate_of_change'] }] }));
    const rows = await alerts.list({});
    expect(rows).toHaveLength(2);
    expect(rows.find(row => row.metric === 'fuel_flow')).toMatchObject({ detectionMethod: 'rate', severity: 'high', occurrenceCount: 1 });
    const canonical = await pool.query("SELECT md5(jsonb_build_array('ORBITAL-X1'::text, 'fuel_pressure'::text, 'propulsion'::text)::text) AS value");
    expect(rows.find(row => row.metric === 'fuel_pressure')?.fingerprint).toBe(canonical.rows[0].value);
    const list = await incidents.list({});
    expect(list).toHaveLength(1);
    expect(list[0]).toMatchObject({ displayNumber: 'INC-1000', alertCount: 2, affectedSubsystems: ['propulsion'] });
    const detail = await incidents.detail(list[0].id);
    expect(detail?.alerts).toHaveLength(2);
    expect(detail?.timeline).toHaveLength(2);
    expect(detail?.timeline[0]).toMatchObject({ eventType: 'created', actorId: null });
  });
  it('merges newer observations, escalates severity and score, and ignores replay without adding events', async () => {
    await service.handleEvidence(frame, evidence());
    await service.handleEvidence({ ...frame, timestamp: '2026-09-14T00:01:00Z' }, evidence({ severity: 'critical', anomalies: [{ ...finding, score: 0.95 }] }));
    await service.handleEvidence({ ...frame, timestamp: '2026-09-14T00:02:00Z' }, evidence({ severity: 'warning', anomalies: [{ ...finding, score: 0.4 }] }));
    await service.handleEvidence(frame, evidence());
    const rows = await alerts.list({});
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ occurrenceCount: 3, severity: 'critical', anomalyScore: 0.95, lastSeenAt: '2026-09-14T00:02:00.000Z' });
    const detail = await incidents.detail((await incidents.list({}))[0].id);
    expect(detail?.incident.severity).toBe('critical');
    expect(detail?.timeline.map(event => event.eventType)).toEqual(['created', 'observed_again', 'observed_again']);
  });
  it('persists alert and incident records when legacy created_at columns lack time zones', async () => {
    await pool.query(`ALTER TABLE alerts
      ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC'`);
    await pool.query(`ALTER TABLE incidents
      ALTER COLUMN created_at TYPE TIMESTAMP USING created_at AT TIME ZONE 'UTC'`);

    await service.handleEvidence(frame, evidence());

    expect(await alerts.list({})).toHaveLength(1);
    expect(await incidents.list({})).toHaveLength(1);
  });
  it('creates new alert and incident after resolution while preserving historical evidence', async () => {
    await service.handleEvidence(frame, evidence());
    const original = (await incidents.list({}))[0];
    const oldAlert = (await alerts.list({}))[0];
    await incidents.transition(original.id, IncidentStatus.OPEN, IncidentStatus.RESOLVED, null);
    await service.handleEvidence(frame, evidence());
    expect(await alerts.list({})).toHaveLength(1);
    await service.handleEvidence({ ...frame, timestamp: '2026-09-14T00:01:00Z' }, evidence());
    expect(await alerts.list({})).toHaveLength(2);
    expect((await alerts.list({ status: 'resolved' }))[0].id).toBe(oldAlert.id);
    expect((await incidents.list({ status: 'open' }))[0].displayNumber).toBe('INC-1001');
  });
  it('requires two distinct warning fingerprints and carries sorted affected subsystems', async () => {
    await service.handleEvidence(frame, evidence({ severity: 'warning' }));
    await service.handleEvidence({ ...frame, timestamp: '2026-09-14T00:01:00Z' }, evidence({ severity: 'warning' }));
    expect(await incidents.list({})).toHaveLength(0);
    await service.handleEvidence({ ...frame, timestamp: '2026-09-14T00:02:00Z' }, evidence({ severity: 'warning', anomalies: [{ ...finding, metric: 'fuel_flow', subsystem: 'power' }] }));
    expect((await incidents.list({}))[0]).toMatchObject({ alertCount: 2, affectedSubsystems: ['power', 'propulsion'] });
  });
  it('serializes concurrent same-spacecraft evidence and leaves one incident', async () => {
    await Promise.all(Array.from({ length: 4 }, () => service.handleEvidence(frame, evidence())));
    expect(await alerts.list({})).toHaveLength(1);
    expect((await alerts.list({}))[0].occurrenceCount).toBe(1);
    expect(await incidents.list({})).toHaveLength(1);
  });
  it('merges into a migration-canonical active alert and preserves its acknowledgement', async () => {
    const inserted = await pool.query(`INSERT INTO alerts(spacecraft_id, metric, subsystem, fingerprint, severity,
      status, last_seen_at, created_at, occurrence_count, anomaly_score, detection_method)
      VALUES ('ORBITAL-X1','fuel_pressure','propulsion',
        md5(jsonb_build_array('ORBITAL-X1'::text,'fuel_pressure'::text,'propulsion'::text)::text),
        'warning','acknowledged','2026-09-13T23:59:00Z','2026-09-13T23:59:00Z',4,0.5,'rule') RETURNING id`);
    await service.handleEvidence(frame, evidence());
    const stored = await alerts.list({});
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ id: inserted.rows[0].id, occurrenceCount: 5, status: 'acknowledged', severity: 'high' });
    const detail = await incidents.detail((await incidents.list({}))[0].id);
    expect(detail?.timeline.map(event => event.eventType)).toEqual(['created', 'observed_again']);
  });
  it('serializes distinct concurrent findings into the same incident', async () => {
    await Promise.all([
      service.handleEvidence(frame, evidence()),
      service.handleEvidence(frame, evidence({ anomalies: [{ ...finding, metric: 'fuel_flow' }] })),
    ]);
    const list = await incidents.list({});
    expect(list).toHaveLength(1);
    expect(list[0].alertCount).toBe(2);
  });
  it.each([['fuel_level', 'fuel_pressure'], ['fuel_pressure', 'fuel_level']])(
    'renews the existing incident before correlating same-frame findings in order %s, %s', async (first, second) => {
      await service.handleEvidence(frame, evidence());
      const original = (await incidents.list({}))[0];
      const nextFrame = { ...frame, timestamp: '2026-09-14T00:06:00Z' };
      const nextEvidence = evidence({ anomalies: [first, second].map(metric => ({ ...finding, metric })) });
      await service.handleEvidence(nextFrame, nextEvidence);
      const list = await incidents.list({});
      expect(list).toHaveLength(1);
      expect(list[0]).toMatchObject({ id: original.id, alertCount: 2, updatedAt: '2026-09-14T00:06:00.000Z' });
      const detail = await incidents.detail(original.id);
      expect(detail?.alerts.map(alert => alert.metric).sort()).toEqual(['fuel_level', 'fuel_pressure']);
      expect(detail?.alerts.find(alert => alert.metric === 'fuel_pressure')?.occurrenceCount).toBe(2);
      expect(detail?.alerts.find(alert => alert.metric === 'fuel_level')?.occurrenceCount).toBe(1);
      expect(detail?.timeline).toHaveLength(3);
      await service.handleEvidence(nextFrame, nextEvidence);
      expect(await incidents.detail(original.id)).toEqual(detail);
    },
  );
  it('links a recent unlinked warning when repeated high evidence renews its incident', async () => {
    await service.handleEvidence(frame, evidence());
    const original = (await incidents.list({}))[0];
    await service.handleEvidence({ ...frame, timestamp: '2026-09-14T00:06:00Z' }, evidence({
      severity: 'warning', anomalies: [{ ...finding, metric: 'fuel_flow', score: 0.4 }],
    }));
    expect((await incidents.detail(original.id))?.alerts).toHaveLength(1);
    const nextFrame = { ...frame, timestamp: '2026-09-14T00:07:00Z' };
    await service.handleEvidence(nextFrame, evidence());
    expect(await incidents.list({})).toHaveLength(1);
    const detail = await incidents.detail(original.id);
    expect(detail?.alerts.map(alert => alert.metric).sort()).toEqual(['fuel_flow', 'fuel_pressure']);
    expect(detail?.alerts.find(alert => alert.metric === 'fuel_flow')).toMatchObject({ severity: 'warning', occurrenceCount: 1 });
    expect(detail?.timeline).toHaveLength(2);
    expect(detail?.timeline[1].metadata?.alertIds).toEqual(detail?.alerts.map(alert => alert.id).sort());
    await service.handleEvidence(nextFrame, evidence());
    expect(await incidents.detail(original.id)).toEqual(detail);
  });
  it('keeps canonical tuples distinct when their colon-concatenated text collides', async () => {
    await service.handleEvidence({ ...frame, spacecraft_id: 'A:B' }, evidence({ anomalies: [{ ...finding, metric: 'C' }] }));
    await service.handleEvidence({ ...frame, spacecraft_id: 'A' }, evidence({ anomalies: [{ ...finding, metric: 'B:C' }] }));
    const stored = await alerts.list({});
    expect(stored).toHaveLength(2);
    expect(stored[0].fingerprint).not.toBe(stored[1].fingerprint);
  });
  it('normalizes uppercase evidence and persists ML/hybrid methods', async () => {
    await service.handleEvidence(frame, evidence({ severity: 'CRITICAL' as AnomalyResult['severity'], anomalies: [
      { ...finding, methods: ['isolation_forest'] },
      { ...finding, metric: 'fuel_flow', methods: ['rule', 'rate_of_change'] },
    ] }));
    expect((await alerts.list({ metric: 'fuel_pressure' }))[0]).toMatchObject({ severity: 'critical', detectionMethod: 'ml' });
    expect((await alerts.list({ metric: 'fuel_flow' }))[0].detectionMethod).toBe('hybrid');
  });
  it('parameterizes all filters and bounds reads', async () => {
    await service.handleEvidence(frame, evidence({ anomalies: [finding, { ...finding, metric: 'fuel_flow' }] }));
    expect(await alerts.list({ spacecraftId: "ORBITAL-X1' OR true --" })).toEqual([]);
    expect(await alerts.list({ metric: 'fuel_pressure', severity: 'high', status: 'active', subsystem: 'propulsion', from: time, to: time })).toHaveLength(1);
    expect(await alerts.list({ limit: 1 })).toHaveLength(1);
    expect(await incidents.detail('00000000-0000-0000-0000-000000000000')).toBeNull();
  });
  it('conditionally mutates status and stores immutable actor timeline and text comments', async () => {
    await service.handleEvidence(frame, evidence());
    const id = (await incidents.list({}))[0].id;
    const actor = (await pool.query("INSERT INTO users(username,email,password_hash) VALUES ('operator','operator@example.test','test-only') RETURNING id")).rows[0].id as string;
    expect(await incidents.transition(id, IncidentStatus.OPEN, IncidentStatus.ACKNOWLEDGED, actor)).toMatchObject({ status: 'acknowledged', acknowledgedBy: actor });
    expect(await incidents.transition(id, IncidentStatus.OPEN, IncidentStatus.RESOLVED, actor)).toBeNull();
    await incidents.comment(id, actor, '<b>inspect feed</b>');
    const detail = await incidents.detail(id);
    expect(detail?.timeline.map(event => event.eventType)).toEqual(['created', 'acknowledged', 'commented']);
    expect(detail?.timeline[2]).toMatchObject({ actorId: actor, description: '<b>inspect feed</b>' });
    expect(detail?.alerts[0]).toMatchObject({ status: 'acknowledged', acknowledgedBy: actor });
    expect(await incidents.transition(id, IncidentStatus.ACKNOWLEDGED, IncidentStatus.OPEN, actor)).toBeNull();
    await expect(incidents.comment(id, actor, ' ')).rejects.toThrow();
  });
  it.each(['INSERT INTO incident_timeline', 'INSERT INTO incidents', 'INSERT INTO alerts'])(
    'rolls back and rethrows a failure at %s', async failAt => {
      const failure = new Error('injected persistence failure');
      const failing: TelemetryDatabase = { async getClient() {
        const client = await pool.connect();
        return { release: () => client.release(), async query(sql, values) {
          if (sql.includes(failAt)) throw failure;
          return client.query(sql, values);
        } };
      } };
      await expect(new AlertService(failing).handleEvidence(frame, evidence())).rejects.toBe(failure);
      expect(await alerts.list({})).toEqual([]);
      expect(await incidents.list({})).toEqual([]);
      expect((await pool.query('SELECT * FROM incident_timeline')).rows).toEqual([]);
    },
  );
  it('rolls back incident and alert status if the operator timeline write fails', async () => {
    await service.handleEvidence(frame, evidence());
    const id = (await incidents.list({}))[0].id;
    const failing: TelemetryDatabase = { async getClient() {
      const client = await pool.connect();
      return { release: () => client.release(), async query(sql, values) {
        if (sql.includes('INSERT INTO incident_timeline')) throw new Error('timeline unavailable');
        return client.query(sql, values);
      } };
    } };
    await expect(new PostgresIncidentRepository(failing).transition(id, IncidentStatus.OPEN, IncidentStatus.RESOLVED, null)).rejects.toThrow('timeline unavailable');
    const detail = await incidents.detail(id);
    expect(detail?.incident.status).toBe('open');
    expect(detail?.alerts[0].status).toBe('active');
    expect(detail?.timeline).toHaveLength(1);
  });
});
