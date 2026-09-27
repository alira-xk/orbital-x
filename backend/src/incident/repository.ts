import type { TelemetryDatabase, TelemetryDatabaseClient } from '../telemetry/repository.js';
import { canTransitionIncident, highestSeverity, type CorrelationCandidate } from './incidentCorrelator.js';
import { AlertStatus, IncidentStatus, formatIncidentDisplayNumber, type AlertRecord, type IncidentRecord, type TimelineEvent } from './types.js';

type Row = Record<string, unknown>;
const timestamp = (value: unknown): string => value instanceof Date ? value.toISOString() : String(value);
const optionalTime = (value: unknown): string | null => value == null ? null : timestamp(value);
const optionalString = (value: unknown): string | null => value == null ? null : String(value);
const bound = (value = 100): number => Number.isFinite(value) ? Math.max(1, Math.min(1000, Math.trunc(value))) : 100;
const severityOrder = "ARRAY['info','warning','high','critical']::text[]";

async function rows(client: TelemetryDatabaseClient, sql: string, values: unknown[] = []): Promise<Row[]> {
  return (await client.query(sql, values) as { rows: Row[] }).rows;
}
export function toAlert(row: Row): AlertRecord {
  return {
    id: String(row.id), spacecraftId: String(row.spacecraft_id), subsystem: String(row.subsystem),
    severity: row.severity as AlertRecord['severity'], metric: String(row.metric), value: Number(row.value),
    expectedRange: optionalString(row.expected_range), anomalyScore: row.anomaly_score == null ? null : Number(row.anomaly_score),
    detectionMethod: row.detection_method as AlertRecord['detectionMethod'], fingerprint: String(row.fingerprint),
    occurrenceCount: Number(row.occurrence_count), status: row.status as AlertStatus,
    createdAt: timestamp(row.created_at), lastSeenAt: timestamp(row.last_seen_at), updatedAt: optionalTime(row.updated_at),
    acknowledgedAt: optionalTime(row.acknowledged_at), acknowledgedBy: optionalString(row.acknowledged_by),
    resolvedAt: optionalTime(row.resolved_at), resolvedBy: optionalString(row.resolved_by),
  };
}
function toIncident(row: Row): IncidentRecord {
  const incidentNumber = Number(row.incident_number);
  return {
    id: String(row.id), incidentNumber, displayNumber: formatIncidentDisplayNumber(incidentNumber),
    spacecraftId: String(row.spacecraft_id), title: String(row.title), description: optionalString(row.description),
    severity: row.severity as IncidentRecord['severity'], status: row.status as IncidentStatus,
    rootCause: optionalString(row.root_cause), affectedSubsystems: (row.affected_subsystems ?? []) as string[],
    createdAt: timestamp(row.created_at), updatedAt: optionalTime(row.updated_at),
    acknowledgedAt: optionalTime(row.acknowledged_at), acknowledgedBy: optionalString(row.acknowledged_by),
    resolvedAt: optionalTime(row.resolved_at), resolvedBy: optionalString(row.resolved_by),
  };
}
function toEvent(row: Row): TimelineEvent {
  return { id: Number(row.id), incidentId: String(row.incident_id), actorId: optionalString(row.actor_id),
    eventType: row.event_type as TimelineEvent['eventType'], description: String(row.description),
    metadata: row.metadata as TimelineEvent['metadata'], timestamp: timestamp(row.timestamp) };
}

export async function inIncidentTransaction<T>(database: TelemetryDatabase, work: (client: TelemetryDatabaseClient) => Promise<T>): Promise<T> {
  const client = await database.getClient();
  let begun = false;
  try {
    await client.query('BEGIN');
    begun = true;
    const result = await work(client);
    await client.query('COMMIT');
    return result;
  } catch (error) {
    if (begun) {
      try { await client.query('ROLLBACK'); } catch { /* Preserve the original persistence error. */ }
    }
    throw error;
  } finally { client.release(); }
}

// Shared by evidence and operator mutations so correlation and resolution cannot race.
export async function lockSpacecraft(client: TelemetryDatabaseClient, spacecraftId: string): Promise<void> {
  await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`incident:${spacecraftId}`]);
}

