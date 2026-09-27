import { execFile, spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { basename, delimiter, dirname, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { Client } from 'pg';
import {
  INCIDENT_MANAGEMENT_REPAIR_MIGRATION,
  INCIDENT_MANAGEMENT_SCHEMA_MIGRATION,
  migrateIncidentManagementRepairs,
  migrateIncidentManagementSchema,
  type IncidentManagementMigrationClient,
} from './databaseMigration.js';

const execute = promisify(execFile);
const binarySuffix = process.platform === 'win32' ? '.exe' : '';
const uuid = (number: number): string => `00000000-0000-0000-0000-${String(number).padStart(12, '0')}`;
// Independent encoding oracle for PostgreSQL's JSONB text representation.
const fingerprintFor = (spacecraft: string, metric: string | null, subsystem: string | null): string =>
  createHash('md5').update(`[${[spacecraft, metric, subsystem].map(value => JSON.stringify(value)).join(', ')}]`).digest('hex');
const canonicalFingerprint = fingerprintFor('ORBITAL-X1', 'fuel_pressure', 'propulsion');
const legacyCanonicalFingerprint = '960ef22968814f5c36d8dc79851b9eab';

function postgresBin(): string {
  const windowsRoot = join(process.env.ProgramFiles ?? 'C:/Program Files', 'PostgreSQL');
  const installed = existsSync(windowsRoot)
    ? readdirSync(windowsRoot).sort().reverse().map(version => join(windowsRoot, version, 'bin'))
    : [];
  const candidates = process.env.PG_BIN
    ? [process.env.PG_BIN]
    : [...(process.env.PATH ?? '').split(delimiter), ...installed];
  const directory = candidates.find(candidate =>
    existsSync(join(candidate, `initdb${binarySuffix}`)) && existsSync(join(candidate, `pg_ctl${binarySuffix}`)));
  if (!directory) throw new Error('PostgreSQL integration tests require initdb and pg_ctl on PATH, or PG_BIN pointing to their directory.');
  return directory;
}

async function unusedPort(): Promise<number> {
  const server = createServer();
  await new Promise<void>((resolvePort, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', resolvePort);
  });
  const address = server.address();
  if (!address || typeof address === 'string') throw new Error('Expected a TCP port');
  await new Promise<void>((resolveClose, reject) => server.close(error => error ? reject(error) : resolveClose()));
  return address.port;
}

// pg_ctl's server child can inherit pipe handles on Windows. Waiting for the
// launcher's exit with ignored stdio avoids waiting for the server to exit too.
async function controlServer(bin: string, args: string[]): Promise<void> {
  await new Promise<void>((resolveExit, reject) => {
    const child = spawn(join(bin, `pg_ctl${binarySuffix}`), args, { windowsHide: true, stdio: 'ignore' });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolveExit() : reject(new Error(`pg_ctl exited with code ${code}`)));
  });
}

// No existing server or application credentials are used. Each suite owns one
// temporary cluster. PG_BIN makes this runnable on Linux/macOS and in CI too.
describe('incident migrations against PostgreSQL', () => {
  let directory: string;
  let bin: string;
  let started = false;
  let database: Client;
  let client: IncidentManagementMigrationClient;
  const calls: string[] = [];

  beforeAll(async () => {
    bin = postgresBin();
    directory = mkdtempSync(join(tmpdir(), 'orbital-incident-pg-'));
    const port = await unusedPort();
    await execute(join(bin, `initdb${binarySuffix}`), [
      '-D', join(directory, 'data'), '-U', 'migration_test', '-A', 'trust', '--locale=C', '--encoding=UTF8',
      '--no-sync', // This disposable cluster does not need durable initialization.
    ], { windowsHide: true, timeout: 90000 });
    const socketOption = process.platform === 'win32' ? '' : ` -c unix_socket_directories=${directory}`;
    await controlServer(bin, [
      '-D', join(directory, 'data'), '-l', join(directory, 'postgres.log'),
      '-o', `-h 127.0.0.1 -p ${port} -c timezone=UTC${socketOption}`, '-w', 'start',
    ]);
    started = true;
    database = new Client({ host: '127.0.0.1', port, user: 'migration_test', database: 'postgres' });
    await database.connect();
    client = {
      async query(text, values) {
        calls.push(text);
        return database.query(text, values ? [...values] : undefined);
      },
    };
    await database.query('CREATE EXTENSION "uuid-ossp"; CREATE EXTENSION pgcrypto');
  }, 120000);

  afterAll(async () => {
    if (database) await database.end();
    if (started) {
      await controlServer(bin, [
        '-D', join(directory, 'data'), '-m', 'immediate', '-w', 'stop',
      ]);
    }
    if (directory && (dirname(resolve(directory)) !== resolve(tmpdir())
      || !basename(directory).startsWith('orbital-incident-pg-'))) {
      throw new Error('Refusing to remove a cluster outside the temporary directory');
    }
    if (directory) rmSync(directory, { recursive: true, force: true });
  }, 60000);

  beforeEach(async () => {
    await database.query('DROP SCHEMA IF EXISTS migration_test CASCADE; CREATE SCHEMA migration_test; SET search_path TO migration_test, public');
    await database.query(readFileSync(resolve(__dirname, '../../../database/init.sql'), 'utf8'));
    await database.query('CREATE TABLE migrations (name TEXT PRIMARY KEY)');
    calls.length = 0;
  });

  async function legacyFixture(): Promise<void> {
    await database.query('INSERT INTO migrations(name) VALUES ($1)', [INCIDENT_MANAGEMENT_SCHEMA_MIGRATION]);
    await database.query(`
      ALTER TABLE alerts ALTER COLUMN last_seen_at DROP DEFAULT;
      ALTER TABLE incidents ALTER COLUMN title DROP NOT NULL;
      ALTER TABLE incident_timeline ALTER COLUMN timestamp TYPE TIMESTAMP USING timestamp AT TIME ZONE 'UTC';
    `);
    await database.query(`INSERT INTO users(id, email, username, password_hash) VALUES ($1, 'operator@example.test', 'operator', 'test-only')`, [uuid(90)]);
    await database.query(`INSERT INTO incidents(id, title) VALUES ($1, NULL), ($2, ''), ($3, 'Keep title')`, [uuid(10), uuid(11), uuid(12)]);
    // The canonical and suffixed values coexist legally under the OLD partial
    // unique index. The first two dates tie, exercising the deterministic ID tie-break.
    const alerts = [
      [1, 'ORBITAL-X1', 'fuel_pressure', 'acknowledged', 'warning', 0.4, 2, 1, 10, legacyCanonicalFingerprint],
      [2, 'ORBITAL-X1', 'fuel_pressure', 'active', 'critical', 0.9, 3, 1, 20, `${legacyCanonicalFingerprint}:legacy:2`],
      [3, 'ORBITAL-X1', 'fuel_pressure', 'acknowledged', 'high', 0.95, 4, 2, 30, `${legacyCanonicalFingerprint}:legacy:3`],
      [4, 'ORBITAL-X1', 'fuel_pressure', 'resolved', 'info', 0.1, 9, 0, 5, 'resolved-legacy'],
      [5, 'ORBITAL-X2', 'fuel_pressure', 'active', 'warning', 0.3, 1, 3, 7, 'other-craft-legacy'],
      [6, 'ORBITAL-X1', 'fuel_flow', 'acknowledged', 'high', 0.8, 6, 4, 8, 'other-metric-legacy'],
    ];
    for (const [id, ...values] of alerts) {
      await database.query(`
        INSERT INTO alerts(id, spacecraft_id, metric, status, severity, anomaly_score,
          occurrence_count, created_at, last_seen_at, fingerprint, subsystem)
        VALUES ($1, $2, $3, $4, $5, $6, $7, to_timestamp($8), to_timestamp($9), $10, 'propulsion')
      `, [uuid(Number(id)), ...values]);
    }
    await database.query(`
      UPDATE alerts SET acknowledged_at = to_timestamp(12), acknowledged_by = $1 WHERE id = $2;
    `, [uuid(90), uuid(3)]);
    await database.query(`UPDATE alerts SET resolved_at = to_timestamp(4), resolved_by = $1 WHERE id = $2`, [uuid(90), uuid(4)]);
    // One overlapping link, one incident linked ONLY to a duplicate, plus history.
    for (const [incident, alert] of [[10, 1], [10, 2], [11, 2], [11, 3], [12, 4], [12, 5], [12, 6]]) {
      await database.query('INSERT INTO incident_alerts VALUES ($1, $2)', [uuid(incident), uuid(alert)]);
    }
    await database.query(`INSERT INTO incident_timeline(incident_id, timestamp) VALUES ($1, '2026-09-14 01:02:03')`, [uuid(10)]);
    await database.query("SET TIME ZONE 'Asia/Karachi'");
  }

  async function snapshot(): Promise<unknown> {
    const result = await database.query(`SELECT
      (SELECT jsonb_agg(to_jsonb(a) ORDER BY id) FROM alerts a) AS alerts,
      (SELECT jsonb_agg(to_jsonb(l) ORDER BY incident_id, alert_id) FROM incident_alerts l) AS links,
      (SELECT jsonb_agg(to_jsonb(i) ORDER BY id) FROM incidents i) AS incidents,
      (SELECT jsonb_agg(to_jsonb(t) ORDER BY id) FROM incident_timeline t) AS timeline,
      (SELECT jsonb_agg(name ORDER BY name) FROM migrations) AS migrations,
      (SELECT jsonb_agg(indexdef ORDER BY indexname) FROM pg_indexes WHERE schemaname = 'migration_test') AS indexes`);
    return result.rows[0];
  }

  it('repairs the already-indexed upgrade state, remaps links and preserves canonical metadata on rerun', async () => {
    await legacyFixture();
    await migrateIncidentManagementRepairs(client);

    const { rows } = await database.query(`SELECT id, fingerprint, status, severity, anomaly_score, occurrence_count,
      extract(epoch FROM last_seen_at)::INTEGER AS last_seen,
      extract(epoch FROM acknowledged_at)::INTEGER AS acknowledged, acknowledged_by,
      extract(epoch FROM resolved_at)::INTEGER AS resolved, resolved_by FROM alerts ORDER BY id`);
    expect(rows).toEqual([
      { id: uuid(1), fingerprint: canonicalFingerprint, status: 'active', severity: 'critical', anomaly_score: 0.95,
        occurrence_count: 9, last_seen: 30, acknowledged: 12, acknowledged_by: uuid(90), resolved: null, resolved_by: null },
      { id: uuid(4), fingerprint: canonicalFingerprint, status: 'resolved', severity: 'info', anomaly_score: 0.1,
        occurrence_count: 9, last_seen: 5, acknowledged: null, acknowledged_by: null, resolved: 4, resolved_by: uuid(90) },
      { id: uuid(5), fingerprint: fingerprintFor('ORBITAL-X2', 'fuel_pressure', 'propulsion'), status: 'active', severity: 'warning', anomaly_score: 0.3,
        occurrence_count: 1, last_seen: 7, acknowledged: null, acknowledged_by: null, resolved: null, resolved_by: null },
      { id: uuid(6), fingerprint: fingerprintFor('ORBITAL-X1', 'fuel_flow', 'propulsion'), status: 'acknowledged', severity: 'high', anomaly_score: 0.8,
        occurrence_count: 6, last_seen: 8, acknowledged: null, acknowledged_by: null, resolved: null, resolved_by: null },
    ]);
    expect((await database.query('SELECT incident_id, alert_id FROM incident_alerts ORDER BY incident_id, alert_id')).rows).toEqual([
      { incident_id: uuid(10), alert_id: uuid(1) }, { incident_id: uuid(11), alert_id: uuid(1) },
      { incident_id: uuid(12), alert_id: uuid(4) }, { incident_id: uuid(12), alert_id: uuid(5) },
      { incident_id: uuid(12), alert_id: uuid(6) },
    ]);
    expect((await database.query('SELECT title FROM incidents ORDER BY id')).rows).toEqual([
      { title: 'Incident 1000' }, { title: 'Incident 1001' }, { title: 'Keep title' },
    ]);
    expect((await database.query('SELECT timestamp FROM incident_timeline')).rows[0].timestamp)
      .toEqual(new Date('2026-09-14T01:02:03Z'));
    expect((await database.query('SELECT name FROM migrations ORDER BY name')).rows).toEqual([
      { name: INCIDENT_MANAGEMENT_SCHEMA_MIGRATION }, { name: INCIDENT_MANAGEMENT_REPAIR_MIGRATION },
    ]);
    const repaired = await snapshot();
    calls.length = 0;
    await migrateIncidentManagementSchema(client);
    await migrateIncidentManagementRepairs(client);
    expect(await snapshot()).toEqual(repaired);
    expect(calls).toEqual(Array(2).fill([
      'BEGIN', 'SELECT pg_advisory_xact_lock(hashtext($1))',
      'INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING name', 'COMMIT',
    ]).flat());

    for (const status of ['active', 'acknowledged']) {
      await expect(database.query('INSERT INTO alerts(spacecraft_id, fingerprint, status) VALUES ($1, $2, $3)',
        ['ORBITAL-X1', canonicalFingerprint, status])).rejects.toMatchObject({ code: '23505' });
    }
    // A resolved fingerprint remains reusable; last_seen_at's repaired default is executable.
    const inserted = await database.query(`INSERT INTO alerts(spacecraft_id, fingerprint, status)
      VALUES ('ORBITAL-X1', $1, 'resolved') RETURNING last_seen_at`, [canonicalFingerprint]);
    expect(inserted.rows[0].last_seen_at).toBeInstanceOf(Date);
    await expect(database.query('INSERT INTO incidents(title) VALUES (NULL)')).rejects.toMatchObject({ code: '23502' });
    await expect(database.query('INSERT INTO incident_alerts VALUES ($1, $2)', [uuid(10), uuid(2)]))
      .rejects.toMatchObject({ code: '23503' });
  });

  it('rolls back normalization, links, index DDL and the repair marker together after a SQL failure', async () => {
    await legacyFixture();
    const original = await snapshot();
    const failingClient: IncidentManagementMigrationClient = {
      async query(text, values) {
        if (text.includes('ALTER COLUMN title SET NOT NULL')) {
          return database.query('SELECT 1 / 0');
        }
        return client.query(text, values);
      },
    };
    await expect(migrateIncidentManagementRepairs(failingClient)).rejects.toMatchObject({ code: '22012' });
    expect(await snapshot()).toEqual(original);
    expect(calls.at(-1)).toBe('ROLLBACK');
    await migrateIncidentManagementRepairs(client);
    expect((await database.query('SELECT COUNT(*)::INTEGER AS count FROM alerts')).rows).toEqual([{ count: 4 }]);
  });

  it('also handles an indexed schema with no original marker', async () => {
    await legacyFixture();
    await database.query('DELETE FROM migrations');
    await migrateIncidentManagementSchema(client);
    await migrateIncidentManagementRepairs(client);
    expect((await database.query('SELECT id, occurrence_count FROM alerts ORDER BY id')).rows).toEqual([
      { id: uuid(1), occurrence_count: 9 }, { id: uuid(4), occurrence_count: 9 },
      { id: uuid(5), occurrence_count: 1 }, { id: uuid(6), occurrence_count: 6 },
    ]);
    expect((await database.query('SELECT COUNT(*)::INTEGER AS count FROM incident_alerts')).rows).toEqual([{ count: 5 }]);
  });

  it.each(['original', 'repair'] as const)(
    'preserves distinct nullable and delimiter-containing tuples through the %s migration', async path => {
      if (path === 'repair') {
        await database.query('INSERT INTO migrations(name) VALUES ($1)', [INCIDENT_MANAGEMENT_SCHEMA_MIGRATION]);
      }
      const tuples: Array<[string | null, string | null]> = [
        ['fuel_pressure', null], [null, 'fuel_pressure'], ['', 'fuel_pressure'],
        [null, null], ['', null], ['fuel:pressure', 'propulsion'], ['fuel', 'pressure:propulsion'],
      ];
      for (const [index, [metric, subsystem]] of tuples.entries()) {
        await database.query(`INSERT INTO alerts(id, spacecraft_id, metric, subsystem, fingerprint, created_at)
          VALUES ($1, 'ORBITAL-X1', $2, $3, $4, to_timestamp(1))`,
        [uuid(index + 1), metric, subsystem, `legacy-${index}`]);
      }
      await database.query(`INSERT INTO alerts(id, spacecraft_id, metric, subsystem, fingerprint, status, occurrence_count, created_at)
        VALUES ($1, 'ORBITAL-X1', 'fuel_pressure', NULL, 'legacy-duplicate', 'acknowledged', 3, to_timestamp(2)),
               ($2, 'ORBITAL-X1', 'fuel_pressure', NULL, 'legacy-history', 'resolved', 5, to_timestamp(0))`,
      [uuid(8), uuid(9)]);
      await database.query("INSERT INTO incidents(id, title) VALUES ($1, 'Nullable tuple incident')", [uuid(10)]);
      await database.query('INSERT INTO incident_alerts VALUES ($1, $2), ($1, $3)', [uuid(10), uuid(8), uuid(2)]);

      const migrate = path === 'original' ? migrateIncidentManagementSchema : migrateIncidentManagementRepairs;
      await migrate(client);
      const { rows } = await database.query(`SELECT id, metric, subsystem, status, occurrence_count, fingerprint
        FROM alerts ORDER BY id`);
      expect(rows).toEqual([
        ...tuples.map(([metric, subsystem], index) => ({
          id: uuid(index + 1), metric, subsystem, status: 'active',
          occurrence_count: index === 0 ? 4 : 1, fingerprint: fingerprintFor('ORBITAL-X1', metric, subsystem),
        })),
        { id: uuid(9), metric: 'fuel_pressure', subsystem: null, status: 'resolved',
          occurrence_count: 5, fingerprint: rows[0].fingerprint },
      ]);
      expect(new Set(rows.filter(row => row.status === 'active').map(row => row.fingerprint)).size).toBe(tuples.length);
      expect((await database.query('SELECT incident_id, alert_id FROM incident_alerts ORDER BY alert_id')).rows).toEqual([
        { incident_id: uuid(10), alert_id: uuid(1) }, { incident_id: uuid(10), alert_id: uuid(2) },
      ]);
      // These inserts exercise the recreated unique index, not just its catalog entry.
      for (const status of ['active', 'acknowledged']) {
        await expect(database.query('INSERT INTO alerts(spacecraft_id, fingerprint, status) VALUES ($1, $2, $3)',
          ['ORBITAL-X1', rows[0].fingerprint, status])).rejects.toMatchObject({ code: '23505' });
      }
      const migrated = await snapshot();
      await migrate(client);
      expect(await snapshot()).toEqual(migrated);
    },
  );

  it('runs both migrations on the fresh schema and leaves timestamptz instants unchanged', async () => {
    await database.query("SET TIME ZONE 'Asia/Karachi'");
    await database.query("INSERT INTO incident_timeline(timestamp) VALUES ('2026-09-14T01:02:03Z')");
    await migrateIncidentManagementSchema(client);
    await migrateIncidentManagementRepairs(client);
    expect((await database.query('SELECT timestamp FROM incident_timeline')).rows[0].timestamp)
      .toEqual(new Date('2026-09-14T01:02:03Z'));
    const incident = await database.query("INSERT INTO incidents(spacecraft_id, title) VALUES ('ORBITAL-X1', 'Fresh incident') RETURNING incident_number");
    expect(incident.rows[0].incident_number).toBe('1000');
    await database.query("INSERT INTO alerts(spacecraft_id, fingerprint) VALUES ('ORBITAL-X1', 'fresh')");
    expect((await database.query("SELECT column_name, data_type, character_maximum_length FROM information_schema.columns WHERE table_schema = 'migration_test' AND table_name IN ('alerts', 'incidents') AND column_name = 'spacecraft_id'")).rows)
      .toEqual(Array(2).fill({ column_name: 'spacecraft_id', data_type: 'character varying', character_maximum_length: 100 }));
    expect((await database.query("SELECT to_regclass('auth_sessions') AS sessions")).rows[0].sessions).toBe('auth_sessions');
  });
});
