import { subsystemForMetric } from './metricCatalog.js';
import { telemetryMetricValues, type TelemetryFrame } from './schema.js';
import { logger } from '../utils/logger.js';

const insertTelemetryMetricSql = [
  'INSERT INTO telemetry (spacecraft_id, timestamp, subsystem, metric, value)',
  'VALUES ($1, $2, $3, $4, $5)',
  'ON CONFLICT (spacecraft_id, metric, timestamp)',
  'DO UPDATE SET subsystem = EXCLUDED.subsystem, value = EXCLUDED.value',
].join('\n');

const latestTelemetrySql = `
  SELECT DISTINCT ON (metric)
    spacecraft_id, timestamp, subsystem, metric, value, unit
  FROM telemetry
  WHERE spacecraft_id = $1
  ORDER BY metric, timestamp DESC
`;

const telemetryHistorySql = `
  SELECT spacecraft_id, timestamp, subsystem, metric, value, unit
  FROM telemetry
  WHERE spacecraft_id = $1
    AND metric = $2
    AND ($3::timestamptz IS NULL OR timestamp >= $3::timestamptz)
    AND ($4::timestamptz IS NULL OR timestamp <= $4::timestamptz)
  ORDER BY timestamp ASC
  LIMIT $5
`;

const aggregatedTelemetryHistorySql = `
  SELECT
    spacecraft_id,
    date_bin(
      make_interval(secs => $5::double precision),
      timestamp,
      TIMESTAMPTZ '1970-01-01'
    ) AS timestamp,
    subsystem,
    metric,
    AVG(value)::double precision AS value,
    unit,
    MIN(value)::double precision AS min,
    MAX(value)::double precision AS max
  FROM telemetry
  WHERE spacecraft_id = $1
    AND metric = $2
    AND ($3::timestamptz IS NULL OR timestamp >= $3::timestamptz)
    AND ($4::timestamptz IS NULL OR timestamp <= $4::timestamptz)
  GROUP BY
    spacecraft_id,
    date_bin(
      make_interval(secs => $5::double precision),
      timestamp,
      TIMESTAMPTZ '1970-01-01'
    ),
    subsystem,
    metric,
    unit
  ORDER BY timestamp ASC
  LIMIT $6
`;

export interface TelemetryDatabaseClient {
  query(text: string, values?: unknown[]): Promise<unknown>;
  release(): void;
}

export interface TelemetryDatabase {
  getClient(): Promise<TelemetryDatabaseClient>;
}

export interface TelemetryRepository {
  store(frame: TelemetryFrame): Promise<void>;
}

export interface TelemetryReading {
  spacecraft_id: string;
  timestamp: string;
  subsystem: string;
  metric: string;
  value: number;
  unit: string | null;
  min?: number;
  max?: number;
}

export type LatestTelemetry = Readonly<Record<string, TelemetryReading>>;

export interface TelemetryHistoryQuery {
  spacecraftId: string;
  metric: string;
  from?: string;
  to?: string;
  bucketSeconds?: 2 | 5 | 15 | 60 | 300;
  limit: number;
}

export interface TelemetryReadRepository {
  latest(spacecraftId: string): Promise<LatestTelemetry>;
  history(query: TelemetryHistoryQuery): Promise<readonly TelemetryReading[]>;
}

interface TelemetryDatabaseRow {
  spacecraft_id: string;
  timestamp: Date | string;
  subsystem: string;
  metric: string;
  value: number | string;
  unit: string | null;
  min?: number | string | null;
  max?: number | string | null;
}

function toTelemetryReading(row: TelemetryDatabaseRow): TelemetryReading {
  const reading: TelemetryReading = {
    spacecraft_id: row.spacecraft_id,
    timestamp: row.timestamp instanceof Date ? row.timestamp.toISOString() : row.timestamp,
    subsystem: row.subsystem,
    metric: row.metric,
    value: Number(row.value),
    unit: row.unit,
  };
  if (row.min !== undefined && row.min !== null) {
    reading.min = Number(row.min);
  }
  if (row.max !== undefined && row.max !== null) {
    reading.max = Number(row.max);
  }
  return reading;
}

export class PostgresTelemetryRepository implements TelemetryRepository, TelemetryReadRepository {
  constructor(private readonly database: TelemetryDatabase) {}

  async store(frame: TelemetryFrame): Promise<void> {
    const client = await this.database.getClient();
    let transactionStarted = false;

    try {
      await client.query('BEGIN');
      transactionStarted = true;

      for (const [metric, value] of Object.entries(telemetryMetricValues(frame))) {
        await client.query(insertTelemetryMetricSql, [
          frame.spacecraft_id,
          frame.timestamp,
          subsystemForMetric(metric),
          metric,
          value,
        ]);
      }

      await client.query('COMMIT');
    } catch (error) {
      if (transactionStarted) {
        try {
          await client.query('ROLLBACK');
        } catch (rollbackError) {
          logger.error({ err: rollbackError }, 'Telemetry transaction rollback failed');
        }
      }
      throw error;
    } finally {
      client.release();
    }
  }

  async latest(spacecraftId: string): Promise<LatestTelemetry> {
    const client = await this.database.getClient();
    try {
      const result = await client.query(latestTelemetrySql, [spacecraftId]) as {
        rows: TelemetryDatabaseRow[];
      };
      const latest: Record<string, TelemetryReading> = {};
      for (const row of result.rows) {
        latest[row.metric] = toTelemetryReading(row);
      }
      return latest;
    } finally {
      client.release();
    }
  }

  async history(query: TelemetryHistoryQuery): Promise<readonly TelemetryReading[]> {
    const client = await this.database.getClient();
    try {
      const values = query.bucketSeconds === undefined
        ? [
            query.spacecraftId,
            query.metric,
            query.from ?? null,
            query.to ?? null,
            query.limit,
          ]
        : [
            query.spacecraftId,
            query.metric,
            query.from ?? null,
            query.to ?? null,
            query.bucketSeconds,
            query.limit,
          ];
      const sql = query.bucketSeconds === undefined
        ? telemetryHistorySql
        : aggregatedTelemetryHistorySql;
      const result = await client.query(sql, values) as { rows: TelemetryDatabaseRow[] };
      return result.rows.map(toTelemetryReading);
    } finally {
      client.release();
    }
  }
}