export interface AlertListQuery {
  spacecraftId?: string; status?: string; severity?: string; subsystem?: string; metric?: string;
  from?: string; to?: string; limit?: number; offset?: number;
}
export interface IncidentListQuery {
  spacecraftId?: string; status?: string; severity?: string; limit?: number; offset?: number;
}
export type IncidentSummary = IncidentRecord & { alertCount: number };
export interface IncidentDetail { incident: IncidentRecord; alerts: AlertRecord[]; timeline: TimelineEvent[] }
export interface ReplayMarker {
  id: string; timestamp: string; kind: 'alert' | 'timeline'; label: string;
  severity: AlertRecord['severity'] | null;
}
export interface IncidentReplay {
  incident: IncidentRecord;
  window: { from: string; to: string };
  frames: Array<Record<string, string | number>>;
  markers: ReplayMarker[];
}
export interface AlertRepository { list(query: AlertListQuery): Promise<AlertRecord[]> }
export interface IncidentRepository {
  list(query: IncidentListQuery): Promise<IncidentSummary[]>;
  detail(id: string, limit?: number): Promise<IncidentDetail | null>;
  transition(id: string, expectedStatus: IncidentStatus, status: IncidentStatus, actorId: string | null): Promise<IncidentRecord | null>;
  comment(id: string, actorId: string | null, description: string): Promise<TimelineEvent | null>;
  replay(id: string): Promise<IncidentReplay | null>;
}
export interface AlertObservation {
  spacecraftId: string; metric: string; subsystem: string; severity: AlertRecord['severity']; value: number;
  expectedRange: string; anomalyScore: number; detectionMethod: AlertRecord['detectionMethod']; timestamp: string;
}

export class PostgresAlertRepository implements AlertRepository {
  constructor(private readonly database: TelemetryDatabase) {}

  async list(query: AlertListQuery = {}): Promise<AlertRecord[]> {
    const client = await this.database.getClient();
    try {
      return (await rows(client, `SELECT * FROM alerts WHERE
        ($1::text IS NULL OR spacecraft_id = $1) AND ($2::text IS NULL OR status = $2)
        AND ($3::text IS NULL OR severity = $3) AND ($4::text IS NULL OR subsystem = $4)
        AND ($5::text IS NULL OR metric = $5) AND ($6::timestamptz IS NULL OR last_seen_at >= $6)
        AND ($7::timestamptz IS NULL OR last_seen_at <= $7)
        ORDER BY last_seen_at DESC, id ASC LIMIT $8 OFFSET $9`,
      [query.spacecraftId ?? null, query.status ?? null, query.severity ?? null, query.subsystem ?? null,
        query.metric ?? null, query.from ?? null, query.to ?? null, bound(query.limit), Math.max(0, Math.trunc(query.offset ?? 0))])).map(toAlert);
    } finally { client.release(); }
  }

  async observe(client: TelemetryDatabaseClient, observation: AlertObservation): Promise<{ alert: AlertRecord; kind: 'created' | 'observed_again' | 'reopened' } | null> {
    const values = [observation.spacecraftId, observation.metric, observation.subsystem];
    // Compute the exact JSONB-array canonical hash used by both schema migrations.
    const previous = await rows(client, `SELECT * FROM alerts WHERE spacecraft_id = $1
      AND fingerprint = md5(jsonb_build_array($1::text, $2::text, $3::text)::text)
      ORDER BY (status <> 'resolved') DESC, last_seen_at DESC, id ASC LIMIT 1 FOR UPDATE`, values);
    const old = previous[0] ? toAlert(previous[0]) : null;
    // Per-spacecraft worker ordering means older/equal instants are retries, not new observations.
    if (old && Date.parse(observation.timestamp) <= Date.parse(old.lastSeenAt)) return null;
    if (old && old.status !== AlertStatus.RESOLVED) {
      const updated = await rows(client, `UPDATE alerts SET last_seen_at = $2, occurrence_count = occurrence_count + 1,
        severity = CASE WHEN array_position(${severityOrder}, severity) < array_position(${severityOrder}, $3::text) THEN $3 ELSE severity END,
        anomaly_score = GREATEST(anomaly_score, $4), value = $5, expected_range = $6,
        detection_method = $7, updated_at = $2 WHERE id = $1 RETURNING *`,
      [old.id, observation.timestamp, observation.severity, observation.anomalyScore, observation.value, observation.expectedRange, observation.detectionMethod]);
      return { alert: toAlert(updated[0]), kind: 'observed_again' };
    }
    const inserted = await rows(client, `INSERT INTO alerts
      (spacecraft_id, metric, subsystem, fingerprint, severity, value, expected_range, anomaly_score, detection_method, created_at, last_seen_at, updated_at)
      VALUES ($1::text, $2::text, $3::text, md5(jsonb_build_array($1::text, $2::text, $3::text)::text), $4, $5, $6, $7, $8, $9::timestamptz, $9::timestamptz, $9::timestamptz) RETURNING *`,
    [...values, observation.severity, observation.value, observation.expectedRange, observation.anomalyScore, observation.detectionMethod, observation.timestamp]);
    return { alert: toAlert(inserted[0]), kind: old ? 'reopened' : 'created' };
  }

