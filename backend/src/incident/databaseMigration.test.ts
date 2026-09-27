import {
  INCIDENT_MANAGEMENT_SCHEMA_MIGRATION,
  migrateIncidentManagementRepairs,
  migrateIncidentManagementSchema,
  type IncidentManagementMigrationClient,
} from './databaseMigration.js';
import {
  AlertSeverity,
  AlertStatus,
  IncidentStatus,
  formatIncidentDisplayNumber,
} from './types.js';
import type { AlertRecord, AuthUser, IncidentRecord, TimelineEvent } from './types.js';

class RecordingMigrationClient implements IncidentManagementMigrationClient {
  readonly calls: Array<{ text: string; values?: readonly unknown[] }> = [];

  async query(text: string, values?: readonly unknown[]): Promise<unknown> {
    this.calls.push({ text, values });
    return text.includes('INSERT INTO migrations') ? { rows: [{ name: INCIDENT_MANAGEMENT_SCHEMA_MIGRATION }] } : undefined;
  }
}

describe('migrateIncidentManagementSchema', () => {
  it('exposes lowercase storage enums and stable incident display numbers', () => {
    const alert: AlertRecord = {
      id: 'alert-1', spacecraftId: 'ORBITAL-X1', subsystem: 'propulsion', severity: AlertSeverity.CRITICAL,
      metric: 'fuel_pressure', value: 12, expectedRange: null, anomalyScore: 0.95, detectionMethod: 'rate',
      fingerprint: 'fingerprint', occurrenceCount: 1, status: AlertStatus.ACTIVE, createdAt: '2026-09-14T00:00:00Z',
      lastSeenAt: '2026-09-14T00:00:00Z', acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null,
      resolvedBy: null, updatedAt: null,
    };
    const incident: IncidentRecord = {
      id: 'incident-1', incidentNumber: 1042, displayNumber: 'INC-1042', spacecraftId: 'ORBITAL-X1',
      title: 'Fuel pressure anomaly', description: null, severity: AlertSeverity.CRITICAL, status: IncidentStatus.OPEN,
      rootCause: null, affectedSubsystems: ['propulsion'], createdAt: '2026-09-14T00:00:00Z',
      acknowledgedAt: null, acknowledgedBy: null, resolvedAt: null, resolvedBy: null, updatedAt: null,
    };
    const event: TimelineEvent = {
      id: 1, incidentId: incident.id, actorId: null, eventType: 'created', description: 'Created',
      metadata: null, timestamp: '2026-09-14T00:00:00Z',
    };
    const user: AuthUser = { id: 'user-1', username: 'operator', role: 'flight_controller' };

    expect(AlertSeverity.CRITICAL).toBe('critical');
    expect(AlertStatus.ACKNOWLEDGED).toBe('acknowledged');
    expect(IncidentStatus.INVESTIGATING).toBe('investigating');
    expect(formatIncidentDisplayNumber(1042)).toBe('INC-1042');
    expect([alert.id, incident.displayNumber, event.eventType, user.username]).toEqual([
      'alert-1', 'INC-1042', 'created', 'operator',
    ]);
  });

  it('converges alert and incident spacecraft identifiers and records the migration in one transaction', async () => {
    const client = new RecordingMigrationClient();

    await migrateIncidentManagementSchema(client);

    const statements = client.calls.map(({ text }) => text);
    const alertForeignKeyDrop = client.calls.findIndex(({ text }) => text.includes('alerts_spacecraft_id_fkey'));
    const incidentForeignKeyDrop = client.calls.findIndex(({ text }) => text.includes('incidents_spacecraft_id_fkey'));
    const alertConversion = client.calls.findIndex(({ text }) => text.includes('ALTER TABLE alerts') && text.includes('VARCHAR(100)'));
    const incidentConversion = client.calls.findIndex(({ text }) => text.includes('ALTER TABLE incidents') && text.includes('VARCHAR(100)'));
    const migrationRecord = client.calls.find(({ text }) => text.includes('INSERT INTO migrations'));

    expect(statements[0]).toBe('BEGIN');
    expect(client.calls[1]).toEqual({
      text: 'SELECT pg_advisory_xact_lock(hashtext($1))',
      values: [INCIDENT_MANAGEMENT_SCHEMA_MIGRATION],
    });
    expect(alertForeignKeyDrop).toBeGreaterThan(-1);
    expect(incidentForeignKeyDrop).toBeGreaterThan(-1);
    expect(alertConversion).toBeGreaterThan(alertForeignKeyDrop);
    expect(incidentConversion).toBeGreaterThan(incidentForeignKeyDrop);
    expect(statements.join('\n')).toContain('CREATE TABLE IF NOT EXISTS auth_sessions');
    expect(statements.join('\n')).toContain('fingerprint TEXT');
    expect(statements.join('\n')).toContain('occurrence_count INTEGER');
    expect(statements.join('\n')).toContain('last_seen_at TIMESTAMPTZ');
    expect(statements.join('\n')).toContain('START WITH 1000');
    expect(migrationRecord).toEqual({
      text: 'INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING name',
      values: [INCIDENT_MANAGEMENT_SCHEMA_MIGRATION],
    });
    expect(statements.at(-1)).toBe('COMMIT');
  });

  it('commits without applying DDL when its atomic migration guard reports an earlier run', async () => {
    class AppliedMigrationClient extends RecordingMigrationClient {
      override async query(text: string, values?: readonly unknown[]): Promise<unknown> {
        await super.query(text, values);
        return text.includes('INSERT INTO migrations') ? { rows: [] } : undefined;
      }
    }

    const client = new AppliedMigrationClient();

    await migrateIncidentManagementSchema(client);
    await migrateIncidentManagementSchema(client);

    const ddlCalls = client.calls.filter(({ text }) => text.includes('ALTER TABLE') || text.includes('CREATE TABLE'));
    expect(ddlCalls).toHaveLength(0);
    expect(client.calls.map(({ text }) => text)).toEqual([
      'BEGIN', 'SELECT pg_advisory_xact_lock(hashtext($1))',
      'INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING name', 'COMMIT',
      'BEGIN', 'SELECT pg_advisory_xact_lock(hashtext($1))',
      'INSERT INTO migrations (name) VALUES ($1) ON CONFLICT (name) DO NOTHING RETURNING name', 'COMMIT',
    ]);
  });

  it.each([migrateIncidentManagementSchema, migrateIncidentManagementRepairs])('orders index removal, normalization, consolidation and index recreation for %p', async migrate => {
    const client = new RecordingMigrationClient();

    await migrate(client);

    const indexDrop = client.calls.findIndex(({ text }) => text.includes('DROP INDEX IF EXISTS idx_alerts_active_fingerprint'));
    const uniqueIndex = client.calls.findIndex(({ text }) => text.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_alerts_active_fingerprint'));
    const repairIndex = client.calls.findIndex(({ text }) => text.includes('UPDATE alerts') && text.includes('SET fingerprint'));
    const consolidationIndex = client.calls.findIndex(({ text }) => text.includes('phase6_consolidate_canonical_alerts'));

    expect(indexDrop).toBeGreaterThan(-1);
    expect(repairIndex).toBeGreaterThan(indexDrop);
    expect(consolidationIndex).toBeGreaterThan(repairIndex);
    expect(uniqueIndex).toBeGreaterThan(repairIndex);
    expect(uniqueIndex).toBeGreaterThan(consolidationIndex);
  });

  it('only converts legacy timeline timestamps and aligns upgraded defaults with fresh-schema contracts', async () => {
    const client = new RecordingMigrationClient();

    await migrateIncidentManagementSchema(client);

    const statements = client.calls.map(({ text }) => text).join('\n');
    expect(statements).toContain("timestamp_type = 'timestamp without time zone'");
    expect(statements).toContain('ALTER COLUMN last_seen_at SET DEFAULT CURRENT_TIMESTAMP');
    expect(statements).toContain("SET title = COALESCE(NULLIF(title, ''), 'Incident ' || incident_number::TEXT)");
    expect(statements).toContain('ALTER COLUMN title SET NOT NULL');
  });

  it('rolls back instead of recording a partial migration when a schema statement fails', async () => {
    class FailingMigrationClient extends RecordingMigrationClient {
      override async query(text: string, values?: readonly unknown[]): Promise<unknown> {
        const result = await super.query(text, values);
        if (text.includes('CREATE TABLE IF NOT EXISTS auth_sessions')) {
          throw new Error('database unavailable');
        }
        return result;
      }
    }

    const client = new FailingMigrationClient();

    await expect(migrateIncidentManagementSchema(client)).rejects.toThrow('database unavailable');

    expect(client.calls.map(({ text }) => text)).toContain('ROLLBACK');
    expect(client.calls.map(({ text }) => text)).not.toContain('COMMIT');
  });
});