  async unlinked(client: TelemetryDatabaseClient, alert: AlertRecord): Promise<AlertRecord[]> {
    return (await rows(client, `SELECT a.* FROM alerts a WHERE spacecraft_id = $1 AND status <> 'resolved'
      AND last_seen_at BETWEEN $2::timestamptz - INTERVAL '5 minutes' AND $2::timestamptz + INTERVAL '5 minutes'
      AND NOT EXISTS (SELECT 1 FROM incident_alerts ia JOIN incidents i ON i.id = ia.incident_id
        WHERE ia.alert_id = a.id AND i.status <> 'resolved') ORDER BY id LIMIT 1001`, [alert.spacecraftId, alert.lastSeenAt]))
      .map(toAlert).map((value, index) => { if (index === 1000) throw new Error('Correlation alert capacity exceeded'); return value; });
  }
}

export class PostgresIncidentRepository implements IncidentRepository {
  constructor(private readonly database: TelemetryDatabase) {}

  async list(query: IncidentListQuery = {}): Promise<IncidentSummary[]> {
    const client = await this.database.getClient();
    try {
      return (await rows(client, `SELECT i.*, (SELECT count(*) FROM incident_alerts ia WHERE ia.incident_id = i.id) AS alert_count
        FROM incidents i WHERE ($1::text IS NULL OR spacecraft_id = $1)
        AND ($2::text IS NULL OR status = $2) AND ($3::text IS NULL OR severity = $3)
        ORDER BY COALESCE(updated_at, created_at) DESC, incident_number DESC LIMIT $4 OFFSET $5`,
      [query.spacecraftId ?? null, query.status ?? null, query.severity ?? null, bound(query.limit), Math.max(0, Math.trunc(query.offset ?? 0))]))
        .map(row => ({ ...toIncident(row), alertCount: Number(row.alert_count) }));
    } finally { client.release(); }
  }

  async detail(id: string, limit = 1000): Promise<IncidentDetail | null> {
    const client = await this.database.getClient();
    try {
      const found = await rows(client, 'SELECT * FROM incidents WHERE id = $1', [id]);
      if (!found[0]) return null;
      const alerts = (await rows(client, `SELECT a.* FROM alerts a JOIN incident_alerts ia ON ia.alert_id = a.id
        WHERE ia.incident_id = $1 ORDER BY a.created_at, a.id LIMIT $2`, [id, bound(limit)])).map(toAlert);
      const timeline = (await rows(client, `SELECT * FROM (SELECT * FROM incident_timeline WHERE incident_id = $1
        ORDER BY timestamp DESC, id DESC LIMIT $2) recent ORDER BY timestamp ASC, id ASC`, [id, bound(limit)])).map(toEvent);
      return { incident: toIncident(found[0]), alerts, timeline };
    } finally { client.release(); }
  }

  async replay(id: string): Promise<IncidentReplay | null> {
    const client = await this.database.getClient();
    try {
      const found = await rows(client, 'SELECT * FROM incidents WHERE id = $1', [id]);
      if (!found[0]) return null;
      const incident = toIncident(found[0]);
      const from = new Date(Date.parse(incident.createdAt) - 30_000);
      const naturalEnd = incident.resolvedAt ?? new Date().toISOString();
      const to = new Date(Math.min(Date.parse(naturalEnd), from.getTime() + 6 * 60 * 60_000));
      const frameRows = await rows(client, `SELECT timestamp, jsonb_object_agg(metric, value ORDER BY metric) AS metrics
        FROM telemetry WHERE spacecraft_id = $1 AND timestamp BETWEEN $2 AND $3
        GROUP BY timestamp ORDER BY timestamp ASC LIMIT 1000`, [incident.spacecraftId, from.toISOString(), to.toISOString()]);
      const timeline = (await rows(client, `SELECT * FROM incident_timeline WHERE incident_id = $1
        AND timestamp BETWEEN $2 AND $3 ORDER BY timestamp, id LIMIT 1000`, [id, from.toISOString(), to.toISOString()])).map(toEvent);
      const alerts = (await rows(client, `SELECT a.* FROM alerts a JOIN incident_alerts ia ON ia.alert_id = a.id
        WHERE ia.incident_id = $1 AND a.created_at BETWEEN $2 AND $3 ORDER BY a.created_at, a.id LIMIT 1000`,
      [id, from.toISOString(), to.toISOString()])).map(toAlert);
      const frames = frameRows.map(row => {
        const at = timestamp(row.timestamp);
        return { ...row.metrics as Record<string, number>, timestamp: at, spacecraft_id: incident.spacecraftId,
          simulation_time: Math.max(0, (Date.parse(at) - from.getTime()) / 1000), scenario: 'RECORDED_REPLAY' };
      });
      const markers: ReplayMarker[] = [
        ...timeline.map(event => ({ id: `timeline:${event.id}`, timestamp: event.timestamp, kind: 'timeline' as const,
          label: event.description, severity: null })),
        ...alerts.map(alert => ({ id: `alert:${alert.id}`, timestamp: alert.createdAt, kind: 'alert' as const,
          label: `${alert.subsystem}: ${alert.metric}`, severity: alert.severity })),
      ].sort((a, b) => Date.parse(a.timestamp) - Date.parse(b.timestamp) || a.id.localeCompare(b.id));
      return { incident, window: { from: from.toISOString(), to: to.toISOString() }, frames, markers };
    } finally { client.release(); }
  }

  async candidates(client: TelemetryDatabaseClient, alert: AlertRecord): Promise<CorrelationCandidate[]> {
    const found = await rows(client, `SELECT * FROM incidents i WHERE spacecraft_id = $1 AND status <> 'resolved'
      AND (COALESCE(updated_at, created_at) BETWEEN $2::timestamptz - INTERVAL '5 minutes' AND $2::timestamptz + INTERVAL '5 minutes'
        OR EXISTS (SELECT 1 FROM incident_alerts WHERE incident_id = i.id AND alert_id = $3))
      ORDER BY incident_number LIMIT 1001`, [alert.spacecraftId, alert.lastSeenAt, alert.id]);
    if (found.length > 1000) throw new Error('Correlation incident capacity exceeded');
    const candidates: CorrelationCandidate[] = [];
    for (const row of found) candidates.push({ incident: toIncident(row), alerts: await this.linkedAlerts(client, String(row.id)) });
    return candidates;
  }

  async linkedAlerts(client: TelemetryDatabaseClient, id: string): Promise<AlertRecord[]> {
    const found = await rows(client, `SELECT a.* FROM alerts a JOIN incident_alerts ia ON ia.alert_id = a.id
      WHERE ia.incident_id = $1 ORDER BY a.id LIMIT 1001`, [id]);
    if (found.length > 1000) throw new Error('Incident alert capacity exceeded');
    return found.map(toAlert);
  }

  async create(client: TelemetryDatabaseClient, alert: AlertRecord): Promise<IncidentRecord> {
    const found = await rows(client, `INSERT INTO incidents(spacecraft_id, title, severity, affected_subsystems, created_at, updated_at)
      VALUES ($1, $2, $3, $4, $5::timestamptz, $5::timestamptz) RETURNING *`,
    [alert.spacecraftId, `${alert.subsystem}: ${alert.metric}`, alert.severity, [alert.subsystem], alert.lastSeenAt]);
    return toIncident(found[0]);
  }

  async link(client: TelemetryDatabaseClient, incidentId: string, alertIds: readonly string[], observedAt: string): Promise<void> {
    await client.query(`INSERT INTO incident_alerts(incident_id, alert_id)
      SELECT $1, unnest($2::uuid[]) ON CONFLICT DO NOTHING`, [incidentId, alertIds]);
    const alerts = await this.linkedAlerts(client, incidentId);
    await client.query(`UPDATE incidents SET severity = $2, affected_subsystems = $3,
      updated_at = GREATEST(COALESCE(updated_at, created_at), $4::timestamptz) WHERE id = $1`,
    [incidentId, highestSeverity(alerts), [...new Set(alerts.map(alert => alert.subsystem))].sort(), observedAt]);
  }

  async appendEvent(client: TelemetryDatabaseClient, incidentId: string, eventType: TimelineEvent['eventType'], description: string,
    metadata: Record<string, unknown> | null, at: string, actorId: string | null = null): Promise<TimelineEvent> {
    const found = await rows(client, `INSERT INTO incident_timeline(incident_id, event_type, description, metadata, timestamp, actor_id)
      VALUES ($1, $2, $3, $4::jsonb, $5, $6) RETURNING *`, [incidentId, eventType, description, JSON.stringify(metadata), at, actorId]);
    return toEvent(found[0]);
  }

  private async lockIncident(client: TelemetryDatabaseClient, id: string): Promise<IncidentRecord | null> {
    const found = await rows(client, 'SELECT * FROM incidents WHERE id = $1', [id]);
    if (!found[0]) return null;
    await lockSpacecraft(client, String(found[0].spacecraft_id));
    const locked = await rows(client, 'SELECT * FROM incidents WHERE id = $1 FOR UPDATE', [id]);
    return locked[0] ? toIncident(locked[0]) : null;
  }

  async transition(id: string, expectedStatus: IncidentStatus, status: IncidentStatus, actorId: string | null): Promise<IncidentRecord | null> {
    if (!canTransitionIncident(expectedStatus, status)) return null;
    return inIncidentTransaction(this.database, async client => {
      const incident = await this.lockIncident(client, id);
      if (!incident || incident.status !== expectedStatus) return null;
      const at = new Date().toISOString();
      const found = await rows(client, `UPDATE incidents SET status = $3::text, updated_at = $4::timestamptz,
        acknowledged_at = CASE WHEN $3 = 'acknowledged' THEN $4::timestamptz ELSE acknowledged_at END,
        acknowledged_by = CASE WHEN $3 = 'acknowledged' THEN $5::uuid ELSE acknowledged_by END,
        resolved_at = CASE WHEN $3 = 'resolved' THEN $4::timestamptz WHEN $3 = 'reopened' THEN NULL ELSE resolved_at END,
        resolved_by = CASE WHEN $3 = 'resolved' THEN $5::uuid WHEN $3 = 'reopened' THEN NULL ELSE resolved_by END
        WHERE id = $1 AND status = $2 RETURNING *`, [id, expectedStatus, status, at, actorId]);
      if (!found[0]) return null;
      if (status === IncidentStatus.ACKNOWLEDGED || status === IncidentStatus.RESOLVED) {
        await client.query(`UPDATE alerts a SET status = $2::text, updated_at = $3::timestamptz,
          acknowledged_at = CASE WHEN $2 = 'acknowledged' THEN $3::timestamptz ELSE acknowledged_at END,
          acknowledged_by = CASE WHEN $2 = 'acknowledged' THEN $4::uuid ELSE acknowledged_by END,
          resolved_at = CASE WHEN $2 = 'resolved' THEN $3::timestamptz ELSE resolved_at END,
          resolved_by = CASE WHEN $2 = 'resolved' THEN $4::uuid ELSE resolved_by END
          WHERE status <> 'resolved' AND EXISTS (SELECT 1 FROM incident_alerts WHERE incident_id = $1 AND alert_id = a.id)`,
        [id, status, at, actorId]);
      }
      const eventType = status === IncidentStatus.ACKNOWLEDGED ? 'acknowledged' : status === IncidentStatus.RESOLVED ? 'resolved'
        : status === IncidentStatus.REOPENED ? 'reopened' : 'status_changed';
      await this.appendEvent(client, id, eventType, `Incident ${status}`, { from: expectedStatus, to: status }, at, actorId);
      return toIncident(found[0]);
    });
  }

  async comment(id: string, actorId: string | null, description: string): Promise<TimelineEvent | null> {
    const trimmed = description.trim();
    if (!trimmed || trimmed.length > 2000) throw new Error('Comment must contain 1 to 2000 characters');
    return inIncidentTransaction(this.database, async client => {
      if (!await this.lockIncident(client, id)) return null;
      const at = new Date().toISOString();
      await client.query('UPDATE incidents SET updated_at = $2 WHERE id = $1', [id, at]);
      return this.appendEvent(client, id, 'commented', trimmed, null, at, actorId);
    });
  }
}
